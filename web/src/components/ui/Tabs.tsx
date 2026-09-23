import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

export type TabItem<T extends string> = { value: T; label: ReactNode; icon?: ReactNode; badge?: ReactNode };

/**
 * In-page tabs (WAI-ARIA tabs pattern, automatic activation). Render the
 * matching panel with `tabPanelProps(value)`.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className = '',
  idBase,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
  idBase?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const auto = useId();
  const base = idBase || auto;

  function onKeyDown(e: KeyboardEvent) {
    const idx = items.findIndex((i) => i.value === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next].value);
    window.requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  }

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`scroll-slim flex gap-1 overflow-x-auto border-b border-line ${className}`}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            id={`${base}-tab-${item.value}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`${base}-panel-${item.value}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={`relative -mb-px inline-flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-base font-medium whitespace-nowrap transition-colors ${
              active ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {item.icon}
            {item.label}
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}

export function tabPanelProps(base: string, value: string) {
  return {
    role: 'tabpanel' as const,
    id: `${base}-panel-${value}`,
    'aria-labelledby': `${base}-tab-${value}`,
    tabIndex: 0,
  };
}

/** Route-backed tab bar (each tab is a link). */
export function TabNav({
  items,
  label,
  className = '',
}: {
  items: { to: string; label: ReactNode; icon?: ReactNode; badge?: ReactNode; end?: boolean }[];
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={`scroll-slim -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 ${className}`}>
      <ul className="flex min-w-max gap-1 border-b border-line">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `relative -mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-base font-medium whitespace-nowrap transition-colors coarse:h-11 ${
                  isActive ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'
                }`
              }
            >
              {item.icon}
              {item.label}
              {item.badge}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
