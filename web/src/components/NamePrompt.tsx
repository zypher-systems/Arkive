import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { FolderPlus, Loader2 } from 'lucide-react';
import { Button } from './ui/Button';

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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#03040c]/70 p-4 backdrop-blur-md"
      onMouseDown={(e) => {
        if (!busy && e.target === e.currentTarget) onClose();
      }}
    >
      <motion.form
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-prompt-title"
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="glass-strong glass-hairline w-full max-w-md rounded-3xl p-6 shadow-[0_24px_80px_rgba(3,4,12,0.7)]"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-arkive-accent/25 to-arkive-accent2/20 text-arkive-accent2 ring-1 ring-white/10">
            <FolderPlus size={18} />
          </div>
          <h2 id="name-prompt-title" className="font-display text-xl font-bold tracking-tight">
            {title}
          </h2>
        </div>
        <label className="mt-5 block text-sm">
          <span className="mb-1.5 block text-xs font-medium tracking-wide text-arkive-muted uppercase">
            {label}
          </span>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
            className="input-glass disabled:opacity-50"
            autoComplete="off"
          />
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="glass" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            className="font-semibold"
            disabled={busy || !value.trim()}
            icon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </motion.form>
    </div>,
    document.body,
  );
}
