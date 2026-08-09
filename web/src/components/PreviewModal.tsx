import { useEffect, useRef, useState } from 'react';
import { api, contentUrl, downloadUrl, isPreviewable, type Node } from '../lib/api';
import {
  isAudioNode,
  isImageNode,
  isPdfNode,
  isTextNode,
  isVideoNode,
} from './files/types';

const MAX_EDIT_BYTES = 2 * 1024 * 1024;

type Props = {
  node: Node;
  onClose: () => void;
  onSaved?: (node: Node) => void;
  startEditing?: boolean;
  canWrite?: boolean;
};

export function PreviewModal({
  node,
  onClose,
  onSaved,
  startEditing = false,
  canWrite = true,
}: Props) {
  const [text, setText] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [byteLength, setByteLength] = useState(0);
  const draftRef = useRef(draft);
  const editingRef = useRef(editing);
  draftRef.current = draft;
  editingRef.current = editing;

  const isImage = isImageNode(node);
  const isPdf = isPdfNode(node);
  const isVideo = isVideoNode(node);
  const isAudio = isAudioNode(node);
  const isText = !isImage && !isPdf && !isVideo && !isAudio && isTextNode(node);
  const dirty = editing && text !== null && draft !== text;
  const editable =
    isText && canWrite && !truncated && text !== null && byteLength <= MAX_EDIT_BYTES;

  useEffect(() => {
    setText(null);
    setDraft('');
    setError('');
    setStatus('');
    setEditing(false);
    setTruncated(false);
    setByteLength(0);
    if (!isText || !isPreviewable(node)) return;
    let cancelled = false;
    void fetch(contentUrl(node.id), { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Preview failed');
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        setByteLength(buf.byteLength);
        const overLimit = buf.byteLength > MAX_EDIT_BYTES;
        setTruncated(overLimit);
        const slice = overLimit ? buf.slice(0, MAX_EDIT_BYTES) : buf;
        const body = new TextDecoder().decode(slice);
        const display = overLimit ? `${body}\n\n… truncated …` : body;
        setText(display);
        setDraft(body);
        if (startEditing && !overLimit && canWrite) {
          setEditing(true);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Preview failed');
      });
    return () => {
      cancelled = true;
    };
  }, [node, isText, startEditing, canWrite]);

  function requestClose() {
    if (editingRef.current && draftRef.current !== text) {
      if (!window.confirm('Discard unsaved changes?')) return;
    }
    onClose();
  }

  const savingRef = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;

  async function save() {
    if (!canWrite || truncated || byteLength > MAX_EDIT_BYTES || savingRef.current) return;
    if (!editingRef.current) return;
    const content = draftRef.current;
    savingRef.current = true;
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const updated = await api.putNodeContent(node.id, content, node.mime);
      setText(content);
      setEditing(false);
      setByteLength(new TextEncoder().encode(content).length);
      setStatus('Saved');
      onSaved?.(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (editingRef.current) {
          if (draftRef.current !== textRef.current) {
            if (!window.confirm('Discard unsaved changes?')) return;
          }
          setEditing(false);
          setDraft(textRef.current ?? '');
          setError('');
          return;
        }
        requestClose();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && editingRef.current) {
        e.preventDefault();
        void save();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers use refs
  }, [onClose, canWrite, truncated, byteLength, node.id, node.mime, onSaved]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-arkive-border bg-arkive-surface shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-arkive-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg font-bold">
              {node.name}
              {dirty ? <span className="ml-2 text-arkive-amber">•</span> : null}
            </h2>
            {status && <p className="text-xs text-arkive-muted">{status}</p>}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {editable && !editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(true);
                  setStatus('');
                  setError('');
                }}
                className="rounded-lg border border-arkive-amber/40 bg-arkive-amber/10 px-3 py-1.5 text-sm text-arkive-amber hover:bg-arkive-amber/20"
              >
                Edit
              </button>
            )}
            {editing && (
              <>
                <button
                  type="button"
                  disabled={saving || !dirty}
                  onClick={() => void save()}
                  className="rounded-lg border border-arkive-amber/40 bg-arkive-amber/15 px-3 py-1.5 text-sm text-arkive-amber hover:bg-arkive-amber/25 disabled:opacity-40"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    if (dirty && !window.confirm('Discard unsaved changes?')) return;
                    setEditing(false);
                    setDraft(text ?? '');
                    setError('');
                  }}
                  className="rounded-lg border border-arkive-border px-3 py-1.5 text-sm hover:border-arkive-amber/40"
                >
                  Cancel
                </button>
              </>
            )}
            <a
              href={downloadUrl(node.id)}
              className="rounded-lg border border-arkive-border px-3 py-1.5 text-sm hover:border-arkive-amber/40"
            >
              Download
            </a>
            <button
              type="button"
              onClick={requestClose}
              className="rounded-lg px-3 py-1.5 text-sm text-arkive-muted hover:bg-arkive-panel"
            >
              Close
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {error && <p className="mb-3 text-sm text-red-300">{error}</p>}
          {isText && truncated && (
            <p className="mb-3 text-sm text-arkive-muted">
              File is larger than 2 MB — showing a truncated preview. Download to edit outside
              Arkive.
            </p>
          )}
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
          {isText && editing && (
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setStatus('');
              }}
              spellCheck={false}
              className="h-[70vh] w-full resize-none rounded-lg border border-arkive-border bg-arkive-bg p-4 font-mono text-xs leading-relaxed text-arkive-text outline-none focus:border-arkive-amber/50"
            />
          )}
          {isText && !editing && text !== null && (
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
