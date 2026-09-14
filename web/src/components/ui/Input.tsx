import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

export function Input({
  icon,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }) {
  if (icon) {
    return (
      <div className={`relative w-full ${className}`}>
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-arkive-muted">
          {icon}
        </span>
        <input className="input-glass pl-9" {...rest} />
      </div>
    );
  }
  return <input className={`input-glass ${className}`} {...rest} />;
}

export function Textarea({
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`input-glass resize-y ${className}`} {...rest} />;
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
      <span className="mb-1.5 flex items-center justify-between text-xs font-medium tracking-wide text-arkive-muted uppercase">
        {label}
        {hint}
      </span>
      {children}
    </label>
  );
}
