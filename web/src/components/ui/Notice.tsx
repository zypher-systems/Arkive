import type { ReactNode } from 'react';
import { AlertIcon, CheckCircleIcon, InfoIcon } from '../icons';

type NoticeProps = {
  kind: 'error' | 'success' | 'info' | 'warning';
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  action?: ReactNode;
};

const styles: Record<NoticeProps['kind'], string> = {
  error: 'border-danger/30 bg-danger-soft text-danger',
  success: 'border-ok/30 bg-ok-soft text-ok',
  info: 'border-line bg-inset text-muted',
  warning: 'border-accent-line bg-accent-soft text-accent-strong',
};

export function Notice({ kind, children, className = '', title, action }: NoticeProps) {
  const Icon = kind === 'success' ? CheckCircleIcon : kind === 'info' ? InfoIcon : AlertIcon;
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${styles[kind]} ${className}`}
    >
      <Icon size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
