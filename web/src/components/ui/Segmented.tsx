import type { ReactNode } from 'react';

export type SegmentItem<T extends string> = {
  value: T;
  label?: ReactNode;
  icon?: ReactNode;
  title?: string;
};

export function Segmented<T extends string>({
  items,
  value,
  onChange,
  size = 'md',
  className = '',
}: {
  items: SegmentItem<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm';
  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-md border border-line bg-inset p-0.5 ${className}`}
      role="tablist"
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={item.title}
            onClick={() => onChange(item.value)}
            className={`cursor-pointer rounded-[5px] font-medium transition-colors duration-150 ${pad} ${
              active
                ? 'border border-line bg-surface text-ink shadow-xs'
                : 'border border-transparent text-muted hover:text-ink'
            }`}
          >
            <span className="flex items-center gap-1.5">
              {item.icon}
              {item.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
