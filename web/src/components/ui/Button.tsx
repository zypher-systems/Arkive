import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'xs' | 'sm' | 'md';

const base =
  'inline-flex cursor-pointer items-center justify-center gap-2 font-medium whitespace-nowrap ' +
  'transition-colors duration-150 select-none ' +
  'disabled:pointer-events-none disabled:opacity-50';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:opacity-85',
  secondary:
    'border border-strong bg-surface text-ink hover:border-faint hover:bg-hover',
  ghost: 'text-muted hover:bg-hover hover:text-ink',
  danger:
    'border border-danger/50 bg-transparent text-danger hover:border-danger hover:bg-danger-soft',
};

const sizes: Record<Size, string> = {
  xs: 'rounded-md px-2 py-1 text-xs',
  sm: 'rounded-md px-2.5 py-1.5 text-xs',
  md: 'rounded-md px-3.5 py-2 text-sm',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  full?: boolean;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  full,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${full ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
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
    size === 'md' ? 'h-8 w-8 rounded-md' : size === 'xs' ? 'h-6 w-6 rounded' : 'h-7 w-7 rounded-md';
  return (
    <button
      title={label}
      aria-label={label}
      className={`${base} ${variants[variant]} ${pad} !px-0 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
