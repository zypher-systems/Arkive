import { useRef, type MouseEvent as ReactMouseEvent, type DragEvent, type KeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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

const LIST_ROW_ESTIMATE = 64;
const DETAILS_ROW_ESTIMATE = 48;
const TILE_ROW_ESTIMATE = 220;

export function FileListView({
  nodes,
  results,
  handlers: h,
}: {
  nodes: Node[];
  results: boolean;
  handlers: FileViewHandlers;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: nodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => LIST_ROW_ESTIMATE,
    overscan: 8,
  });

  if (nodes.length === 0) {
    return (
      <ul className="flex min-h-full flex-1 flex-col divide-y divide-arkive-border overflow-hidden rounded-2xl border border-arkive-border bg-arkive-surface/70">
        <li className="flex flex-1 items-center justify-center px-4 py-10 text-center text-sm text-arkive-muted">
          {results
            ? 'No matches.'
            : 'This folder is empty. Right-click for New file / New folder, or drop files here.'}
        </li>
      </ul>
    );
  }

  return (
    <div
      ref={parentRef}
      className="min-h-full flex-1 overflow-auto rounded-2xl border border-arkive-border bg-arkive-surface/70"
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const node = nodes[item.index];
          return (
            <div
              key={node.id}
              data-file-row
              data-index={item.index}
              ref={virtualizer.measureElement}
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
              className={`absolute left-0 top-0 flex w-full cursor-pointer select-none flex-wrap items-center gap-3 border-b border-arkive-border px-4 py-3 hover:bg-arkive-panel/40 ${
                h.selected.has(node.id) ? 'bg-arkive-amber/5' : ''
              } ${dropClass(node, h.dropTargetId)}`}
              style={{ transform: `translateY(${item.start}px)` }}
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
            </div>
          );
        })}
      </div>
    </div>
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
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: nodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => DETAILS_ROW_ESTIMATE,
    overscan: 10,
  });

  if (nodes.length === 0) {
    return (
      <div className="min-h-full flex-1 overflow-hidden rounded-2xl border border-arkive-border bg-arkive-surface/70">
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
          <tbody>
            <tr className="h-48">
              <td
                colSpan={6}
                className="px-4 py-10 text-center align-middle text-sm text-arkive-muted"
              >
                {results
                  ? 'No matches.'
                  : 'This folder is empty. Right-click for New file / New folder.'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col overflow-hidden rounded-2xl border border-arkive-border bg-arkive-surface/70">
      <div className="border-b border-arkive-border text-xs uppercase tracking-wider text-arkive-muted">
        <div className="flex w-full text-left">
          {!results && <div className="w-10 shrink-0 px-3 py-2" />}
          <div className="min-w-0 flex-1 px-3 py-2 font-medium">Name</div>
          <div className="hidden w-24 shrink-0 px-3 py-2 font-medium sm:block">Size</div>
          <div className="hidden w-44 shrink-0 px-3 py-2 font-medium md:block">Modified</div>
          <div className="hidden w-20 shrink-0 px-3 py-2 font-medium lg:block">Type</div>
          <div className="w-48 shrink-0 px-3 py-2 font-medium" />
        </div>
      </div>
      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
        <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((item) => {
            const node = nodes[item.index];
            return (
              <div
                key={node.id}
                data-file-row
                data-index={item.index}
                ref={virtualizer.measureElement}
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
                className={`absolute left-0 top-0 flex w-full cursor-pointer select-none border-b border-arkive-border text-sm hover:bg-arkive-panel/40 ${
                  h.selected.has(node.id) ? 'bg-arkive-amber/5' : ''
                } ${dropClass(node, h.dropTargetId)}`}
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {!results && (
                  <div
                    className="flex w-10 shrink-0 items-center px-3 py-2"
                    data-no-row-open
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={h.selected.has(node.id)}
                      onChange={() => undefined}
                      onClick={(e) => h.onToggleSelect(node.id, e)}
                      className="h-4 w-4 cursor-pointer accent-arkive-amber"
                    />
                  </div>
                )}
                <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left">
                  <span data-drag-thumb className="shrink-0">
                    <FileThumb node={node} size="sm" />
                  </span>
                  <span className="truncate font-medium">{node.name}</span>
                </div>
                <div className="hidden w-24 shrink-0 px-3 py-2 text-arkive-muted sm:block">
                  {node.kind === 'file' ? formatBytes(node.size) : '—'}
                </div>
                <div className="hidden w-44 shrink-0 px-3 py-2 text-arkive-muted md:block">
                  {new Date(node.updated_at).toLocaleString()}
                </div>
                <div className="hidden w-20 shrink-0 px-3 py-2 text-arkive-muted lg:block">
                  {fileTypeLabel(node)}
                </div>
                <div className="w-48 shrink-0 px-3 py-2 text-right">
                  <RowActions node={node} h={h} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
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
  const parentRef = useRef<HTMLDivElement>(null);
  const cols = 4;
  const rowCount = Math.ceil(nodes.length / cols);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => TILE_ROW_ESTIMATE,
    overscan: 4,
  });

  if (nodes.length === 0) {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <p className="flex flex-1 items-center justify-center rounded-2xl border border-arkive-border px-4 py-10 text-center text-sm text-arkive-muted">
          {results
            ? 'No matches.'
            : 'This folder is empty. Right-click for New file / New folder, or drop files here.'}
        </p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="min-h-full flex-1 overflow-auto">
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((item) => {
          const start = item.index * cols;
          const rowNodes = nodes.slice(start, start + cols);
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 grid w-full grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {rowNodes.map((node) => (
                <div
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
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
