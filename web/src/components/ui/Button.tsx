import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { motion } from 'framer-motion';

type Variant = 'primary' | 'glass' | 'ghost' | 'danger' | 'outline';
type Size = 'xs' | 'sm' | 'md' | 'lg';

const base =
  'relative inline-flex cursor-pointer items-center justify-center gap-2 font-medium ' +
  'transition-all duration-200 select-none whitespace-nowrap ' +
  'disabled:pointer-events-none disabled:opacity-50';

const variants: Record<Variant, string> = {
  primary:
    'bg-iridescent text-white shadow-[0_4px_20px_rgba(139,92,246,0.35)] ' +
    'hover:shadow-[0_6px_28px_rgba(139,92,246,0.5),0_0_20px_rgba(34,211,238,0.25)] hover:brightness-110',
  glass:
    'glass text-arkive-text hover:border-white/15 hover:bg-white/[0.06] ' +
    'hover:shadow-[0_8px_28px_rgba(3,4,12,0.5)]',
  outline:
    'border border-arkive-border bg-transparent text-arkive-muted ' +
    'hover:border-arkive-accent/60 hover:text-arkive-text hover:shadow-[0_0_16px_rgba(139,92,246,0.15)]',
  ghost: 'text-arkive-muted hover:bg-white/[0.06] hover:text-arkive-text',
  danger:
    'border border-red-500/30 bg-red-500/10 text-red-300 ' +
    'hover:border-red-400/60 hover:bg-red-500/20 hover:text-red-200 hover:shadow-[0_0_18px_rgba(239,68,68,0.25)]',
};

const sizes: Record<Size, string> = {
  xs: 'rounded-lg px-2 py-1 text-xs',
  sm: 'rounded-lg px-2.5 py-1.5 text-xs',
  md: 'rounded-xl px-3.5 py-2 text-sm',
  lg: 'rounded-xl px-5 py-2.5 text-sm',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  full?: boolean;
};

export function Button({
  variant = 'glass',
  size = 'md',
  icon,
  full,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={`${base} ${variants[variant]} ${sizes[size]} ${full ? 'w-full' : ''} ${className}`}
      {...(rest as object)}
    >
      {icon}
      {children}
    </motion.button>
  );
}

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  variant?: Variant;
  size?: Size;
};

export function IconButton({
  label,
  variant = 'ghost',
  size = 'sm',
  className = '',
  children,
  ...rest
}: IconButtonProps) {
  const pad =
    size === 'md' ? 'h-9 w-9 rounded-xl' : size === 'xs' ? 'h-6 w-6 rounded-md' : 'h-8 w-8 rounded-lg';
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      title={label}
      aria-label={label}
      className={`${base} ${variants[variant]} ${pad} !px-0 ${className}`}
      {...(rest as object)}
    >
      {children}
    </motion.button>
  );
}
