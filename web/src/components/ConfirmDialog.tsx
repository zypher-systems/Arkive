import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from './ui/Button';

export type ConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  // Ignore the opening click / accidental double-activation for a short window.
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), 300);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, onClose]);

  const dialog = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#03040c]/70 p-4 backdrop-blur-md"
      onMouseDown={(e) => {
        // Only backdrop (not the panel) cancels — and only after armed.
        if (!armed || busy) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="glass-strong glass-hairline w-full max-w-md rounded-3xl p-6 shadow-[0_24px_80px_rgba(3,4,12,0.7)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-500/12 text-red-300 ring-1 ring-red-400/25 shadow-[0_0_20px_rgba(239,68,68,0.15)]">
            <AlertTriangle size={20} />
          </div>
          <div>
            <h2 id="confirm-dialog-title" className="font-display text-xl font-bold tracking-tight">
              {title}
            </h2>
            <p id="confirm-dialog-message" className="mt-1.5 text-sm leading-relaxed text-arkive-muted">
              {message}
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="glass" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="font-semibold"
            disabled={busy || !armed}
            icon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}
            onClick={() => {
              if (!armed || busy) return;
              onConfirm();
            }}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </motion.div>
    </div>
  );

  return createPortal(dialog, document.body);
}
