import type { HTMLAttributes, ReactNode } from 'react';

export function Card({
  className = '',
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return (
    <div className={`panel ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function ProgressBar({
  value,
  danger,
  className = '',
}: {
  value: number;
  danger?: boolean;
  className?: string;
}) {
  const pct = Math.min(100, Math.max(0, value * 100));
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-hover ${className}`}>
      <div
        className={`h-full rounded-full transition-[width] duration-300 ease-out ${
          danger ? 'bg-danger' : 'bg-accent'
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-inset text-faint">
        {icon}
      </div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {hint && <p className="max-w-sm text-[13px] text-muted">{hint}</p>}
      {action}
    </div>
  );
}
