import { type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRightIcon, MoreIcon } from '../icons';
import { DropdownMenu } from '../ui/Menu';
import { collapseCrumbs } from '../../lib/paths';
import { useIsMobile } from '../../lib/hooks';
import { useI18n } from '../../i18n';

export type Crumb = { id: string | null; name: string; to: string };

/**
 * Breadcrumb trail; long trails collapse their middle into a "…" menu.
 * The last crumb is the page heading.
 */
export function Breadcrumbs({
  crumbs,
  onDrop,
  dropTargetId,
  onDragOverCrumb,
  onDragLeaveCrumb,
}: {
  crumbs: Crumb[];
  onDrop?: (e: DragEvent, id: string | null) => void;
  dropTargetId?: string | null;
  onDragOverCrumb?: (e: DragEvent, id: string | null) => void;
  onDragLeaveCrumb?: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const mobile = useIsMobile();
  const navigate = useNavigate();
  const { head, hidden, tail } =
    mobile && crumbs.length > 1
      ? { head: [] as Crumb[], hidden: crumbs.slice(0, -1), tail: crumbs.slice(-1) }
      : collapseCrumbs(crumbs, 4);
  const visible = hidden.length ? [...head, null, ...tail] : head;
  const last = crumbs[crumbs.length - 1];

  const dropKey = (id: string | null) => id ?? '__root__';

  return (
    <nav aria-label={t('files.breadcrumbs')} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-0.5">
        {visible.map((c, i) => {
          if (c === null) {
            return (
              <li key="more" className="flex shrink-0 items-center gap-0.5">
                <DropdownMenu
                  label={t('files.morePath')}
                  items={hidden.map((h) => ({ id: h.to, label: h.name, onSelect: () => navigate(h.to) }))}
                  trigger={
                    <button
                      type="button"
                      aria-label={t('files.morePath')}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-hover hover:text-ink coarse:h-10 coarse:w-10"
                    >
                      <MoreIcon size={16} />
                    </button>
                  }
                />
                <ChevronRightIcon size={14} className="shrink-0 text-faint" />
              </li>
            );
          }
          const isLast = c === last;
          const dropping = dropTargetId === dropKey(c.id);
          return (
            <li key={c.to} className={`flex min-w-0 items-center gap-0.5 ${isLast ? 'shrink' : 'shrink-[2]'}`}>
              {isLast ? (
                <h1
                  aria-current="page"
                  className="truncate px-1.5 text-lg font-semibold tracking-tight text-ink sm:text-xl"
                  title={c.name}
                >
                  {c.name}
                </h1>
              ) : (
                <Link
                  to={c.to}
                  onDragOver={onDragOverCrumb ? (e) => onDragOverCrumb(e, c.id) : undefined}
                  onDragLeave={onDragLeaveCrumb ? () => onDragLeaveCrumb(c.id) : undefined}
                  onDrop={onDrop ? (e) => onDrop(e, c.id) : undefined}
                  className={`truncate rounded-md px-1.5 py-1 text-lg text-muted transition hover:bg-hover hover:text-ink sm:text-xl ${
                    dropping ? 'bg-accent-soft text-ink ring-2 ring-accent' : ''
                  }`}
                  title={c.name}
                >
                  {c.name}
                </Link>
              )}
              {!isLast && i < visible.length - 1 && <ChevronRightIcon size={15} className="shrink-0 text-faint" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
