import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './ui/Button';
import { Field, Input } from './ui/Input';
import { Modal } from './ui/Modal';
import { validateName, renameSelection, type NameProblem } from '../lib/paths';
import { useI18n, type TKey } from '../i18n';

type Props = {
  title: string;
  label?: string;
  initialValue?: string;
  confirmLabel?: string;
  busy?: boolean;
  /** Names already in the folder (for inline duplicate warnings). */
  siblings?: string[];
  isFolder?: boolean;
  icon?: ReactNode;
  error?: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
};

const PROBLEM_KEYS: Record<NameProblem, TKey> = {
  empty: 'names.empty',
  'invalid-char': 'names.invalidChar',
  reserved: 'names.reserved',
  'too-long': 'names.tooLong',
  exists: 'names.exists',
};

export function NamePrompt({
  title,
  label,
  initialValue = '',
  confirmLabel,
  busy = false,
  siblings = [],
  isFolder = false,
  icon,
  error,
  onConfirm,
  onClose,
}: Props) {
  const { t } = useI18n();
  const [value, setValue] = useState(initialValue);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const problem = validateName(value, siblings, initialValue || undefined);

  useEffect(() => {
    const tm = window.setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const [a, b] = renameSelection(initialValue, isFolder);
      el.setSelectionRange(a, b);
    }, 30);
    return () => window.clearTimeout(tm);
  }, [initialValue, isFolder]);

  function submit() {
    setTouched(true);
    if (problem || busy) return;
    onConfirm(value.trim());
  }

  const shown = (touched || value !== initialValue) && problem && problem !== 'empty' ? t(PROBLEM_KEYS[problem]) : error;

  return (
    <Modal
      title={title}
      icon={icon}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="name-prompt-form" variant="primary" loading={busy} disabled={!!problem}>
            {confirmLabel || t('common.create')}
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
        <Field label={label || t('names.label')} error={shown}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              ref={inputRef}
              value={value}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              onChange={(e) => setValue(e.target.value)}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}
