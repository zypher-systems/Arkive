import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '../icons';
import { IconButton } from './Button';

type ModalProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Max width class. Defaults to max-w-md. */
  width?: string;
  busy?: boolean;
  /** When true, renders body without scroll container (caller owns layout). */
  bare?: boolean;
};

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 'max-w-md',
  busy = false,
  bare = false,
}: ModalProps) {
  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-[100] flex items-center justify-center bg-overlay p-4"
      onMouseDown={(e) => {
        if (!busy && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`animate-fade-up flex max-h-[90vh] w-full ${width} flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-lg`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-[13px] text-muted">{subtitle}</p>}
          </div>
          <IconButton label="Close" size="sm" onClick={onClose} disabled={busy} className="-mr-1 -mt-0.5">
            <CloseIcon size={14} />
          </IconButton>
        </div>
        {bare ? (
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        ) : (
          <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        )}
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ModalField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
