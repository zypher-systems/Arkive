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
  const isImage =
    mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico|jfif)$/i.test(name);
  const isPdf = mime === 'application/pdf' || name.endsWith('.pdf');
  const isVideo =
    mime.startsWith('video/') || /\.(mp4|webm|ogg|ogv|mov|m4v|mkv)$/i.test(name);
  const isAudio =
    mime.startsWith('audio/') || /\.(mp3|wav|ogg|oga|m4a|flac|aac|opus)$/i.test(name);
  const isText =
    !isImage &&
    !isPdf &&
    !isVideo &&
    !isAudio &&
    (mime.startsWith('text/') ||
      mime === 'application/json' ||
      mime === 'application/xml' ||
      mime === 'application/javascript' ||
      mime === 'application/x-sh' ||
      mime === 'application/x-yaml' ||
      /\.(txt|md|markdown|json|ya?ml|toml|csv|tsv|log|go|tsx?|jsx?|mjs|cjs|py|rs|css|scss|less|html?|xml|sh|bash|zsh|ini|conf|cfg|env|sql|rb|java|kt|c|cc|cpp|h|hpp|php|vue|svelte|swift|dart|lua|r|pl|ps1)$/i.test(
        name,
      ));

  useEffect(() => {
    if (!isText || !isPreviewable(node)) return;
    let cancelled = false;
    void fetch(contentUrl(node.id), { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Preview failed');
        // Cap huge text files in the modal
        const buf = await res.arrayBuffer();
        const max = 512 * 1024;
        const slice = buf.byteLength > max ? buf.slice(0, max) : buf;
        const body = new TextDecoder().decode(slice);
        const truncated = buf.byteLength > max ? `${body}\n\n… truncated …` : body;
        if (!cancelled) setText(truncated);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Preview failed');
      });
    return () => {
      cancelled = true;
    };
  }, [node, isText]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
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
          {isVideo && (
            <video
              src={contentUrl(node.id)}
              controls
              className="mx-auto max-h-[70vh] w-full rounded-lg bg-black"
            />
          )}
          {isAudio && (
            <div className="flex flex-col items-center justify-center gap-4 py-10">
              <p className="text-sm text-arkive-muted">Audio preview</p>
              <audio src={contentUrl(node.id)} controls className="w-full max-w-lg" />
            </div>
          )}
          {isText && text !== null && (
            <pre className="overflow-auto rounded-lg border border-arkive-border bg-arkive-bg p-4 text-left text-xs leading-relaxed text-arkive-text">
              {text}
            </pre>
          )}
          {isText && text === null && !error && (
            <p className="text-sm text-arkive-muted">Loading preview…</p>
          )}
          {!isImage && !isPdf && !isVideo && !isAudio && !isText && (
            <p className="text-sm text-arkive-muted">No inline preview for this type.</p>
          )}
        </div>
      </div>
    </div>
  );
}
