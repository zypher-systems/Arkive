import type { DragEvent } from 'react';
import {
  downloadUrl,
  formatBytes,
  isPreviewable,
  type LiveDriveItem,
  type Node,
  type RecentItem,
} from '../../lib/api';
import { FileThumb, LiveDriveThumb } from './FileThumb';
import { fileTypeLabel, hintNode, type FileViewMode } from './types';

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
      <ul className="overflow-hidden rounded-2xl border border-arkive-border bg-arkive-surface/70">
        <li className="px-4 py-10 text-center text-sm text-arkive-muted">No recent activity.</li>
      </ul>
    );
  }

  return (
    <ul className="divide-y divide-arkive-border overflow-hidden rounded-2xl border border-arkive-border bg-arkive-surface/70">
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
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-arkive-panel/40"
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
      className="divide-y divide-arkive-border overflow-hidden rounded-2xl border border-arkive-border bg-arkive-surface/70"
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
        <li className="px-4 py-2 text-sm">
          <button type="button" className="text-arkive-amber hover:underline" onClick={onUp}>
            ← Drive root
          </button>
        </li>
      )}
      {items.length === 0 && (
        <li className="px-4 py-10 text-center text-sm text-arkive-muted">
          Empty, or connect Google Drive in Account. Drop files here to upload.
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
          className={`flex items-center justify-between gap-3 px-4 py-3 text-sm ${
            item.kind === 'folder' && dropTargetId === item.id
              ? 'ring-2 ring-inset ring-arkive-amber/70 bg-arkive-amber/10'
              : ''
          }`}
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 text-left font-medium hover:text-arkive-amber"
            onClick={() => onOpen(item)}
          >
            <LiveDriveThumb item={item} size="sm" />
            <span className="truncate">{item.name}</span>
          </button>
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
      <ul className="overflow-hidden rounded-2xl border border-arkive-border bg-arkive-surface/70">
        <li className="px-4 py-10 text-center text-sm text-arkive-muted">
          Nothing shared with you yet.
        </li>
      </ul>
    );
  }

  if (viewMode === 'tiles') {
    return (
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {nodes.map((node) => (
          <li
            key={node.id}
            className="overflow-hidden rounded-xl border border-arkive-border bg-arkive-surface/70 transition hover:border-arkive-amber/40"
          >
            <button
              type="button"
              className="flex w-full flex-col text-left"
              onClick={() => onOpen(node)}
            >
              <div className="aspect-square overflow-hidden bg-arkive-panel/40">
                <FileThumb node={node} size="lg" />
              </div>
              <div className="truncate px-2 py-2 text-sm font-medium">{node.name}</div>
              <div className="px-2 pb-2 text-xs text-arkive-muted">
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
      <div className="overflow-hidden rounded-2xl border border-arkive-border bg-arkive-surface/70">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-arkive-border text-xs uppercase tracking-wider text-arkive-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">Size</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">Type</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-arkive-border">
            {nodes.map((node) => (
              <tr key={node.id} className="hover:bg-arkive-panel/40">
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-2 text-left"
                    onClick={() => onOpen(node)}
                  >
                    <FileThumb node={node} size="sm" />
                    <span className="truncate font-medium">{node.name}</span>
                  </button>
                </td>
                <td className="hidden px-3 py-2 text-arkive-muted sm:table-cell">
                  {node.kind === 'file' ? formatBytes(node.size) : '—'}
                </td>
                <td className="hidden px-3 py-2 text-arkive-muted md:table-cell">
                  {fileTypeLabel(node)}
                </td>
                <td className="px-3 py-2 text-right">
                  {node.kind === 'file' && (
                    <a
                      href={downloadUrl(node.id)}
                      className="text-xs text-arkive-amber hover:underline"
                    >
                      Download
                    </a>
                  )}
                  {node.kind === 'file' && isPreviewable(node) && (
                    <button
                      type="button"
                      className="ml-2 text-xs text-arkive-muted hover:text-arkive-text"
                      onClick={() => onOpen(node)}
                    >
                      Preview
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
    <ul className="divide-y divide-arkive-border overflow-hidden rounded-2xl border border-arkive-border bg-arkive-surface/70">
      {nodes.map((node) => (
        <li
          key={node.id}
          className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-arkive-panel/40"
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            onClick={() => onOpen(node)}
          >
            <FileThumb node={node} size="sm" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{node.name}</span>
              <span className="text-xs text-arkive-muted">
                {node.kind === 'file' ? formatBytes(node.size) : 'Folder'}
              </span>
            </span>
          </button>
          {node.kind === 'file' && (
            <a
              href={downloadUrl(node.id)}
              className="shrink-0 text-xs text-arkive-amber hover:underline"
            >
              Download
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
