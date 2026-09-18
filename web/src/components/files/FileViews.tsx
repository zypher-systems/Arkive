import { useRef, type MouseEvent as ReactMouseEvent, type DragEvent, type KeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  FolderOpenIcon,
  HistoryIcon,
  PencilIcon,
  PreviewIcon,
  SearchIcon,
  ShareIcon,
  TrashIcon,
} from '../icons';
import { formatBytes, isPreviewable, type Node } from '../../lib/api';
import { fileTypeLabel } from './types';
import { FileThumb } from './FileThumb';
import { IconButton } from '../ui/Button';
import { EmptyState } from '../ui/Card';

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
    ? 'bg-accent-soft shadow-[inset_0_0_0_2px_var(--accent)]'
    : '';
}

function selectedClass(selected: boolean) {
  return selected
    ? 'bg-accent-soft shadow-[inset_2px_0_0_var(--accent)]'
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
    <div
      data-no-row-open
      className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {node.kind === 'file' && isPreviewable(node) && (
        <IconButton label="Preview" onClick={() => h.onPreview(node)}>
          <PreviewIcon size={14} />
        </IconButton>
      )}
      {node.kind === 'file' && (
        <IconButton label="History" onClick={() => h.onHistory(node)}>
          <HistoryIcon size={14} />
        </IconButton>
      )}
      <IconButton label="Share" onClick={() => h.onShare(node)}>
        <ShareIcon size={14} />
      </IconButton>
      <IconButton label="Rename" onClick={() => h.onRename(node)}>
        <PencilIcon size={14} />
      </IconButton>
      <IconButton
        label="Delete"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          h.onDelete(node);
        }}
        className="hover:!bg-danger-soft hover:!text-danger"
      >
        <TrashIcon size={14} />
      </IconButton>
    </div>
  );
}

function isRowOpenTarget(target: EventTarget | null) {
  return !(target instanceof Element && target.closest('[data-no-row-open]'));
}

function EmptyPane({ results }: { results: boolean }) {
  return results ? (
    <EmptyState icon={<SearchIcon size={18} />} title="No matches" hint="Try a different search term." />
  ) : (
    <EmptyState
      icon={<FolderOpenIcon size={18} />}
      title="This folder is empty"
      hint="Right-click for New file / New folder, or drop files anywhere to upload."
    />
  );
}

const LIST_ROW_ESTIMATE = 60;
const DETAILS_ROW_ESTIMATE = 44;
const TILE_ROW_ESTIMATE = 216;

function EmptyShell({ results }: { results: boolean }) {
  return (
    <div className="panel flex min-h-full flex-1 flex-col overflow-hidden">
      <EmptyPane results={results} />
    </div>
  );
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
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: nodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => LIST_ROW_ESTIMATE,
    overscan: 8,
  });

  if (nodes.length === 0) {
    return <EmptyShell results={results} />;
  }

  return (
    <div
      ref={parentRef}
      className="panel scroll-slim min-h-full flex-1 overflow-auto"
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
                if (e.shiftKey || e.ctrlKey || e.metaKey) {
                  h.onToggleSelect(node.id, e);
                  return;
                }
                if (isRowOpenTarget(e.target)) h.onOpen(node);
              }}
              onKeyDown={(e) => rowOpenKey(e, node, h.onOpen)}
              tabIndex={0}
              className={`group absolute left-0 top-0 flex w-full cursor-pointer select-none flex-wrap items-center gap-3 border-b border-line px-3 py-2 transition-colors duration-150 last:border-b-0 hover:bg-hover ${selectedClass(
                h.selected.has(node.id),
              )} ${dropClass(node, h.dropTargetId)}`}
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
                  className="cursor-pointer"
                />
              )}
              <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span data-drag-thumb className="shrink-0">
                  <FileThumb node={node} size="sm" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{node.name}</span>
                  <span className="text-xs text-muted">
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
      <div className="panel flex min-h-full flex-1 flex-col overflow-hidden">
        <div className="border-b border-line text-[11px] font-semibold tracking-wide text-faint uppercase">
          <div className="flex w-full text-left">
            {!results && <div className="w-9 shrink-0 px-3 py-2" />}
            <div className="min-w-0 flex-1 px-3 py-2">Name</div>
            <div className="hidden w-24 shrink-0 px-3 py-2 sm:block">Size</div>
            <div className="hidden w-44 shrink-0 px-3 py-2 md:block">Modified</div>
            <div className="hidden w-20 shrink-0 px-3 py-2 lg:block">Type</div>
            <div className="w-40 shrink-0 px-3 py-2" />
          </div>
        </div>
        <EmptyPane results={results} />
      </div>
    );
  }

  return (
    <div className="panel flex min-h-full flex-1 flex-col overflow-hidden">
      <div className="border-b border-line bg-inset text-[11px] font-semibold tracking-wide text-faint uppercase">
        <div className="flex w-full text-left">
          {!results && <div className="w-9 shrink-0 px-3 py-2" />}
          <div className="min-w-0 flex-1 px-3 py-2">Name</div>
          <div className="hidden w-24 shrink-0 px-3 py-2 sm:block">Size</div>
          <div className="hidden w-44 shrink-0 px-3 py-2 md:block">Modified</div>
          <div className="hidden w-20 shrink-0 px-3 py-2 lg:block">Type</div>
          <div className="w-40 shrink-0 px-3 py-2" />
        </div>
      </div>
      <div ref={parentRef} className="scroll-slim min-h-0 flex-1 overflow-auto">
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
                  if (e.shiftKey || e.ctrlKey || e.metaKey) {
                    h.onToggleSelect(node.id, e);
                    return;
                  }
                  if (isRowOpenTarget(e.target)) h.onOpen(node);
                }}
                className={`group absolute left-0 top-0 flex w-full cursor-pointer select-none border-b border-line text-sm transition-colors duration-150 last:border-b-0 hover:bg-hover ${selectedClass(
                  h.selected.has(node.id),
                )} ${dropClass(node, h.dropTargetId)}`}
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {!results && (
                  <div
                    className="flex w-9 shrink-0 items-center px-3 py-2"
                    data-no-row-open
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={h.selected.has(node.id)}
                      onChange={() => undefined}
                      onClick={(e) => h.onToggleSelect(node.id, e)}
                      className="cursor-pointer"
                    />
                  </div>
                )}
                <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left">
                  <span data-drag-thumb className="shrink-0">
                    <FileThumb node={node} size="sm" />
                  </span>
                  <span className="truncate font-medium">{node.name}</span>
                </div>
                <div className="hidden w-24 shrink-0 px-3 py-2 text-muted sm:block">
                  {node.kind === 'file' ? formatBytes(node.size) : '—'}
                </div>
                <div className="hidden w-44 shrink-0 px-3 py-2 text-muted md:block">
                  {new Date(node.updated_at).toLocaleString()}
                </div>
                <div className="hidden w-20 shrink-0 px-3 py-2 text-muted lg:block">
                  {fileTypeLabel(node)}
                </div>
                <div className="flex w-40 shrink-0 items-center justify-end px-3 py-2">
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
    return <EmptyShell results={results} />;
  }

  return (
    <div ref={parentRef} className="scroll-slim min-h-full flex-1 overflow-auto">
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
                    if (e.shiftKey || e.ctrlKey || e.metaKey) {
                      h.onToggleSelect(node.id, e);
                      return;
                    }
                    if (isRowOpenTarget(e.target)) h.onOpen(node);
                  }}
                  onKeyDown={(e) => rowOpenKey(e, node, h.onOpen)}
                  tabIndex={0}
                  className={`group relative cursor-pointer select-none overflow-hidden rounded-lg border border-line bg-surface shadow-xs transition-colors duration-150 hover:border-strong ${
                    h.selected.has(node.id)
                      ? 'border-accent bg-accent-soft shadow-[inset_0_0_0_1px_var(--accent)]'
                      : ''
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
                      className="absolute left-2.5 top-2.5 z-10 cursor-pointer"
                    />
                  )}
                  <div className="flex w-full flex-col text-left">
                    <div
                      data-drag-thumb
                      className="aspect-square overflow-hidden border-b border-line bg-inset"
                    >
                      <FileThumb node={node} size="lg" />
                    </div>
                    <div className="truncate px-3 pt-2 text-sm font-medium">{node.name}</div>
                    <div className="px-3 pb-2.5 pt-0.5 text-xs text-muted">
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
