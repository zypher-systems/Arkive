import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Node } from '../../lib/api';
import type { SortKey, SortSpec } from '../../lib/sort';
import type { Selection } from '../../pages/browser/useSelection';
import { useElementWidth, useLongPress } from '../../lib/useElementSize';
import { useI18n } from '../../i18n';
import { ArrowDownIcon, ArrowUpIcon, MoreIcon } from '../icons';
import { FileThumb } from './FileThumb';
import { nameExtLabel } from './types';

export type ExtraColumn = 'owner' | 'access' | 'location' | 'type' | 'created' | 'deleted';

export type RowDnD = {
  draggable: boolean;
  onDragStart: (e: DragEvent, node: Node) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent, node: Node) => void;
  onDragLeave: (node: Node) => void;
  onDrop: (e: DragEvent, node: Node) => void;
  dropTargetId: string | null;
};

export type FileListProps = {
  nodes: Node[];
  mode: 'list' | 'details';
  scrollRef: RefObject<HTMLDivElement | null>;
  selection: Selection;
  label: string;
  sort?: SortSpec;
  onSort?: (key: SortKey) => void;
  columns?: ExtraColumn[];
  ownerName?: (n: Node) => ReactNode;
  accessLabel?: (n: Node) => ReactNode;
  locationName?: (n: Node) => ReactNode;
  /** Hover actions (desktop) rendered before the ⋯ button. */
  rowActions?: (n: Node) => ReactNode;
  onOpen: (n: Node) => void;
  onMenu: (n: Node, at: { x: number; y: number } | HTMLElement) => void;
  dnd?: RowDnD;
  /** Disable checkboxes (e.g. read-only views that have no bulk actions). */
  selectable?: boolean;
  emptyState?: ReactNode;
  header?: ReactNode;
};

type ColDef = { key: string; width: string; label?: string; sort?: SortKey; align?: 'right' };

function useColumns(width: number, mode: 'list' | 'details', extra: ExtraColumn[], t: ReturnType<typeof useI18n>['t']) {
  const cols: ColDef[] = [];
  if (width < 560) return { compact: true, cols };
  for (const c of extra) {
    if (c === 'owner' && width >= 860) cols.push({ key: 'owner', width: '160px', label: t('files.col.owner') });
    if (c === 'access' && width >= 700) cols.push({ key: 'access', width: '128px', label: t('files.col.access') });
    if (c === 'location' && width >= 760) cols.push({ key: 'location', width: '180px', label: t('files.col.location') });
    if (c === 'type' && mode === 'details' && width >= 980) cols.push({ key: 'type', width: '84px', label: t('files.col.type'), sort: 'type' });
    if (c === 'created' && mode === 'details' && width >= 1100) cols.push({ key: 'created', width: '150px', label: t('files.col.created') });
    if (c === 'deleted' && width >= 640) cols.push({ key: 'deleted', width: '150px', label: t('files.col.deleted') });
  }
  if (!extra.includes('deleted') && width >= 640) cols.push({ key: 'modified', width: mode === 'details' ? '160px' : '136px', label: t('files.col.modified'), sort: 'modified' });
  cols.push({ key: 'size', width: '92px', label: t('files.col.size'), sort: 'size', align: 'right' });
  return { compact: false, cols };
}

export function FileList({
  nodes,
  mode,
  scrollRef,
  selection,
  label,
  sort,
  onSort,
  columns = [],
  ownerName,
  accessLabel,
  locationName,
  rowActions,
  onOpen,
  onMenu,
  dnd,
  selectable = true,
  emptyState,
  header,
}: FileListProps) {
  const i18n = useI18n();
  const { t, formatBytes, formatModified, formatDateTime } = i18n;
  const bodyRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(scrollRef);
  const { compact, cols } = useColumns(width || 1024, mode, columns, t);
  const rowH = compact ? 60 : mode === 'details' ? 52 : 44;
  const [scrollMargin, setScrollMargin] = useState(0);
  const { selected, cursor } = selection;
  const selectionMode = selected.size > 0;
  const longPress = useLongPress((id) => selection.toggle(id));

  useLayoutEffect(() => {
    const body = bodyRef.current;
    const sc = scrollRef.current;
    if (!body || !sc) return;
    const measure = () => {
      const top = body.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
      setScrollMargin(Math.round(top));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(sc);
    if (body.parentElement) ro.observe(body.parentElement);
    return () => ro.disconnect();
  }, [scrollRef, header]);

  const virtualizer = useVirtualizer({
    count: nodes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH,
    overscan: 12,
    scrollMargin,
    getItemKey: (i) => nodes[i]?.id ?? i,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rowH, virtualizer]);

  // Keep the keyboard cursor visible.
  useEffect(() => {
    if (!cursor) return;
    const idx = nodes.findIndex((n) => n.id === cursor);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'auto' });
  }, [cursor, nodes, virtualizer]);

  const template = compact
    ? 'minmax(0,1fr) 44px'
    : `${selectable ? '40px ' : ''}minmax(0,1fr) ${cols.map((c) => c.width).join(' ')} 120px`;

  const sortButton = (c: ColDef) => {
    const active = sort?.key === c.sort;
    const content = (
      <>
        {c.label}
        {active && (sort?.dir === 'asc' ? <ArrowUpIcon size={12} /> : <ArrowDownIcon size={12} />)}
      </>
    );
    if (!c.sort || !onSort) return <span className={`flex items-center gap-1 ${c.align === 'right' ? 'justify-end' : ''}`}>{content}</span>;
    return (
      <button
        type="button"
        onClick={() => onSort(c.sort!)}
        aria-sort={undefined}
        className={`-mx-1.5 flex items-center gap-1 rounded px-1.5 py-0.5 transition hover:bg-hover hover:text-ink ${
          c.align === 'right' ? 'ml-auto' : ''
        } ${active ? 'text-ink' : ''}`}
      >
        {content}
      </button>
    );
  };

  const allSelected = nodes.length > 0 && selected.size === nodes.length;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <div className="relative">
      {header}
      {!compact && nodes.length > 0 && (
        <div
          role="presentation"
          className="sticky top-0 z-10 grid h-9 items-center gap-3 border-b border-line bg-surface/95 px-3 text-xs font-medium text-muted backdrop-blur"
          style={{ gridTemplateColumns: template }}
        >
          {selectable && (
            <span className="flex items-center justify-center">
              <input
                type="checkbox"
                className="check"
                aria-label={t('files.selectAll')}
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={() => (allSelected ? selection.clear() : selection.selectAll())}
              />
            </span>
          )}
          <span>{sortButton({ key: 'name', width: '', label: t('files.col.name'), sort: 'name' })}</span>
          {cols.map((c) => (
            <span key={c.key} className={c.align === 'right' ? 'text-right' : ''}>
              {sortButton(c)}
            </span>
          ))}
          <span />
        </div>
      )}
      <div
        ref={bodyRef}
        role="listbox"
        aria-label={label}
        aria-multiselectable={selectable || undefined}
        aria-activedescendant={cursor ? `row-${cursor}` : undefined}
        tabIndex={nodes.length ? 0 : -1}
        className="group/list relative outline-none"
        style={{ height: nodes.length ? virtualizer.getTotalSize() : undefined }}
        onFocus={(e) => {
          // Only keyboard focus seeds the cursor; a pointer focus is followed by its own click.
          if (!cursor && nodes[0] && e.target === e.currentTarget && e.currentTarget.matches(':focus-visible')) {
            selection.setCursor(nodes[0].id);
          }
        }}
      >
        {nodes.length === 0 && emptyState}
        {virtualizer.getVirtualItems().map((vi) => {
          const node = nodes[vi.index];
          if (!node) return null;
          const isSel = selected.has(node.id);
          const isCursor = cursor === node.id;
          const isDrop = dnd?.dropTargetId === node.id && node.kind === 'folder';
          const lp = longPress.bind(node.id);
          const meta =
            node.kind === 'folder'
              ? formatModified(node.updated_at)
              : `${formatModified(node.updated_at)} · ${formatBytes(node.size)}`;
          return (
            <div
              key={vi.key}
              id={`row-${node.id}`}
              role="option"
              aria-selected={isSel}
              aria-label={node.name}
              data-file-row
              draggable={dnd?.draggable}
              onDragStart={dnd ? (e) => dnd.onDragStart(e, node) : undefined}
              onDragEnd={dnd?.onDragEnd}
              onDragOver={dnd ? (e) => dnd.onDragOver(e, node) : undefined}
              onDragLeave={dnd ? () => dnd.onDragLeave(node) : undefined}
              onDrop={dnd ? (e) => dnd.onDrop(e, node) : undefined}
              {...lp}
              onClick={(e) => {
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
                if ((e.target as HTMLElement).closest('[data-open]')) {
                  onOpen(node);
                  return;
                }
                selection.select(node.id);
              }}
              onDoubleClick={(e) => {
                if ((e.target as HTMLElement).closest('[data-no-open]')) return;
                onOpen(node);
              }}
              onContextMenu={(e) => {
                lp.onContextMenu(e);
                if (longPress.lastPointer.current !== 'mouse') return;
                e.preventDefault();
                if (!isSel) selection.select(node.id);
                onMenu(node, { x: e.clientX, y: e.clientY });
              }}
              className={`group absolute top-0 left-0 grid w-full cursor-default items-center gap-3 rounded-lg px-3 text-base select-none ${
                isDrop
                  ? 'bg-accent-soft ring-2 ring-accent ring-inset'
                  : isSel
                    ? 'bg-row-selected'
                    : 'hover:bg-hover'
              } ${isCursor ? 'group-focus-visible/list:ring-2 group-focus-visible/list:ring-accent group-focus-visible/list:ring-inset' : ''}`}
              style={{
                height: rowH,
                transform: `translateY(${vi.start - scrollMargin}px)`,
                gridTemplateColumns: template,
              }}
            >
              {selectable && !compact && (
                <span className="flex items-center justify-center" data-no-open>
                  <input
                    type="checkbox"
                    tabIndex={-1}
                    className={`check transition-opacity ${
                      isSel || selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 coarse:opacity-100'
                    }`}
                    aria-label={t('files.selectItem', { name: node.name })}
                    checked={isSel}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => selection.toggle(node.id)}
                  />
                </span>
              )}
              <div className="flex min-w-0 items-center gap-3" data-drag-thumb-host>
                <span data-drag-thumb className="relative shrink-0">
                  <FileThumb node={node} size={compact ? 38 : mode === 'details' ? 34 : 26} />
                  {compact && selectionMode && (
                    <span
                      className={`absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-surface ${
                        isSel ? 'bg-accent text-accent-fg' : 'bg-active'
                      }`}
                      aria-hidden
                    >
                      {isSel && (
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M3 8.5l3.2 3.2L13 5" />
                        </svg>
                      )}
                    </span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <span
                    data-open
                    title={node.name}
                    className="inline-block max-w-full cursor-pointer truncate align-bottom font-medium text-ink decoration-strong underline-offset-2 hover:underline"
                  >
                    {node.name}
                  </span>
                  {compact && <span className="block truncate text-xs text-muted">{meta}</span>}
                  {!compact && mode === 'details' && !cols.some((c) => c.key === 'type') && (
                    <span className="block truncate text-xs text-muted">
                      {node.kind === 'folder' ? t('files.folder') : `${nameExtLabel(node.name)} · ${formatBytes(node.size)}`}
                    </span>
                  )}
                </div>
              </div>
              {!compact &&
                cols.map((c) => (
                  <span key={c.key} className={`truncate text-sm text-muted ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                    {c.key === 'size' && (node.kind === 'folder' ? '—' : formatBytes(node.size))}
                    {c.key === 'modified' && <time dateTime={node.updated_at} title={formatDateTime(node.updated_at)}>{formatModified(node.updated_at)}</time>}
                    {c.key === 'deleted' && <time dateTime={node.updated_at} title={formatDateTime(node.updated_at)}>{formatModified(node.updated_at)}</time>}
                    {c.key === 'created' && formatModified(node.created_at)}
                    {c.key === 'type' && (node.kind === 'folder' ? t('files.folder') : nameExtLabel(node.name))}
                    {c.key === 'owner' && (ownerName?.(node) ?? '—')}
                    {c.key === 'access' && (accessLabel?.(node) ?? '—')}
                    {c.key === 'location' && (locationName?.(node) ?? '—')}
                  </span>
                ))}
              <div className="flex items-center justify-end gap-0.5" data-no-open>
                {!compact && rowActions && (
                  <div className="hidden items-center gap-0.5 group-hover:flex group-focus-within:flex">{rowActions(node)}</div>
                )}
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t('files.moreFor', { name: node.name })}
                  title={t('files.more')}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isSel && !compact) selection.select(node.id);
                    onMenu(node, e.currentTarget);
                  }}
                  className={`flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-active hover:text-ink coarse:h-11 coarse:w-11 ${
                    compact ? '' : 'opacity-0 group-hover:opacity-100 coarse:opacity-100'
                  } ${isSel || isCursor ? '!opacity-100' : ''}`}
                >
                  <MoreIcon size={17} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Small round icon button used for hover row actions. */
export function RowAction({ label, onClick, children, href }: { label: string; onClick?: () => void; children: ReactNode; href?: string }) {
  const cls =
    'flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-active hover:text-ink';
  if (href) {
    return (
      <a href={href} tabIndex={-1} aria-label={label} title={label} className={cls} onClick={(e) => e.stopPropagation()}>
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      className={cls}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}
