import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export type SegmentItem<T extends string> = {
  value: T;
  label?: ReactNode;
  icon?: ReactNode;
  /** Accessible name when the item is icon-only. */
  title?: string;
};

/**
 * Single-choice segmented control (radiogroup semantics, arrow-key nav).
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  size = 'md',
  className = '',
  label,
  full,
}: {
  items: SegmentItem<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  className?: string;
  label?: string;
  full?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pad =
    size === 'sm'
      ? 'h-7 px-2 text-sm coarse:h-9 coarse:min-w-9'
      : 'h-8 px-3 text-base coarse:h-10';

  function onKeyDown(e: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const idx = items.findIndex((i) => i.value === value);
    const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
    const next = items[(idx + dir + items.length) % items.length];
    onChange(next.value);
    window.requestAnimationFrame(() => {
      ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    });
  }

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`inline-flex items-center gap-0.5 rounded-lg border border-line bg-inset p-0.5 ${full ? 'flex w-full' : ''} ${className}`}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={item.label ? undefined : item.title}
            title={item.title}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors duration-150 ${pad} ${full ? 'flex-1' : ''} ${
              active ? 'bg-surface text-ink shadow-xs ring-1 ring-line' : 'text-muted hover:text-ink'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
