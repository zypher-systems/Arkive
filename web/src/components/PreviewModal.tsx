import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AudioIcon,
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  PencilIcon,
  SpinnerIcon,
} from './icons';
import { api, contentUrl, downloadUrl, isPreviewable, type Node } from '../lib/api';
import { Button, IconButton } from './ui/Button';
import { Notice } from './ui/Notice';
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

  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-[95] flex items-center justify-center bg-overlay p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="animate-fade-up flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold">
              {node.name}
              {dirty ? (
                <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />
              ) : null}
            </h2>
            {status && (
              <p className="flex shrink-0 items-center gap-1 text-xs text-ok">
                <CheckIcon size={11} /> {status}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            {editable && !editing && (
              <Button
                size="sm"
                variant="primary"
                icon={<PencilIcon size={13} />}
                onClick={() => {
                  setEditing(true);
                  setStatus('');
                  setError('');
                }}
              >
                Edit
              </Button>
            )}
            {editing && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={saving || !dirty}
                  icon={saving ? <SpinnerIcon size={13} className="animate-spin" /> : <CheckIcon size={13} />}
                  onClick={() => void save()}
                >
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={saving}
                  onClick={() => {
                    if (dirty && !window.confirm('Discard unsaved changes?')) return;
                    setEditing(false);
                    setDraft(text ?? '');
                    setError('');
                  }}
                >
                  Cancel
                </Button>
              </>
            )}
            <a
              href={downloadUrl(node.id)}
              className="inline-flex items-center gap-1.5 rounded-md border border-strong px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-hover hover:text-ink"
            >
              <DownloadIcon size={13} /> Download
            </a>
            <IconButton label="Close" onClick={requestClose}>
              <CloseIcon size={14} />
            </IconButton>
          </div>
        </div>
        <div className="scroll-slim min-h-0 flex-1 overflow-auto bg-inset p-5">
          {error && <Notice kind="error" className="mb-3">{error}</Notice>}
          {isText && truncated && (
            <p className="mb-3 text-sm text-muted">
              File is larger than 2 MB — showing a truncated preview. Download to edit outside
              Arkive.
            </p>
          )}
          {isImage && (
            <img
              src={contentUrl(node.id)}
              alt={node.name}
              className="mx-auto max-h-[70vh] max-w-full rounded-md object-contain"
            />
          )}
          {isPdf && (
            <iframe
              title={node.name}
              src={contentUrl(node.id)}
              className="h-[70vh] w-full rounded-md border border-line bg-white"
            />
          )}
          {isVideo && (
            <video
              src={contentUrl(node.id)}
              controls
              className="mx-auto max-h-[70vh] w-full rounded-md bg-black"
            />
          )}
          {isAudio && (
            <div className="flex flex-col items-center justify-center gap-5 py-14">
              <div className="flex h-14 w-14 items-center justify-center rounded-md border border-line bg-surface text-faint">
                <AudioIcon size={26} />
              </div>
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
              className="scroll-slim input-field h-[70vh] resize-none p-4 font-mono text-xs leading-relaxed"
            />
          )}
          {isText && !editing && text !== null && (
            <pre className="scroll-slim overflow-auto rounded-md border border-line bg-surface p-4 text-left font-mono text-xs leading-relaxed">
              {text}
            </pre>
          )}
          {isText && text === null && !error && (
            <div className="space-y-2" aria-hidden>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="skeleton h-4" style={{ width: `${90 - i * 9}%` }} />
              ))}
            </div>
          )}
          {!isImage && !isPdf && !isVideo && !isAudio && !isText && (
            <p className="py-10 text-center text-sm text-muted">No inline preview for this type.</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
