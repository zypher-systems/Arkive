import { useEffect, useRef, useState } from 'react';
import { SpinnerIcon } from './icons';
import { Button } from './ui/Button';
import { Modal, ModalField } from './ui/Modal';

type Props = {
  title: string;
  label?: string;
  initialValue?: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: (value: string) => void;
  onClose: () => void;
};

export function NamePrompt({
  title,
  label = 'Name',
  initialValue = '',
  confirmLabel = 'Create',
  busy = false,
  onConfirm,
  onClose,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, onClose]);

  function submit() {
    const name = value.trim();
    if (!name || busy) return;
    onConfirm(name);
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="name-prompt-form"
            variant="primary"
            disabled={busy || !value.trim()}
            icon={busy ? <SpinnerIcon size={13} className="animate-spin" /> : undefined}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <form
        id="name-prompt-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <ModalField label={label}>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
            className="input-field"
            autoComplete="off"
          />
        </ModalField>
      </form>
    </Modal>
  );
}
