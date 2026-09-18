import { useEffect, useState } from 'react';
import { SpinnerIcon, WarnIcon } from './icons';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

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

  return (
    <Modal
      title={title}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy || !armed}
            icon={busy ? <SpinnerIcon size={13} className="animate-spin" /> : undefined}
            onClick={() => {
              if (!armed || busy) return;
              onConfirm();
            }}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-danger-soft text-danger">
          <WarnIcon size={16} />
        </div>
        <p className="pt-1 text-sm leading-relaxed text-muted">{message}</p>
      </div>
    </Modal>
  );
}
