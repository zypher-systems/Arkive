import { useCallback, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';

export type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  run: () => void | Promise<void>;
};

export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const requestRef = useRef<ConfirmRequest | null>(null);

  const ask = useCallback((req: ConfirmRequest) => {
    requestRef.current = req;
    // Defer so the opening click cannot land on the new dialog.
    window.setTimeout(() => setRequest(req), 0);
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    requestRef.current = null;
    setRequest(null);
  }, [busy]);

  const onConfirm = useCallback(async () => {
    const req = requestRef.current;
    if (!req) return;
    setBusy(true);
    try {
      await req.run();
      requestRef.current = null;
      setRequest(null);
    } catch {
      // Leave dialog open; caller surfaces the error.
    } finally {
      setBusy(false);
    }
  }, []);

  const dialog = request ? (
    <ConfirmDialog
      title={request.title}
      message={request.message}
      confirmLabel={request.confirmLabel}
      busy={busy}
      onConfirm={() => void onConfirm()}
      onClose={close}
    />
  ) : null;

  return { ask, dialog, isOpen: !!request };
}
