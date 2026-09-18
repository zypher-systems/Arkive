import { useEffect, useState } from 'react';
import { CheckCircleIcon, CloseIcon } from './icons';

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastState = {
  id: number;
  message: string;
  action?: ToastAction;
} | null;

type Props = {
  toast: ToastState;
  onDismiss: () => void;
};

export function Toast({ toast, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!toast) {
      setVisible(false);
      return;
    }
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [toast]);

  if (!toast) return null;

  return (
    <div
      key={toast.id}
      role="status"
      className={`fixed bottom-6 left-1/2 z-[110] flex -translate-x-1/2 items-center gap-3 rounded-md bg-[#23262b] px-4 py-2.5 text-sm text-[#f4f4f2] shadow-lg transition-all duration-150 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
    >
      <CheckCircleIcon size={15} className="shrink-0 opacity-80" />
      <span className="max-w-[60vw] truncate">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            onDismiss();
          }}
          className="shrink-0 cursor-pointer rounded px-1 font-semibold text-[#e8b45a] transition hover:opacity-80"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 shrink-0 cursor-pointer rounded p-1 opacity-60 transition hover:opacity-100"
      >
        <CloseIcon size={13} />
      </button>
    </div>
  );
}
