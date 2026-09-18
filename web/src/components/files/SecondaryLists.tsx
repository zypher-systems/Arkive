import type { DragEvent } from 'react';
import {
  downloadUrl,
  formatBytes,
  isPreviewable,
  type LiveDriveItem,
  type Node,
  type RecentItem,
} from '../../lib/api';
import {
  ArrowLeftIcon,
  CloudIcon,
  ClockIcon,
  DownloadIcon,
  PreviewIcon,
  ShareIcon,
} from '../icons';
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
      <div className="panel overflow-hidden">
        <EmptyState icon={<ClockIcon size={18} />} title="No recent activity" hint="Files you touch will show up here." />
      </div>
    );
  }

  return (
    <ul className="panel scroll-slim divide-y divide-line overflow-hidden">
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
              className="group flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-hover"
              onClick={() => onOpen(ev)}
            >
              <FileThumb node={node} size="sm" allowContent={allowContent} />
              <span className="min-w-0 flex-1 truncate font-medium">
                {name}
                <span className="ml-2 text-xs font-normal text-muted">{ev.action}</span>
              </span>
              <span className="shrink-0 text-xs text-muted">
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
      className="panel scroll-slim divide-y divide-line overflow-hidden"
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
        <li className="px-2 py-1.5 text-sm">
          <button
            type="button"
            className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-accent-strong transition hover:bg-hover"
            onClick={onUp}
          >
            <ArrowLeftIcon size={14} /> Drive root
          </button>
        </li>
      )}
      {items.length === 0 && (
        <li>
          <EmptyState
            icon={<CloudIcon size={18} />}
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
          className={`flex cursor-pointer select-none items-center justify-between gap-3 px-3 py-2 text-sm transition-colors duration-150 hover:bg-hover ${
            item.kind === 'folder' && dropTargetId === item.id
              ? 'bg-accent-soft shadow-[inset_0_0_0_2px_var(--accent)]'
              : ''
          }`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3 text-left font-medium">
            <LiveDriveThumb item={item} size="sm" />
            <span className="truncate">{item.name}</span>
          </div>
          <span className="shrink-0 text-xs text-muted">
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
      <div className="panel overflow-hidden">
        <EmptyState
          icon={<ShareIcon size={18} />}
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
            className="cursor-pointer overflow-hidden rounded-lg border border-line bg-surface shadow-xs transition-colors hover:border-strong"
          >
            <button
              type="button"
              className="flex w-full cursor-pointer flex-col text-left"
              onClick={() => onOpen(node)}
            >
              <div className="aspect-square overflow-hidden border-b border-line bg-inset">
                <FileThumb node={node} size="lg" />
              </div>
              <div className="truncate px-3 pt-2 text-sm font-medium">{node.name}</div>
              <div className="px-3 pb-2.5 pt-0.5 text-xs text-muted">
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
      <div className="panel scroll-slim overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-inset text-[11px] font-semibold uppercase tracking-wide text-faint">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="hidden px-3 py-2 sm:table-cell">Size</th>
              <th className="hidden px-3 py-2 md:table-cell">Type</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {nodes.map((node) => (
              <tr
                key={node.id}
                className="group cursor-pointer transition-colors duration-150 hover:bg-hover"
                onClick={() => onOpen(node)}
              >
                <td className="px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2 text-left">
                    <FileThumb node={node} size="sm" />
                    <span className="truncate font-medium">{node.name}</span>
                  </div>
                </td>
                <td className="hidden px-3 py-2 text-muted sm:table-cell">
                  {node.kind === 'file' ? formatBytes(node.size) : '—'}
                </td>
                <td className="hidden px-3 py-2 text-muted md:table-cell">
                  {fileTypeLabel(node)}
                </td>
                <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                  {node.kind === 'file' && (
                    <a
                      href={downloadUrl(node.id)}
                      className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs font-medium text-accent-strong transition hover:bg-hover"
                    >
                      <DownloadIcon size={13} /> Download
                    </a>
                  )}
                  {node.kind === 'file' && isPreviewable(node) && (
                    <button
                      type="button"
                      className="ml-1 inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs font-medium text-muted transition hover:bg-hover hover:text-ink"
                      onClick={() => onOpen(node)}
                    >
                      <PreviewIcon size={13} /> Preview
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
    <ul className="panel scroll-slim divide-y divide-line overflow-hidden">
      {nodes.map((node) => (
        <li
          key={node.id}
          className="group flex cursor-pointer flex-wrap items-center gap-3 px-3 py-2 transition-colors duration-150 hover:bg-hover"
          onClick={() => onOpen(node)}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <FileThumb node={node} size="sm" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{node.name}</span>
              <span className="text-xs text-muted">
                {node.kind === 'file' ? formatBytes(node.size) : 'Folder'}
              </span>
            </span>
          </div>
          {node.kind === 'file' && (
            <a
              href={downloadUrl(node.id)}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs font-medium text-accent-strong opacity-0 transition group-hover:opacity-100 hover:bg-hover"
              onClick={(e) => e.stopPropagation()}
            >
              <DownloadIcon size={13} /> Download
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
