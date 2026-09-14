import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, X } from 'lucide-react';

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
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          initial={{ opacity: 0, y: 28, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          className="glass-strong glass-hairline fixed bottom-6 left-1/2 z-[110] flex -translate-x-1/2 items-center gap-3 rounded-2xl px-4 py-3 text-sm shadow-[0_16px_48px_rgba(3,4,12,0.7)]"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-arkive-accent/30 to-arkive-accent2/25 text-arkive-accent2 ring-1 ring-white/12">
            <CheckCircle2 size={15} />
          </span>
          <span className="max-w-[60vw]">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action?.onClick();
                onDismiss();
              }}
              className="shrink-0 cursor-pointer rounded-lg bg-iridescent bg-clip-text px-1 font-semibold text-transparent transition hover:brightness-125"
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="-mr-1 shrink-0 cursor-pointer rounded-lg p-1 text-arkive-muted transition hover:bg-white/[0.07] hover:text-arkive-text"
          >
            <X size={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
