import { useEffect, useState } from 'react';
import { WarnIcon } from './icons';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { useT } from '../i18n';

export type ConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  /** Non-destructive confirmations use the primary style. */
  tone?: 'danger' | 'default';
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy = false,
  tone = 'danger',
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const t = useT();
  // Ignore the opening click / accidental double-activation for a short window.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const tm = window.setTimeout(() => setArmed(true), 250);
    return () => window.clearTimeout(tm);
  }, []);

  return (
    <Modal
      title={title}
      onClose={onClose}
      busy={busy}
      icon={tone === 'danger' ? <WarnIcon size={17} /> : undefined}
      tone={tone}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger-solid' : 'primary'}
            disabled={!armed}
            loading={busy}
            data-autofocus
            onClick={() => {
              if (!armed || busy) return;
              onConfirm();
            }}
          >
            {confirmLabel || t('common.delete')}
          </Button>
        </>
      }
    >
      <p className="text-base leading-relaxed text-muted">{message}</p>
    </Modal>
  );
}
