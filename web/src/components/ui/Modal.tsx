import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '../icons';
import { IconButton } from './Button';
import { useEscape, useFocusTrap } from '../../lib/hooks';
import { useT } from '../../i18n';

type ModalProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Max width class. Defaults to max-w-md. */
  width?: string;
  busy?: boolean;
  /** When true, renders body without padding/scroll container (caller owns layout). */
  bare?: boolean;
  /** Optional leading icon tile next to the title. */
  icon?: ReactNode;
  tone?: 'default' | 'danger';
};

/**
 * Accessible dialog: focus is trapped inside and restored on close, Escape
 * and backdrop click dismiss (unless busy). On phones it renders as a
 * bottom sheet.
 */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 'max-w-md',
  busy = false,
  bare = false,
  icon,
  tone = 'default',
}: ModalProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useFocusTrap(ref);
  useEscape(() => {
    if (!busy) onClose();
  });

  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-[100] flex items-end justify-center bg-overlay sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (!busy && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? descId : undefined}
        tabIndex={-1}
        className={`animate-slide-up sm:animate-pop flex max-h-[92dvh] w-full ${width} flex-col overflow-hidden rounded-t-xl border border-line bg-raised shadow-lg outline-none sm:max-h-[88vh] sm:rounded-xl`}
      >
        <div className="flex shrink-0 items-start gap-3 px-5 pt-5 pb-3">
          {icon && (
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent-strong'
              }`}
            >
              {icon}
            </div>
          )}
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id={titleId} className="text-md font-semibold tracking-tight text-ink">
              {title}
            </h2>
            {subtitle && (
              <p id={descId} className="mt-0.5 text-sm break-words text-muted">
                {subtitle}
              </p>
            )}
          </div>
          <IconButton label={t('common.close')} size="sm" onClick={onClose} disabled={busy} className="-mt-1 -mr-2">
            <CloseIcon size={15} />
          </IconButton>
        </div>
        {bare ? (
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        ) : (
          <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-5">{children}</div>
        )}
        {footer && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line bg-surface/60 px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:pb-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Off-canvas panel (left drawer for navigation, right for details).
 */
export function Drawer({
  side = 'left',
  label,
  onClose,
  children,
  width = 'w-[min(20rem,86vw)]',
}: {
  side?: 'left' | 'right';
  label: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  useEscape(onClose);
  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-[90] bg-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`absolute inset-y-0 ${side === 'left' ? 'left-0 animate-slide-in-left border-r' : 'right-0 animate-slide-in-right border-l'} ${width} flex flex-col border-line bg-surface shadow-lg outline-none`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
