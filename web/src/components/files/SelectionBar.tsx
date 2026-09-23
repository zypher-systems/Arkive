import { useRef, type ReactNode } from 'react';
import { CloseIcon, MoreIcon } from '../icons';
import { IconButton } from '../ui/Button';
import { DropdownMenu, type MenuItem } from '../ui/Menu';
import { useElementWidth } from '../../lib/useElementSize';
import { useI18n } from '../../i18n';

export type BarAction = {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
  /** Lower = more important; low-priority actions move into ⋯ when space runs out. */
  priority?: number;
};

/**
 * Contextual toolbar that replaces the page toolbar while items are
 * selected. Labels show when there is room; on narrow screens the least
 * important actions collapse into a ⋯ menu.
 */
export function SelectionBar({
  count,
  actions,
  overflow = [],
  onClear,
}: {
  count: number;
  actions: BarAction[];
  overflow?: MenuItem[];
  onClear: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref) || 1000;
  const visible = actions.filter((a) => !a.hidden);
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const btn = coarse ? 46 : 38;
  const labels = width >= 900;
  const needed = visible.length * (labels ? 120 : btn);
  const room = width - 170 - btn;
  let shown = visible;
  let moved: BarAction[] = [];
  if (!labels && needed > room) {
    const max = Math.max(1, Math.floor(room / btn));
    const keep = new Set([...visible].sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9)).slice(0, max).map((a) => a.id));
    shown = visible.filter((a) => keep.has(a.id));
    moved = visible.filter((a) => !keep.has(a.id));
  }
  const menu: MenuItem[] = [
    ...moved.map((a) => ({ id: a.id, label: a.label, icon: a.icon, danger: a.danger, onSelect: a.onClick })),
    ...(moved.length && overflow.length ? [{ kind: 'separator' as const, id: 'sep' }] : []),
    ...overflow,
  ];

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={t('selection.toolbar')}
      className="animate-fade-in flex h-12 min-w-0 flex-1 items-center gap-1 rounded-xl bg-primary px-1.5 text-primary-fg shadow-sm"
    >
      <button
        type="button"
        onClick={onClear}
        aria-label={t('selection.clear')}
        title={t('selection.clear')}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition hover:bg-white/10 dark:hover:bg-black/10 coarse:h-11 coarse:w-11"
      >
        <CloseIcon size={16} />
      </button>
      <span className="mr-1 shrink-0 px-1 text-base font-semibold whitespace-nowrap tabular-nums" aria-live="polite">
        {t('selection.count', { count })}
      </span>
      <div className="ml-auto flex min-w-0 items-center gap-0.5">
        {shown.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={a.onClick}
            aria-label={a.label}
            title={a.label}
            className={`flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap transition coarse:h-11 coarse:min-w-11 ${
              a.danger ? 'hover:bg-[#f07a6e]/20' : 'hover:bg-white/10 dark:hover:bg-black/10'
            }`}
          >
            {a.icon}
            {labels && <span>{a.label}</span>}
          </button>
        ))}
        {menu.length > 0 && (
          <DropdownMenu
            align="end"
            items={menu}
            label={t('selection.more')}
            trigger={
              <IconButton label={t('selection.more')} className="!text-primary-fg hover:!bg-white/10 dark:hover:!bg-black/10">
                <MoreIcon size={17} />
              </IconButton>
            }
          />
        )}
      </div>
    </div>
  );
}
