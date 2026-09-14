import { useRef, type MouseEvent as ReactMouseEvent, type DragEvent, type KeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Eye,
  FolderOpen,
  History,
  Pencil,
  SearchX,
  Share2,
  Trash2,
} from 'lucide-react';
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
    ? 'ring-2 ring-inset ring-arkive-accent/80 bg-arkive-accent/12 shadow-[inset_0_0_24px_rgba(139,92,246,0.18)]'
    : '';
}

function selectedClass(selected: boolean) {
  return selected
    ? 'bg-arkive-accent/10 shadow-[inset_2px_0_0_rgba(139,92,246,0.9),inset_0_0_0_1px_rgba(139,92,246,0.18)]'
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
          <Eye size={14} />
        </IconButton>
      )}
      {node.kind === 'file' && (
        <IconButton label="History" onClick={() => h.onHistory(node)}>
          <History size={14} />
        </IconButton>
      )}
      <IconButton label="Share" onClick={() => h.onShare(node)}>
        <Share2 size={14} />
      </IconButton>
      <IconButton label="Rename" onClick={() => h.onRename(node)}>
        <Pencil size={14} />
      </IconButton>
      <IconButton
        label="Delete"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          h.onDelete(node);
        }}
        className="hover:!bg-red-500/15 hover:!text-red-300"
      >
        <Trash2 size={14} />
      </IconButton>
    </div>
  );
}

function isRowOpenTarget(target: EventTarget | null) {
  return !(target instanceof Element && target.closest('[data-no-row-open]'));
}

function EmptyPane({ results }: { results: boolean }) {
  return results ? (
    <EmptyState icon={<SearchX size={26} />} title="No matches" hint="Try a different search term." />
  ) : (
    <EmptyState
      icon={<FolderOpen size={26} />}
      title="This folder is empty"
      hint="Right-click for New file / New folder, or drop files anywhere to upload."
    />
  );
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
      <div className="glass glass-hairline flex min-h-full flex-1 flex-col overflow-hidden rounded-2xl">
        <EmptyPane results={results} />
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="glass glass-hairline scroll-slim min-h-full flex-1 overflow-auto rounded-2xl"
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
              className={`group absolute left-0 top-0 flex w-full cursor-pointer select-none flex-wrap items-center gap-3 border-b border-white/4 px-4 py-3 transition-colors duration-150 hover:bg-white/[0.045] ${selectedClass(
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
                  className="h-4 w-4 cursor-pointer accent-arkive-accent"
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
      <div className="glass glass-hairline flex min-h-full flex-1 flex-col overflow-hidden rounded-2xl">
        <div className="border-b border-white/5 text-xs tracking-wider text-arkive-muted uppercase">
          <div className="flex w-full text-left">
            {!results && <div className="w-10 shrink-0 px-3 py-2.5" />}
            <div className="min-w-0 flex-1 px-3 py-2.5 font-medium">Name</div>
            <div className="hidden w-24 shrink-0 px-3 py-2.5 font-medium sm:block">Size</div>
            <div className="hidden w-44 shrink-0 px-3 py-2.5 font-medium md:block">Modified</div>
            <div className="hidden w-20 shrink-0 px-3 py-2.5 font-medium lg:block">Type</div>
            <div className="w-40 shrink-0 px-3 py-2.5 font-medium" />
          </div>
        </div>
        <EmptyPane results={results} />
      </div>
    );
  }

  return (
    <div className="glass glass-hairline flex min-h-full flex-1 flex-col overflow-hidden rounded-2xl">
      <div className="border-b border-white/6 bg-white/[0.02] text-[11px] font-semibold tracking-[0.12em] text-arkive-muted uppercase">
        <div className="flex w-full text-left">
          {!results && <div className="w-10 shrink-0 px-3 py-2.5" />}
          <div className="min-w-0 flex-1 px-3 py-2.5">Name</div>
          <div className="hidden w-24 shrink-0 px-3 py-2.5 sm:block">Size</div>
          <div className="hidden w-44 shrink-0 px-3 py-2.5 md:block">Modified</div>
          <div className="hidden w-20 shrink-0 px-3 py-2.5 lg:block">Type</div>
          <div className="w-40 shrink-0 px-3 py-2.5" />
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
                className={`group absolute left-0 top-0 flex w-full cursor-pointer select-none border-b border-white/4 text-sm transition-colors duration-150 hover:bg-white/[0.045] ${selectedClass(
                  h.selected.has(node.id),
                )} ${dropClass(node, h.dropTargetId)}`}
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
                      className="h-4 w-4 cursor-pointer accent-arkive-accent"
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
    return (
      <div className="glass glass-hairline flex min-h-full flex-1 flex-col overflow-hidden rounded-2xl">
        <EmptyPane results={results} />
      </div>
    );
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
                  className={`group relative cursor-pointer select-none overflow-hidden rounded-2xl border border-white/7 bg-white/[0.03] backdrop-blur-md transition-all duration-200 hover:-translate-y-1 hover:border-white/14 hover:bg-white/[0.06] hover:shadow-[0_16px_40px_rgba(3,4,12,0.55),0_0_24px_rgba(139,92,246,0.12)] ${
                    h.selected.has(node.id)
                      ? 'border-arkive-accent/60 bg-arkive-accent/10 shadow-[0_0_0_1px_rgba(139,92,246,0.4),0_0_24px_rgba(139,92,246,0.2)]'
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
                      className="absolute left-2.5 top-2.5 z-10 h-4 w-4 cursor-pointer accent-arkive-accent"
                    />
                  )}
                  <div className="flex w-full flex-col text-left">
                    <div
                      data-drag-thumb
                      className="aspect-square overflow-hidden bg-gradient-to-b from-white/[0.05] to-transparent"
                    >
                      <div className="h-full w-full transition-transform duration-300 ease-out group-hover:scale-[1.04]">
                        <FileThumb node={node} size="lg" />
                      </div>
                    </div>
                    <div className="truncate px-3 pt-2 text-sm font-medium">{node.name}</div>
                    <div className="px-3 pb-2.5 pt-0.5 text-xs text-arkive-muted">
                      {node.kind === 'file' ? formatBytes(node.size) : 'Folder'}
                    </div>
                  </div>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
