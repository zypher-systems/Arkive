import { useEffect, useState } from 'react';
import { contentUrl, downloadUrl, isPreviewable, type Node } from '../lib/api';

type Props = {
  node: Node;
  onClose: () => void;
};

export function PreviewModal({ node, onClose }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const mime = (node.mime || '').toLowerCase();
  const name = node.name.toLowerCase();
  const isImage = mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name);
  const isPdf = mime === 'application/pdf' || name.endsWith('.pdf');
  const isText =
    mime.startsWith('text/') ||
    /\.(txt|md|json|ya?ml|toml|csv|log|go|tsx?|jsx?|py|rs|css|html|xml|sh)$/i.test(name);

  useEffect(() => {
    if (!isText || !isPreviewable(node)) return;
    let cancelled = false;
    void fetch(contentUrl(node.id), { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Preview failed');
        const body = await res.text();
        if (!cancelled) setText(body);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Preview failed');
      });
    return () => {
      cancelled = true;
    };
  }, [node, isText]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-arkive-border bg-arkive-surface shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-arkive-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg font-bold">{node.name}</h2>
          </div>
          <div className="flex gap-2">
            <a
              href={downloadUrl(node.id)}
              className="rounded-lg border border-arkive-border px-3 py-1.5 text-sm hover:border-arkive-amber/40"
            >
              Download
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-arkive-muted hover:bg-arkive-panel"
            >
              Close
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {error && <p className="text-sm text-red-300">{error}</p>}
          {isImage && (
            <img
              src={contentUrl(node.id)}
              alt={node.name}
              className="mx-auto max-h-[70vh] max-w-full object-contain"
            />
          )}
          {isPdf && (
            <iframe
              title={node.name}
              src={contentUrl(node.id)}
              className="h-[70vh] w-full rounded-lg border border-arkive-border bg-white"
            />
          )}
          {isText && text !== null && (
            <pre className="overflow-auto rounded-lg border border-arkive-border bg-arkive-bg p-4 text-left text-xs leading-relaxed text-arkive-text">
              {text}
            </pre>
          )}
          {isText && text === null && !error && (
            <p className="text-sm text-arkive-muted">Loading preview…</p>
          )}
          {!isImage && !isPdf && !isText && (
            <p className="text-sm text-arkive-muted">No inline preview for this type.</p>
          )}
        </div>
      </div>
    </div>
  );
}
