import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'danger-solid';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex shrink-0 items-center justify-center gap-2 font-medium whitespace-nowrap select-none ' +
  'transition-[background-color,border-color,color,box-shadow,opacity] duration-150 ' +
  'disabled:pointer-events-none disabled:opacity-50 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg shadow-xs hover:bg-primary-hover',
  accent: 'bg-accent text-accent-fg shadow-xs hover:bg-accent-strong dark:hover:bg-accent-strong',
  secondary: 'border border-line bg-surface text-ink shadow-xs hover:border-strong hover:bg-hover',
  ghost: 'text-muted hover:bg-hover hover:text-ink',
  danger: 'border border-line bg-surface text-danger shadow-xs hover:border-danger/50 hover:bg-danger-soft',
  'danger-solid': 'bg-danger text-white shadow-xs hover:bg-danger-strong dark:text-[#1b0b09]',
};

export const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 rounded-md px-3 text-sm coarse:h-10',
  md: 'h-9 rounded-md px-3.5 text-base coarse:h-11',
  lg: 'h-11 rounded-lg px-5 text-base',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  full?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    iconRight,
    loading,
    full,
    className = '',
    children,
    type = 'button',
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${base} ${buttonVariants[variant]} ${buttonSizes[size]} ${full ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : icon}
      {children}
      {iconRight}
    </button>
  );
});

export function LinkButton({
  variant = 'secondary',
  size = 'md',
  icon,
  className = '',
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode }) {
  return (
    <a className={`${base} ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`} {...rest}>
      {icon}
      {children}
    </a>
  );
}

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Accessible name (also used as tooltip). */
  label: string;
  variant?: ButtonVariant;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Skip the native tooltip (e.g. when a visible label is adjacent). */
  noTooltip?: boolean;
};

const iconSizes = {
  xs: 'h-6 w-6 rounded-md coarse:h-9 coarse:w-9',
  sm: 'h-7 w-7 rounded-md coarse:h-11 coarse:w-11',
  md: 'h-8 w-8 rounded-md coarse:h-11 coarse:w-11',
  lg: 'h-9 w-9 rounded-lg coarse:h-11 coarse:w-11',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', size = 'md', noTooltip, className = '', children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      title={noTooltip ? undefined : label}
      aria-label={label}
      className={`${base} ${buttonVariants[variant]} ${iconSizes[size]} !px-0 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});
