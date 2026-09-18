import type { ReactNode } from 'react';
import { AlertIcon, CheckCircleIcon } from '../icons';

type NoticeProps = {
  kind: 'error' | 'success' | 'info';
  children: ReactNode;
  className?: string;
};

const styles: Record<NoticeProps['kind'], string> = {
  error: 'border-danger/40 bg-danger-soft text-danger',
  success: 'border-ok/40 bg-ok-soft text-ok',
  info: 'border-line bg-inset text-muted',
};

export function Notice({ kind, children, className = '' }: NoticeProps) {
  return (
    <p
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] ${styles[kind]} ${className}`}
    >
      {kind === 'success' ? (
        <CheckCircleIcon size={14} className="mt-0.5 shrink-0" />
      ) : (
        <AlertIcon size={14} className="mt-0.5 shrink-0" />
      )}
      <span className="min-w-0">{children}</span>
    </p>
  );
}
