import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, contentUrl, downloadUrl, type Node } from '../../lib/api';
import { renderMarkdown } from '../../lib/markdown';
import { parseDelimited } from '../../lib/csv';
import { useFocusTrap, isMac } from '../../lib/hooks';
import { useI18n } from '../../i18n';
import { ArrowLeftIcon, CheckIcon, CodeIcon, DownloadIcon, EyeIcon, SaveIcon, SplitIcon } from '../icons';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { Notice } from '../ui/Notice';
import { Spinner } from '../ui/Spinner';
import { ConfirmDialog } from '../ConfirmDialog';
import { FileGlyph } from '../files/FileThumb';
import { isMarkdownName } from '../files/types';

const MAX_EDIT_BYTES = 2 * 1024 * 1024;
// The server refuses whole text bodies over 2 MB (413) but serves ranges;
// a large file opens read-only with its first bytes.
const PEEK_BYTES = 64 * 1024;

type Pane = 'edit' | 'split' | 'preview';

function previewKind(name: string): 'markdown' | 'csv' | 'tsv' | 'json' | null {
  if (isMarkdownName(name)) return 'markdown';
  if (/\.csv$/i.test(name)) return 'csv';
  if (/\.tsv$/i.test(name)) return 'tsv';
  if (/\.json$/i.test(name)) return 'json';
  return null;
}

function Preview({ kind, text }: { kind: 'markdown' | 'csv' | 'tsv' | 'json'; text: string }) {
  const { t } = useI18n();
  const html = useMemo(() => (kind === 'markdown' ? renderMarkdown(text) : ''), [kind, text]);
  const rows = useMemo(() => (kind === 'csv' || kind === 'tsv' ? parseDelimited(text, kind === 'tsv' ? '\t' : ',') : []), [kind, text]);
  const json = useMemo(() => {
    if (kind !== 'json') return null;
    try {
      return { ok: true as const, value: JSON.stringify(JSON.parse(text), null, 2) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }, [kind, text]);

  if (kind === 'markdown') {
    // eslint-disable-next-line react/no-danger -- sanitized by DOMPurify in renderMarkdown
    return <article className="prose-ark mx-auto max-w-3xl px-6 py-8 sm:px-10" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  if (kind === 'json' && json) {
    return json.ok ? (
      <pre className="px-6 py-6 font-mono text-sm leading-relaxed whitespace-pre-wrap text-ink">{json.value}</pre>
    ) : (
      <div className="p-6">
        <Notice kind="error" title={t('editor.invalidJson')}>
          {json.error}
        </Notice>
      </div>
    );
  }
  const [head, ...body] = rows;
  return (
    <div className="p-4">
      <table className="w-full border-collapse text-sm">
        {head && (
          <thead className="sticky top-0">
            <tr>
              {head.map((h, i) => (
                <th key={i} className="border border-line bg-inset px-3 py-1.5 text-left font-semibold whitespace-nowrap text-ink">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="even:bg-inset/50">
              {r.map((c, j) => (
                <td key={j} className="border border-line px-3 py-1.5 whitespace-nowrap text-ink">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Full-screen text editor (textarea) with optional live preview for
 * Markdown, CSV/TSV and JSON. Ctrl/⌘+S saves via PUT /api/nodes/{id}/content.
 */
export default function TextEditor({
  node,
  canWrite,
  onClose,
  onSaved,
}: {
  node: Node;
  canWrite: boolean;
  onClose: () => void;
  onSaved: (n: Node) => void;
}) {
  const { t, formatRelative } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [tooLarge, setTooLarge] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const kind = previewKind(node.name);
  const [pane, setPane] = useState<Pane>(() => {
    if (!kind) return 'edit';
    if (kind === 'markdown') return window.innerWidth >= 900 ? 'split' : canWrite ? 'edit' : 'preview';
    return 'edit';
  });
  useFocusTrap(ref);

  const readOnly = !canWrite || tooLarge;
  const dirty = original !== null && draft !== original;

  useEffect(() => {
    let cancelled = false;
    const big = (node.size || 0) > MAX_EDIT_BYTES;
    fetch(contentUrl(node.id), { credentials: 'include', headers: big ? { Range: `bytes=0-${PEEK_BYTES - 1}` } : undefined })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('editor.loadFailed'));
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        const over = big || buf.byteLength > MAX_EDIT_BYTES;
        setTooLarge(over);
        const text = new TextDecoder().decode(over ? buf.slice(0, MAX_EDIT_BYTES) : buf);
        setOriginal(text);
        setDraft(text);
        window.setTimeout(() => taRef.current?.focus({ preventScroll: true }), 0);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : t('editor.loadFailed')));
    return () => {
      cancelled = true;
    };
  }, [node.id, t]);

  const save = useCallback(async () => {
    if (readOnly || saving || original === null) return;
    const content = draft;
    setSaving(true);
    setError('');
    try {
      const updated = await api.putNodeContent(node.id, content, node.mime || (kind === 'markdown' ? 'text/markdown; charset=utf-8' : undefined));
      setOriginal(content);
      setSavedAt(new Date());
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('editor.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [readOnly, saving, original, draft, node.id, node.mime, kind, onSaved, t]);

  const requestClose = useCallback(() => {
    if (dirty) setConfirmClose(true);
    else onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      } else if (e.key === 'Escape' && !confirmClose) {
        e.stopPropagation();
        requestClose();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [save, requestClose, confirmClose]);

  // Warn about unsaved changes when leaving the page.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const status = saving
    ? t('editor.saving')
    : dirty
      ? t('editor.unsaved')
      : savedAt
        ? t('editor.savedAgo', { when: formatRelative(savedAt) })
        : readOnly
          ? t('editor.readOnly')
          : '';

  const showEditor = pane !== 'preview' || !kind;
  const showPreview = !!kind && pane !== 'edit';

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={t('editor.label', { name: node.name })}
      className="animate-fade-in fixed inset-0 z-[140] flex flex-col bg-surface"
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-2 sm:gap-3 sm:px-4">
        <IconButton label={t('editor.close')} size="lg" onClick={requestClose}>
          <ArrowLeftIcon size={18} />
        </IconButton>
        <FileGlyph name={node.name} mime={node.mime} size={28} />
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 truncate text-base font-semibold text-ink">
            <span className="truncate">{node.name}</span>
            {dirty && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />}
          </h2>
          <p className="truncate text-xs text-muted" aria-live="polite">
            {status}
          </p>
        </div>
        {kind && (
          <Segmented
            size="sm"
            label={t('editor.layout')}
            value={pane}
            onChange={setPane}
            items={[
              { value: 'edit', icon: <CodeIcon size={14} />, title: t('editor.edit') },
              ...(kind === 'markdown' ? [{ value: 'split' as const, icon: <SplitIcon size={14} />, title: t('editor.split') }] : []),
              { value: 'preview', icon: <EyeIcon size={14} />, title: t('editor.preview') },
            ]}
            className={kind === 'markdown' ? '[&>button:nth-child(2)]:max-md:hidden' : ''}
          />
        )}
        <IconButton label={t('common.download')} size="lg" className="hidden sm:inline-flex" onClick={() => window.open(downloadUrl(node.id), '_blank')}>
          <DownloadIcon size={17} />
        </IconButton>
        {!readOnly && (
          <Button
            variant="primary"
            size="md"
            loading={saving}
            disabled={!dirty}
            icon={dirty ? <SaveIcon size={15} /> : <CheckIcon size={15} />}
            onClick={() => void save()}
            title={`${t('editor.save')} (${isMac ? '⌘' : 'Ctrl'}+S)`}
          >
            <span className="hidden sm:inline">{dirty ? t('editor.save') : t('editor.saved')}</span>
          </Button>
        )}
      </header>

      {(error || tooLarge) && (
        <div className="space-y-2 border-b border-line px-4 py-3">
          {error && <Notice kind="error">{error}</Notice>}
          {tooLarge && <Notice kind="warning">{t('editor.tooLarge')}</Notice>}
        </div>
      )}

      {original === null && !error ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner size={24} className="text-faint" />
        </div>
      ) : (
        <div className={`grid min-h-0 flex-1 ${showEditor && showPreview ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
          {showEditor && (
            <textarea
              ref={taRef}
              value={draft}
              readOnly={readOnly}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Tab' && !e.shiftKey && !readOnly) {
                  e.preventDefault();
                  const el = e.currentTarget;
                  const { selectionStart: a, selectionEnd: b } = el;
                  const next = `${draft.slice(0, a)}  ${draft.slice(b)}`;
                  setDraft(next);
                  window.requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
                }
              }}
              spellCheck={kind === 'markdown'}
              aria-label={t('editor.content')}
              className={`scroll-slim h-full min-h-0 w-full resize-none bg-surface px-5 py-5 font-mono text-[13.5px] leading-relaxed text-ink outline-none sm:px-8 ${
                showPreview ? 'border-line max-md:hidden md:border-r' : ''
              }`}
            />
          )}
          {showPreview && (
            <div className="scroll-slim min-h-0 overflow-auto bg-app" aria-label={t('editor.preview')} role="region">
              <Preview kind={kind!} text={draft} />
            </div>
          )}
        </div>
      )}

      {confirmClose && (
        <ConfirmDialog
          title={t('editor.discardTitle')}
          message={t('editor.discardMessage', { name: node.name })}
          confirmLabel={t('editor.discard')}
          onConfirm={() => {
            setConfirmClose(false);
            onClose();
          }}
          onClose={() => setConfirmClose(false)}
        />
      )}
    </div>,
    document.body,
  );
}
