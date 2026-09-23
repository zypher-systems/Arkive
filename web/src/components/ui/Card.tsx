import { useId, type HTMLAttributes, type ReactNode } from 'react';

export function Card({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`panel ${className}`} {...rest}>
      {children}
    </div>
  );
}

/** Titled settings card: header (title, description, actions) + body. */
export function Section({
  title,
  description,
  actions,
  children,
  className = '',
  footer,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  id?: string;
}) {
  // Always labelled, so each card is a named region (several have a "Save").
  const autoId = useId();
  const titleId = id ? `${id}-title` : autoId;
  return (
    <section id={id} className={`panel overflow-hidden ${className}`} aria-labelledby={titleId}>
      <div className={`flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6 ${children === undefined ? 'pb-5' : ''}`}>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-md font-semibold tracking-tight text-ink">
            {title}
          </h2>
          {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children !== undefined && <div className="px-5 pt-4 pb-5 sm:px-6">{children}</div>}
      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-inset/40 px-5 py-3 sm:px-6">
          {footer}
        </div>
      )}
    </section>
  );
}

export function ProgressBar({
  value,
  tone = 'accent',
  className = '',
  label,
  size = 'sm',
}: {
  value: number;
  tone?: 'accent' | 'danger' | 'ok' | 'muted';
  className?: string;
  label?: string;
  size?: 'xs' | 'sm';
}) {
  const pct = Math.min(100, Math.max(0, value * 100));
  const color = { accent: 'bg-accent', danger: 'bg-danger', ok: 'bg-ok', muted: 'bg-faint' }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={`${size === 'xs' ? 'h-1' : 'h-1.5'} overflow-hidden rounded-full bg-active ${className}`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-300 ease-out ${color}`}
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
  className = '',
  compact,
}: {
  icon: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${compact ? 'gap-2 px-6 py-10' : 'gap-3 px-6 py-16'} ${className}`}
    >
      <div
        className={`flex items-center justify-center rounded-2xl border border-line bg-inset text-faint ${
          compact ? 'h-11 w-11' : 'h-14 w-14'
        }`}
      >
        {icon}
      </div>
      <div>
        <p className="text-md font-semibold text-ink">{title}</p>
        {hint && <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{hint}</p>}
      </div>
      {action && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'danger' | 'info';

export function Badge({
  tone = 'neutral',
  children,
  className = '',
  icon,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  const tones: Record<BadgeTone, string> = {
    neutral: 'bg-inset text-muted ring-line',
    accent: 'bg-accent-soft text-accent-strong ring-accent-line',
    ok: 'bg-ok-soft text-ok ring-ok/30',
    danger: 'bg-danger-soft text-danger ring-danger/30',
    info: 'bg-info-soft text-info ring-info/30',
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-px text-2xs font-semibold whitespace-nowrap ring-1 ring-inset ${tones[tone]} ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}

/** Count bubble for nav items and tabs. */
export function CountBadge({ count, tone = 'neutral' }: { count: number; tone?: 'neutral' | 'accent' }) {
  if (!count) return null;
  return (
    <span
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-2xs font-semibold tabular-nums ${
        tone === 'accent' ? 'bg-accent text-accent-fg' : 'bg-active text-muted'
      }`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

const AVATAR_TINTS = [
  'bg-[#f3e3cf] text-[#7a4a12] dark:bg-[#3a2c18] dark:text-[#f1c98a]',
  'bg-[#dfe8f3] text-[#2f5480] dark:bg-[#1c2a3b] dark:text-[#9fc0e6]',
  'bg-[#dcefe4] text-[#23603f] dark:bg-[#17301f] dark:text-[#8fd6ae]',
  'bg-[#ece2f3] text-[#5d3b7a] dark:bg-[#2c2036] dark:text-[#cfb0e8]',
  'bg-[#f3dfdc] text-[#833a2f] dark:bg-[#3a1f1b] dark:text-[#eeb0a6]',
];

export function Avatar({ name, size = 32, className = '' }: { name: string; size?: number; className?: string }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const tint = AVATAR_TINTS[h % AVATAR_TINTS.length];
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.42)) }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none ${tint} ${className}`}
    >
      {initial}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface px-1.5 font-sans text-2xs font-medium text-muted shadow-[0_1px_0_var(--line)]">
      {children}
    </kbd>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

/** Definition list row used in details panels and settings. */
export function InfoRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-ink">{children}</dd>
    </div>
  );
}
