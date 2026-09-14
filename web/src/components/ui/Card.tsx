import type { HTMLAttributes, ReactNode } from 'react';
import { motion } from 'framer-motion';

export function Card({
  className = '',
  hover,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  const Comp = hover ? motion.div : 'div';
  const motionProps = hover
    ? {
        whileHover: { y: -3 },
        transition: { type: 'spring' as const, stiffness: 300, damping: 24 },
      }
    : {};
  return (
    <Comp
      className={`glass glass-hairline rounded-3xl ${hover ? 'cursor-default' : ''} ${className}`}
      {...motionProps}
      {...(rest as object)}
    >
      {children}
    </Comp>
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
    <div
      className={`h-1.5 overflow-hidden rounded-full bg-white/6 ring-1 ring-inset ring-white/5 ${className}`}
    >
      <motion.div
        className={`h-full rounded-full ${
          danger
            ? 'bg-gradient-to-r from-red-500 to-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.6)]'
            : 'bg-iridescent shadow-[0_0_10px_rgba(139,92,246,0.6)]'
        }`}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 24 }}
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
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center"
    >
      <div className="relative">
        <div
          className="absolute inset-0 scale-150 rounded-full bg-arkive-accent/15 blur-2xl"
          aria-hidden
        />
        <div className="glass relative flex h-16 w-16 items-center justify-center rounded-3xl text-arkive-accent2">
          {icon}
        </div>
      </div>
      <p className="font-display text-base font-semibold text-arkive-text">{title}</p>
      {hint && <p className="max-w-sm text-sm text-arkive-muted">{hint}</p>}
      {action}
    </motion.div>
  );
}
