import type { MouseEvent as ReactMouseEvent, DragEvent, KeyboardEvent } from 'react';
import { formatBytes, isPreviewable, type Node } from '../../lib/api';
import { fileTypeLabel } from './types';
import { FileThumb } from './FileThumb';

export type FileViewHandlers = {
  selected: Set<string>;
  dropTargetId: string | null;
  onToggleSelect: (id: string, e: ReactMouseEvent) => void;
  onOpen: (node: Node) => void;
  onPreview: (node: Node) => void;
  onHistory: (node: Node) => void;
  onShare: (node: Node) => void;
  onRename: (node: Node) => void;
  onDelete: (node: Node) => void;
  onContextMenu: (e: ReactMouseEvent, node: Node) => void;
  onDragStart: (e: DragEvent, node: Node) => void;
  onDragEnd: () => void;
  onDragOverFolder: (e: DragEvent, folder: Node) => void;
  onDragLeaveFolder: (folder: Node) => void;
  onDropOnFolder: (e: DragEvent, folder: Node) => void;
};

function dropClass(node: Node, dropTargetId: string | null) {
  return node.kind === 'folder' && dropTargetId === node.id
    ? 'ring-2 ring-arkive-amber/70 bg-arkive-amber/10'
    : '';
}

function rowOpenKey(e: KeyboardEvent, node: Node, open: (n: Node) => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    open(node);
  }
}

function RowActions({ node, h }: { node: Node; h: FileViewHandlers }) {
  return (
    <div data-no-row-open className="flex gap-1 text-xs" onMouseDown={(e) => e.stopPropagation()}>
      {node.kind === 'file' && isPreviewable(node) && (
        <button
          type="button"
          onClick={() => h.onPreview(node)}
          className="cursor-pointer rounded-md px-2 py-1 text-arkive-muted hover:bg-arkive-panel hover:text-arkive-text"
        >
          Preview
        </button>
      )}
      {node.kind === 'file' && (
        <button
          type="button"
          onClick={() => h.onHistory(node)}
          className="cursor-pointer rounded-md px-2 py-1 text-arkive-muted hover:bg-arkive-panel hover:text-arkive-text"
        >
          History
        </button>
      )}
      <button
        type="button"
        onClick={() => h.onShare(node)}
        className="cursor-pointer rounded-md px-2 py-1 text-arkive-muted hover:bg-arkive-panel hover:text-arkive-text"
      >
        Share
      </button>
      <button
        type="button"
        onClick={() => h.onRename(node)}
        className="cursor-pointer rounded-md px-2 py-1 text-arkive-muted hover:bg-arkive-panel hover:text-arkive-text"
      >
        Rename
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          h.onDelete(node);
        }}
        className="cursor-pointer rounded-md px-2 py-1 text-arkive-muted hover:bg-arkive-panel hover:text-red-300"
      >
        Delete
      </button>
    </div>
  );
}

function isRowOpenTarget(target: EventTarget | null) {
  return !(target instanceof Element && target.closest('[data-no-row-open]'));
}

export function FileListView({
  nodes,
  results,
  handlers: h,
}: {
  nodes: Node[];
  results: boolean;
  handlers: FileViewHandlers;
}) {
  return (
    <ul className="divide-y divide-arkive-border overflow-hidden rounded-2xl border border-arkive-border bg-arkive-surface/70">
      {nodes.map((node) => (
        <li
          key={node.id}
          data-file-row
          draggable={!results}
          onDragStart={(e) => h.onDragStart(e, node)}
          onDragEnd={h.onDragEnd}
          onDragOver={(e) => h.onDragOverFolder(e, node)}
          onDragLeave={() => h.onDragLeaveFolder(node)}
          onDrop={(e) => h.onDropOnFolder(e, node)}
          onContextMenu={(e) => h.onContextMenu(e, node)}
          onClick={(e) => {
            if (isRowOpenTarget(e.target)) h.onOpen(node);
          }}
          onKeyDown={(e) => rowOpenKey(e, node, h.onOpen)}
          tabIndex={0}
          className={`flex cursor-pointer select-none flex-wrap items-center gap-3 px-4 py-3 hover:bg-arkive-panel/40 ${
            h.selected.has(node.id) ? 'bg-arkive-amber/5' : ''
          } ${dropClass(node, h.dropTargetId)}`}
        >
          {!results && (
            <input
              data-no-row-open
              type="checkbox"
              checked={h.selected.has(node.id)}
              onChange={() => undefined}
              onClick={(e) => h.onToggleSelect(node.id, e)}
              onMouseDown={(e) => e.stopPropagation()}
              className="h-4 w-4 cursor-pointer accent-arkive-amber"
            />
          )}
          <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <span data-drag-thumb className="shrink-0">
              <FileThumb node={node} size="sm" />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{node.name}</span>
              <span className="text-xs text-arkive-muted">
                {node.kind === 'file' ? formatBytes(node.size) : 'Folder'}
              </span>
            </span>
          </div>
          <RowActions node={node} h={h} />
        </li>
      ))}
      {nodes.length === 0 && (
        <li className="px-4 py-10 text-center text-sm text-arkive-muted">
          {results ? 'No matches.' : 'This folder is empty. Drop files here or create a folder.'}
        </li>
      )}
    </ul>
  );
}

export function FileDetailsView({
  nodes,
  results,
  handlers: h,
}: {
  nodes: Node[];
  results: boolean;
  handlers: FileViewHandlers;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-arkive-border bg-arkive-surface/70">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-arkive-border text-xs uppercase tracking-wider text-arkive-muted">
          <tr>
            {!results && <th className="w-10 px-3 py-2" />}
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="hidden px-3 py-2 font-medium sm:table-cell">Size</th>
            <th className="hidden px-3 py-2 font-medium md:table-cell">Modified</th>
            <th className="hidden px-3 py-2 font-medium lg:table-cell">Type</th>
            <th className="px-3 py-2 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-arkive-border">
          {nodes.map((node) => (
            <tr
              key={node.id}
              data-file-row
              draggable={!results}
              onDragStart={(e) => h.onDragStart(e, node)}
              onDragEnd={h.onDragEnd}
              onDragOver={(e) => h.onDragOverFolder(e, node)}
              onDragLeave={() => h.onDragLeaveFolder(node)}
              onDrop={(e) => h.onDropOnFolder(e, node)}
              onContextMenu={(e) => h.onContextMenu(e, node)}
              onClick={(e) => {
                if (isRowOpenTarget(e.target)) h.onOpen(node);
              }}
              className={`cursor-pointer select-none hover:bg-arkive-panel/40 ${
                h.selected.has(node.id) ? 'bg-arkive-amber/5' : ''
              } ${dropClass(node, h.dropTargetId)}`}
            >
              {!results && (
                <td className="px-3 py-2" data-no-row-open onMouseDown={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={h.selected.has(node.id)}
                    onChange={() => undefined}
                    onClick={(e) => h.onToggleSelect(node.id, e)}
                    className="h-4 w-4 cursor-pointer accent-arkive-amber"
                  />
                </td>
              )}
              <td className="px-3 py-2">
                <div className="flex min-w-0 items-center gap-2 text-left">
                  <span data-drag-thumb className="shrink-0">
                    <FileThumb node={node} size="sm" />
                  </span>
                  <span className="truncate font-medium">{node.name}</span>
                </div>
              </td>
              <td className="hidden px-3 py-2 text-arkive-muted sm:table-cell">
                {node.kind === 'file' ? formatBytes(node.size) : '—'}
              </td>
              <td className="hidden px-3 py-2 text-arkive-muted md:table-cell">
                {new Date(node.updated_at).toLocaleString()}
              </td>
              <td className="hidden px-3 py-2 text-arkive-muted lg:table-cell">
                {fileTypeLabel(node)}
              </td>
              <td className="px-3 py-2 text-right">
                <RowActions node={node} h={h} />
              </td>
            </tr>
          ))}
          {nodes.length === 0 && (
            <tr>
              <td
                colSpan={6}
                className="px-4 py-10 text-center text-sm text-arkive-muted"
              >
                {results ? 'No matches.' : 'This folder is empty.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function FileTilesView({
  nodes,
  results,
  handlers: h,
}: {
  nodes: Node[];
  results: boolean;
  handlers: FileViewHandlers;
}) {
  return (
    <div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {nodes.map((node) => (
          <li
            key={node.id}
            data-file-row
            draggable={!results}
            onDragStart={(e) => h.onDragStart(e, node)}
            onDragEnd={h.onDragEnd}
            onDragOver={(e) => h.onDragOverFolder(e, node)}
            onDragLeave={() => h.onDragLeaveFolder(node)}
            onDrop={(e) => h.onDropOnFolder(e, node)}
            onContextMenu={(e) => h.onContextMenu(e, node)}
            onClick={(e) => {
              if (isRowOpenTarget(e.target)) h.onOpen(node);
            }}
            onKeyDown={(e) => rowOpenKey(e, node, h.onOpen)}
            tabIndex={0}
            className={`group relative cursor-pointer select-none overflow-hidden rounded-xl border border-arkive-border bg-arkive-surface/70 transition hover:border-arkive-amber/40 ${
              h.selected.has(node.id) ? 'border-arkive-amber/50 bg-arkive-amber/5' : ''
            } ${dropClass(node, h.dropTargetId)}`}
          >
            {!results && (
              <input
                data-no-row-open
                type="checkbox"
                checked={h.selected.has(node.id)}
                onChange={() => undefined}
                onClick={(e) => h.onToggleSelect(node.id, e)}
                onMouseDown={(e) => e.stopPropagation()}
                className="absolute left-2 top-2 z-10 h-4 w-4 cursor-pointer accent-arkive-amber"
              />
            )}
            <div className="flex w-full flex-col text-left">
              <div
                data-drag-thumb
                className="aspect-square overflow-hidden bg-arkive-panel/40"
              >
                <FileThumb node={node} size="lg" />
              </div>
              <div className="truncate px-2 py-2 text-sm font-medium">{node.name}</div>
              <div className="px-2 pb-2 text-xs text-arkive-muted">
                {node.kind === 'file' ? formatBytes(node.size) : 'Folder'}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {nodes.length === 0 && (
        <p className="rounded-2xl border border-arkive-border px-4 py-10 text-center text-sm text-arkive-muted">
          {results ? 'No matches.' : 'This folder is empty. Drop files here or create a folder.'}
        </p>
      )}
    </div>
  );
}
