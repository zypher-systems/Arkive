import { motion } from 'framer-motion';
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
  layoutId,
  size = 'md',
  className = '',
}: {
  items: SegmentItem<T>[];
  value: T;
  onChange: (v: T) => void;
  layoutId: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm';
  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-xl border border-white/8 bg-[#0a0c16]/70 p-1 backdrop-blur-md ${className}`}
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
            className={`relative cursor-pointer rounded-lg font-medium transition-colors duration-200 ${pad} ${
              active ? 'text-white' : 'text-arkive-muted hover:text-arkive-text'
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-lg bg-gradient-to-br from-arkive-accent/35 to-arkive-accent2/25 shadow-[0_0_16px_rgba(139,92,246,0.35)] ring-1 ring-white/15"
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {item.icon}
              {item.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
