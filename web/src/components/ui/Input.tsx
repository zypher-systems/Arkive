import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

export function Input({
  icon,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }) {
  if (icon) {
    return (
      <div className={`relative w-full ${className}`}>
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint">
          {icon}
        </span>
        <input className="input-field pl-8" {...rest} />
      </div>
    );
  }
  return <input className={`input-field ${className}`} {...rest} />;
}

export function Textarea({
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`input-field resize-y ${className}`} {...rest} />;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted">
        {label}
        {hint}
      </span>
      {children}
    </label>
  );
}
