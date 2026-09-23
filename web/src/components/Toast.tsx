import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertIcon, CheckCircleIcon, CloseIcon, InfoIcon } from './icons';
import { useT } from '../i18n';

export type ToastAction = { label: string; onClick: () => void };

export type ToastInput = {
  message: string;
  tone?: 'success' | 'error' | 'info';
  action?: ToastAction;
  /** ms; 0 keeps it until dismissed. */
  duration?: number;
};

type ToastItem = ToastInput & { id: number };

type ToastApi = {
  toast: (t: ToastInput) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, number>());
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((i) => i.id !== id));
    const tm = timers.current.get(id);
    if (tm) window.clearTimeout(tm);
    timers.current.delete(id);
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = ++seq.current;
      setItems((list) => [...list.slice(-2), { ...input, id }]);
      const duration = input.duration ?? (input.action ? 8000 : input.tone === 'error' ? 7000 : 4000);
      if (duration > 0) {
        timers.current.set(
          id,
          window.setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}

function Toaster({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[130] flex flex-col items-center gap-2 px-4 lg:bottom-6"
    >
      {items.map((t) => (
        <ToastView key={t.id} item={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>,
    document.body,
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const Icon = item.tone === 'error' ? AlertIcon : item.tone === 'info' ? InfoIcon : CheckCircleIcon;
  return (
    <div
      role={item.tone === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto flex max-w-[min(34rem,100%)] items-center gap-3 rounded-xl bg-[#1f2226] py-2.5 pr-2 pl-3.5 text-base text-[#f3f3f1] shadow-lg ring-1 ring-black/10 transition-all duration-200 dark:bg-[#2b2f36] ${
        shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
    >
      <Icon
        size={16}
        className={`shrink-0 ${item.tone === 'error' ? 'text-[#f59a90]' : item.tone === 'info' ? 'text-[#b9c3cf]' : 'text-[#6fd3a2]'}`}
      />
      <span className="min-w-0 flex-1">{item.message}</span>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            item.action?.onClick();
            onDismiss();
          }}
          className="shrink-0 rounded-md px-2 py-1 font-semibold text-[#f1bd66] transition hover:bg-white/10"
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('common.dismiss')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/60 transition hover:bg-white/10 hover:text-white"
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
