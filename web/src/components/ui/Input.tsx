import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; trailing?: ReactNode }
>(function Input({ icon, trailing, className = '', ...rest }, ref) {
  if (icon || trailing) {
    return (
      <div className={`relative w-full ${className}`}>
        {icon && (
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint">{icon}</span>
        )}
        <input ref={ref} className={`input-field ${icon ? 'pl-9' : ''} ${trailing ? 'pr-10' : ''}`} {...rest} />
        {trailing && <span className="absolute top-1/2 right-1.5 -translate-y-1/2">{trailing}</span>}
      </div>
    );
  }
  return <input ref={ref} className={`input-field ${className}`} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className = '', ...rest }, ref) {
    return <textarea ref={ref} className={`input-field resize-y ${className}`} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className = '', children, ...rest },
  ref,
) {
  return (
    <div className={`relative ${className.includes('w-') ? '' : 'w-full'} ${className}`}>
      <select ref={ref} className="input-field cursor-pointer appearance-none pr-9" {...rest}>
        {children}
      </select>
      <svg
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-faint"
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4 6l4 4 4-4" />
      </svg>
    </div>
  );
});

/**
 * Label + control + hint/error. Pass a render function to receive the
 * generated id and describedby wiring.
 */
export function Field({
  label,
  hint,
  error,
  children,
  className = '',
  aside,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  aside?: ReactNode;
  className?: string;
  children: ReactNode | ((ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode);
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const describedBy = error || hint ? hintId : undefined;
  return (
    <div className={`block ${className}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        {aside}
      </div>
      {typeof children === 'function' ? children({ id, describedBy, invalid: !!error }) : children}
      {(error || hint) && (
        <p id={hintId} className={`mt-1.5 text-xs ${error ? 'text-danger' : 'text-muted'}`}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  const auto = useId();
  const sid = id || auto;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={sid} className="text-base font-medium text-ink">
          {label}
        </label>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      <button
        id={sid}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 disabled:opacity-50 ${
          checked ? 'border-accent bg-accent' : 'border-strong bg-hover'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-150 ${
            checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
          }`}
        />
      </button>
    </div>
  );
}

export function Checkbox({
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="checkbox" className={`check ${className}`} {...rest} />;
}
