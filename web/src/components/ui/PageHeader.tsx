import type { ReactNode } from 'react';

/** Standard page heading row used by list and settings pages. */
export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
  className = '',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 py-3 ${className}`}>
      {/* A 12rem basis lets the actions wrap below the title on phones instead
          of squeezing it to "T…" (Trash with a workspace picker). */}
      <div className="flex min-w-0 grow basis-48 items-center gap-3">
        {icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface text-muted ring-1 ring-line">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight text-ink sm:text-xl">{title}</h1>
          {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
