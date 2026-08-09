import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (!busy && e.target === e.currentTarget) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-prompt-title"
        className="w-full max-w-md rounded-2xl border border-arkive-border bg-arkive-surface p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 id="name-prompt-title" className="font-display text-xl font-bold">
          {title}
        </h2>
        <label className="mt-4 block text-sm">
          <span className="mb-1 block text-arkive-muted">{label}</span>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
            className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2 outline-none focus:ring-2 focus:ring-arkive-amber/40 disabled:opacity-50"
            autoComplete="off"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-arkive-border px-3 py-2 text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="rounded-lg bg-gradient-to-r from-arkive-orange to-arkive-amber px-3 py-2 text-sm font-semibold text-black disabled:opacity-50"
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
