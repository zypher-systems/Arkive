import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Node } from '../../lib/api';
import type { Selection } from '../../pages/browser/useSelection';
import { useElementWidth, useLongPress } from '../../lib/useElementSize';
import { useI18n } from '../../i18n';
import { MoreIcon } from '../icons';
import { FileThumb } from './FileThumb';
import type { RowDnD } from './FileList';
import { fileCategory } from './types';

type Props = {
  nodes: Node[];
  mode: 'tiles' | 'gallery';
  scrollRef: RefObject<HTMLDivElement | null>;
  selection: Selection;
  label: string;
  onOpen: (n: Node) => void;
  onMenu: (n: Node, at: { x: number; y: number } | HTMLElement) => void;
  dnd?: RowDnD;
  selectable?: boolean;
  emptyState?: ReactNode;
  /** Reports the number of columns so arrow keys can move by rows. */
  onColumns?: (n: number) => void;
};

const GAP = { tiles: 12, gallery: 6 };
const MIN = { tiles: 168, gallery: 180 };

export function FileGrid({
  nodes,
  mode,
  scrollRef,
  selection,
  label,
  onOpen,
  onMenu,
  dnd,
  selectable = true,
  emptyState,
  onColumns,
}: Props) {
  const { t, formatBytes, formatModified } = useI18n();
  const bodyRef = useRef<HTMLDivElement>(null);
  const scWidth = useElementWidth(scrollRef);
  const width = Math.max(0, (bodyRef.current?.clientWidth || scWidth || 800));
  const minCol = scWidth < 480 ? (mode === 'gallery' ? 104 : 148) : MIN[mode];
  const gap = GAP[mode];
  const cols = Math.max(2, Math.floor((width + gap) / (minCol + gap)));
  const colW = (width - gap * (cols - 1)) / cols;
  const rowH = mode === 'gallery' ? colW + gap : colW * 0.78 + 58 + gap;
  const rows = Math.ceil(nodes.length / cols);
  const [scrollMargin, setScrollMargin] = useState(0);
  const { selected, cursor } = selection;
  const selectionMode = selected.size > 0;
  const longPress = useLongPress((id) => selection.toggle(id));

  useEffect(() => onColumns?.(cols), [cols, onColumns]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    const sc = scrollRef.current;
    if (!body || !sc) return;
    const measure = () => {
      setScrollMargin(Math.round(body.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(sc);
    return () => ro.disconnect();
  }, [scrollRef]);

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH,
    overscan: 3,
    scrollMargin,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rowH, virtualizer]);

  useEffect(() => {
    if (!cursor) return;
    const idx = nodes.findIndex((n) => n.id === cursor);
    if (idx >= 0) virtualizer.scrollToIndex(Math.floor(idx / cols), { align: 'auto' });
  }, [cursor, nodes, cols, virtualizer]);

  return (
    <div
      ref={bodyRef}
      role="listbox"
      aria-label={label}
      aria-multiselectable={selectable || undefined}
      aria-activedescendant={cursor ? `row-${cursor}` : undefined}
      tabIndex={nodes.length ? 0 : -1}
      onFocus={(e) => {
        // Only keyboard focus seeds the cursor; a pointer focus is followed by its own click.
        if (!cursor && nodes[0] && e.target === e.currentTarget && e.currentTarget.matches(':focus-visible')) {
          selection.setCursor(nodes[0].id);
        }
      }}
      className="group/list relative outline-none"
      style={{ height: nodes.length ? virtualizer.getTotalSize() : undefined }}
    >
      {nodes.length === 0 && emptyState}
      {virtualizer.getVirtualItems().map((vr) => {
        const start = vr.index * cols;
        const rowNodes = nodes.slice(start, start + cols);
        return (
          <div
            key={vr.key}
            className="absolute top-0 left-0 grid w-full"
            style={{
              transform: `translateY(${vr.start - scrollMargin}px)`,
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gap,
            }}
          >
            {rowNodes.map((node) => {
              const isSel = selected.has(node.id);
              const isCursor = cursor === node.id;
              const isDrop = dnd?.dropTargetId === node.id && node.kind === 'folder';
              const lp = longPress.bind(node.id);
              const onClick = (e: React.MouseEvent) => {
                if (longPress.fired.current) {
                  longPress.fired.current = false;
                  return;
                }
                const touch = longPress.lastPointer.current !== 'mouse';
                if (e.shiftKey || e.metaKey || e.ctrlKey) {
                  selection.select(node.id, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey });
                  return;
                }
                if (touch) {
                  if (selectionMode) selection.toggle(node.id);
                  else onOpen(node);
                  return;
                }
                if (mode === 'gallery' && !selectionMode) {
                  onOpen(node);
                  return;
                }
                selection.select(node.id);
              };
              const checkbox = selectable && (
                <span
                  data-no-open
                  className={`absolute top-2 left-2 z-10 rounded-[5px] shadow-sm transition-opacity ${
                    isSel || selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                >
                  <input
                    type="checkbox"
                    tabIndex={-1}
                    className="check !h-[18px] !w-[18px] bg-surface/90"
                    aria-label={t('files.selectItem', { name: node.name })}
                    checked={isSel}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => selection.toggle(node.id)}
                  />
                </span>
              );
              const more = (
                <button
                  type="button"
                  tabIndex={-1}
                  data-no-open
                  aria-label={t('files.moreFor', { name: node.name })}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMenu(node, e.currentTarget);
                  }}
                  className={`flex h-8 w-8 items-center justify-center rounded-md transition coarse:h-10 coarse:w-10 ${
                    mode === 'gallery'
                      ? 'bg-black/40 text-white hover:bg-black/60 coarse:hidden'
                      : 'text-muted hover:bg-active hover:text-ink coarse:opacity-100'
                  } opacity-0 group-hover:opacity-100 ${isSel ? '!opacity-100' : ''}`}
                >
                  <MoreIcon size={16} />
                </button>
              );
              const common = {
                id: `row-${node.id}`,
                role: 'option' as const,
                'aria-selected': isSel,
                'aria-label': node.name,
                'data-file-row': true,
                draggable: dnd?.draggable,
                onDragStart: dnd ? (e: React.DragEvent) => dnd.onDragStart(e, node) : undefined,
                onDragEnd: dnd?.onDragEnd,
                onDragOver: dnd ? (e: React.DragEvent) => dnd.onDragOver(e, node) : undefined,
                onDragLeave: dnd ? () => dnd.onDragLeave(node) : undefined,
                onDrop: dnd ? (e: React.DragEvent) => dnd.onDrop(e, node) : undefined,
                ...lp,
                onClick,
                onDoubleClick: (e: React.MouseEvent) => {
                  if ((e.target as HTMLElement).closest('[data-no-open]')) return;
                  onOpen(node);
                },
                onContextMenu: (e: React.MouseEvent) => {
                  lp.onContextMenu(e);
                  if (longPress.lastPointer.current !== 'mouse') return;
                  e.preventDefault();
                  if (!isSel) selection.select(node.id);
                  onMenu(node, { x: e.clientX, y: e.clientY });
                },
              };

              if (mode === 'gallery') {
                return (
                  <div
                    key={node.id}
                    {...common}
                    className={`group relative cursor-pointer overflow-hidden rounded-lg bg-inset select-none ${
                      isDrop ? 'ring-2 ring-accent' : isSel ? 'ring-[3px] ring-accent' : ''
                    } ${isCursor ? 'group-focus-visible/list:ring-2 group-focus-visible/list:ring-accent group-focus-visible/list:ring-offset-2 group-focus-visible/list:ring-offset-surface' : ''}`}
                    style={{ height: colW }}
                  >
                    <span data-drag-thumb className="block h-full w-full">
                      <FileThumb node={node} fill />
                    </span>
                    {checkbox}
                    {node.kind === 'folder' || fileCategory(node.name, node.mime) !== 'image' ? (
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-2.5 pb-2.5 text-center">
                        <p className="truncate text-sm font-medium text-ink">{node.name}</p>
                      </div>
                    ) : (
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 via-black/20 to-transparent px-2.5 pt-6 pb-2 opacity-0 transition-opacity group-hover:opacity-100 coarse:opacity-100">
                        <p className="truncate text-xs font-medium text-white">{node.name}</p>
                      </div>
                    )}
                    <div className="absolute top-1.5 right-1.5">{more}</div>
                    {isSel && <span className="pointer-events-none absolute inset-0 bg-accent/10" />}
                  </div>
                );
              }

              return (
                <div
                  key={node.id}
                  {...common}
                  className={`group relative flex cursor-default flex-col overflow-hidden rounded-xl border bg-surface select-none transition-[border-color,box-shadow] ${
                    isDrop
                      ? 'border-accent ring-2 ring-accent'
                      : isSel
                        ? 'border-accent ring-1 ring-accent'
                        : 'border-line hover:border-strong hover:shadow-sm'
                  } ${isCursor ? 'group-focus-visible/list:ring-2 group-focus-visible/list:ring-accent group-focus-visible/list:ring-offset-2 group-focus-visible/list:ring-offset-surface' : ''}`}
                  style={{ height: rowH - gap }}
                >
                  <span data-drag-thumb className="block min-h-0 flex-1 border-b border-line">
                    <FileThumb node={node} fill />
                  </span>
                  {checkbox}
                  <div className="flex h-[58px] shrink-0 items-center gap-1 pr-1 pl-3">
                    <div className="min-w-0 flex-1">
                      <p
                        data-open
                        onClick={(e) => {
                          if (!e.shiftKey && !e.metaKey && !e.ctrlKey && longPress.lastPointer.current === 'mouse') {
                            e.stopPropagation();
                            onOpen(node);
                          }
                        }}
                        title={node.name}
                        className="cursor-pointer truncate text-sm font-medium text-ink hover:underline"
                      >
                        {node.name}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {node.kind === 'folder'
                          ? t('files.folder')
                          : `${formatBytes(node.size)} · ${formatModified(node.updated_at)}`}
                      </p>
                    </div>
                    {more}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
