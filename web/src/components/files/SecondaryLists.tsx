import type { DragEvent } from 'react';
import {
  downloadUrl,
  formatBytes,
  isPreviewable,
  type LiveDriveItem,
  type Node,
  type RecentItem,
} from '../../lib/api';
import { ArrowLeft, Cloud, Clock3, Download, Eye, Share2 } from 'lucide-react';
import { FileThumb, LiveDriveThumb } from './FileThumb';
import { fileTypeLabel, hintNode, type FileViewMode } from './types';
import { EmptyState } from '../ui/Card';

const LIVE_DRAG = 'application/x-arkive-live-drive';

function isImageExtName(name: string) {
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i.test(name);
}

export function RecentList({
  items,
  onOpen,
}: {
  items: RecentItem[];
  onOpen: (ev: RecentItem) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="glass glass-hairline overflow-hidden rounded-2xl">
        <EmptyState icon={<Clock3 size={26} />} title="No recent activity" hint="Files you touch will show up here." />
      </div>
    );
  }

  return (
    <ul className="glass glass-hairline scroll-slim divide-y divide-white/4 overflow-hidden rounded-2xl">
      {items.map((ev) => {
        const name = ev.node_name || ev.action;
        const looksFolder = !name.includes('.') && ev.action.toLowerCase().includes('folder');
        const node = hintNode(name, looksFolder ? 'folder' : 'file', {
          id: ev.node_id || undefined,
        });
        const allowContent = !!ev.node_id && isImageExtName(name) && !looksFolder;

        return (
          <li key={ev.id}>
            <button
              type="button"
              className="group flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left text-sm transition-colors duration-150 hover:bg-white/[0.045]"
              onClick={() => onOpen(ev)}
            >
              <FileThumb node={node} size="sm" allowContent={allowContent} />
              <span className="min-w-0 flex-1 truncate font-medium">
                {name}
                <span className="ml-2 text-xs font-normal text-arkive-muted">{ev.action}</span>
              </span>
              <span className="shrink-0 text-xs text-arkive-muted">
                {new Date(ev.created_at).toLocaleString()}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function LiveDriveList({
  items,
  parent,
  dropTargetId,
  onUp,
  onOpen,
  onDropFiles,
  onMoveItem,
  onDragOverFolder,
  onDragLeaveFolder,
}: {
  items: LiveDriveItem[];
  parent: string;
  dropTargetId: string | null;
  onUp: () => void;
  onOpen: (item: LiveDriveItem) => void;
  onDropFiles: (files: FileList, parentId: string) => void;
  onMoveItem: (fileId: string, newParent: string) => void;
  onDragOverFolder: (id: string) => void;
  onDragLeaveFolder: () => void;
}) {
  function onDragStart(e: DragEvent, item: LiveDriveItem) {
    e.dataTransfer.setData(LIVE_DRAG, JSON.stringify({ id: item.id, parent }));
    e.dataTransfer.effectAllowed = 'move';
  }

  function folderDrop(e: DragEvent, folderId: string) {
    e.preventDefault();
    e.stopPropagation();
    onDragLeaveFolder();
    if (e.dataTransfer.files?.length) {
      onDropFiles(e.dataTransfer.files, folderId);
      return;
    }
    const raw = e.dataTransfer.getData(LIVE_DRAG);
    if (!raw) return;
    try {
      const { id } = JSON.parse(raw) as { id: string };
      if (id && id !== folderId) onMoveItem(id, folderId);
    } catch {
      /* ignore */
    }
  }

  return (
    <ul
      className="glass glass-hairline scroll-slim divide-y divide-white/4 overflow-hidden rounded-2xl"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(LIVE_DRAG)) {
          e.preventDefault();
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files?.length) onDropFiles(e.dataTransfer.files, parent);
      }}
    >
      {parent !== 'root' && (
        <li className="px-3 py-2 text-sm">
          <button
            type="button"
            className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-arkive-accent2 transition hover:bg-white/[0.06]"
            onClick={onUp}
          >
            <ArrowLeft size={14} /> Drive root
          </button>
        </li>
      )}
      {items.length === 0 && (
        <li>
          <EmptyState
            icon={<Cloud size={26} />}
            title="Nothing here yet"
            hint="Empty, or connect Google Drive in Account. Drop files here to upload."
          />
        </li>
      )}
      {items.map((item) => (
        <li
          key={item.id}
          draggable
          onDragStart={(e) => onDragStart(e, item)}
          onDragOver={(e) => {
            if (item.kind !== 'folder') return;
            e.preventDefault();
            e.stopPropagation();
            onDragOverFolder(item.id);
          }}
          onDragLeave={() => {
            if (item.kind === 'folder') onDragLeaveFolder();
          }}
          onDrop={(e) => {
            if (item.kind === 'folder') folderDrop(e, item.id);
          }}
          onClick={() => onOpen(item)}
          className={`flex cursor-pointer select-none items-center justify-between gap-3 px-4 py-3 text-sm transition-colors duration-150 hover:bg-white/[0.045] ${
            item.kind === 'folder' && dropTargetId === item.id
              ? 'bg-arkive-accent/12 ring-2 ring-inset ring-arkive-accent/80'
              : ''
          }`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3 text-left font-medium hover:text-arkive-accent2">
            <LiveDriveThumb item={item} size="sm" />
            <span className="truncate">{item.name}</span>
          </div>
          <span className="shrink-0 text-xs text-arkive-muted">
            {item.kind === 'folder' ? 'Folder' : formatBytes(item.size)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SharedBrowse({
  nodes,
  viewMode,
  onOpen,
}: {
  nodes: Node[];
  viewMode: FileViewMode;
  onOpen: (node: Node) => void;
}) {
  if (nodes.length === 0) {
    return (
      <div className="glass glass-hairline overflow-hidden rounded-2xl">
        <EmptyState
          icon={<Share2 size={26} />}
          title="Nothing shared with you yet"
          hint="When teammates share files or folders, they’ll appear here."
        />
      </div>
    );
  }

  if (viewMode === 'tiles') {
    return (
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {nodes.map((node) => (
          <li
            key={node.id}
            className="group cursor-pointer overflow-hidden rounded-2xl border border-white/7 bg-white/[0.03] backdrop-blur-md transition-all duration-200 hover:-translate-y-1 hover:border-white/14 hover:shadow-[0_16px_40px_rgba(3,4,12,0.55),0_0_24px_rgba(139,92,246,0.12)]"
          >
            <button
              type="button"
              className="flex w-full cursor-pointer flex-col text-left"
              onClick={() => onOpen(node)}
            >
              <div className="aspect-square overflow-hidden bg-gradient-to-b from-white/[0.05] to-transparent">
                <div className="h-full w-full transition-transform duration-300 ease-out group-hover:scale-[1.04]">
                  <FileThumb node={node} size="lg" />
                </div>
              </div>
              <div className="truncate px-3 pt-2 text-sm font-medium">{node.name}</div>
              <div className="px-3 pb-2.5 pt-0.5 text-xs text-arkive-muted">
                {node.kind === 'file' ? formatBytes(node.size) : 'Folder'}
              </div>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  if (viewMode === 'details') {
    return (
      <div className="glass glass-hairline scroll-slim overflow-hidden rounded-2xl">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/6 bg-white/[0.02] text-[11px] font-semibold uppercase tracking-[0.12em] text-arkive-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">Size</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">Type</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/4">
            {nodes.map((node) => (
              <tr
                key={node.id}
                className="group cursor-pointer transition-colors duration-150 hover:bg-white/[0.045]"
                onClick={() => onOpen(node)}
              >
                <td className="px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2 text-left">
                    <FileThumb node={node} size="sm" />
                    <span className="truncate font-medium">{node.name}</span>
                  </div>
                </td>
                <td className="hidden px-3 py-2 text-arkive-muted sm:table-cell">
                  {node.kind === 'file' ? formatBytes(node.size) : '—'}
                </td>
                <td className="hidden px-3 py-2 text-arkive-muted md:table-cell">
                  {fileTypeLabel(node)}
                </td>
                <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                  {node.kind === 'file' && (
                    <a
                      href={downloadUrl(node.id)}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-arkive-accent2 transition hover:bg-white/[0.07]"
                    >
                      <Download size={13} /> Download
                    </a>
                  )}
                  {node.kind === 'file' && isPreviewable(node) && (
                    <button
                      type="button"
                      className="ml-1 inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-arkive-muted transition hover:bg-white/[0.07] hover:text-arkive-text"
                      onClick={() => onOpen(node)}
                    >
                      <Eye size={13} /> Preview
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <ul className="glass glass-hairline scroll-slim divide-y divide-white/4 overflow-hidden rounded-2xl">
      {nodes.map((node) => (
        <li
          key={node.id}
          className="group flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-white/[0.045]"
          onClick={() => onOpen(node)}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <FileThumb node={node} size="sm" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{node.name}</span>
              <span className="text-xs text-arkive-muted">
                {node.kind === 'file' ? formatBytes(node.size) : 'Folder'}
              </span>
            </span>
          </div>
          {node.kind === 'file' && (
            <a
              href={downloadUrl(node.id)}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-arkive-accent2 opacity-0 transition group-hover:opacity-100 hover:bg-white/[0.07]"
              onClick={(e) => e.stopPropagation()}
            >
              <Download size={13} /> Download
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
