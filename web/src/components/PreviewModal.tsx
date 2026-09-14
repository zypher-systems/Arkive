import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  Check,
  Download,
  FileText,
  Loader2,
  Music4,
  Pencil,
  X,
} from 'lucide-react';
import { api, contentUrl, downloadUrl, isPreviewable, type Node } from '../lib/api';
import { Button, IconButton } from './ui/Button';
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
      className="fixed inset-0 z-[95] flex items-center justify-center bg-[#03040c]/75 p-4 backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 360, damping: 30 }}
        className="glass-strong glass-hairline flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl shadow-[0_24px_80px_rgba(3,4,12,0.7)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/6 bg-white/[0.02] px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-arkive-accent/25 to-arkive-accent2/20 text-arkive-accent2 ring-1 ring-white/10">
              <FileText size={16} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-display text-lg font-bold tracking-tight">
                {node.name}
                {dirty ? (
                  <span className="ml-2 inline-block h-2 w-2 animate-pulse-soft rounded-full bg-arkive-accent2 align-middle shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                ) : null}
              </h2>
              {status && (
                <p className="flex items-center gap-1 text-xs text-emerald-300">
                  <Check size={11} /> {status}
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            {editable && !editing && (
              <Button
                size="sm"
                variant="primary"
                icon={<Pencil size={13} />}
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
                  icon={saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  onClick={() => void save()}
                >
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  size="sm"
                  variant="glass"
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/8 px-2.5 py-1.5 text-xs font-medium text-arkive-muted transition hover:border-arkive-accent/50 hover:text-arkive-text"
            >
              <Download size={13} /> Download
            </a>
            <IconButton label="Close" onClick={requestClose}>
              <X size={16} />
            </IconButton>
          </div>
        </div>
        <div className="scroll-slim min-h-0 flex-1 overflow-auto p-5">
          {error && (
            <p className="mb-3 flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </p>
          )}
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
            <div className="flex flex-col items-center justify-center gap-5 py-14">
              <div className="relative">
                <div className="absolute inset-0 scale-150 rounded-full bg-arkive-accent/25 blur-2xl" aria-hidden />
                <div className="glass relative flex h-20 w-20 items-center justify-center rounded-3xl text-arkive-accent2">
                  <Music4 size={32} />
                </div>
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
              className="scroll-slim h-[70vh] w-full resize-none rounded-2xl border border-white/8 bg-black/30 p-4 font-mono text-xs leading-relaxed text-arkive-text outline-none transition focus:border-arkive-accent/60 focus:shadow-[0_0_0_3px_rgba(139,92,246,0.15)]"
            />
          )}
          {isText && !editing && text !== null && (
            <pre className="scroll-slim overflow-auto rounded-2xl border border-white/6 bg-black/25 p-4 text-left text-xs leading-relaxed text-arkive-text">
              {text}
            </pre>
          )}
          {isText && text === null && !error && (
            <div className="space-y-2" aria-hidden>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="skeleton h-4" style={{ width: `${90 - i * 9}%`, animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>
          )}
          {!isImage && !isPdf && !isVideo && !isAudio && !isText && (
            <p className="py-10 text-center text-sm text-arkive-muted">No inline preview for this type.</p>
          )}
        </div>
      </motion.div>
    </div>
  );
}
