import { useEffect, useRef, useState } from 'react';
import {
  AlertIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  RefreshIcon,
  UploadIcon,
} from '../icons';
import { IconButton, Button } from '../ui/Button';
import { ProgressBar } from '../ui/Card';
import { Spinner } from '../ui/Spinner';
import { FileGlyph } from '../files/FileThumb';
import { useUploads, uploadStats, type InterruptedUpload, type UploadItem } from '../../lib/uploads';
import { useI18n } from '../../i18n';
import { formatDuration } from '../../i18n/format';

function ItemRow({ item }: { item: UploadItem }) {
  const { t, formatBytes } = useI18n();
  const { engine } = useUploads();
  const pct = item.size ? item.sent / item.size : item.status === 'done' ? 1 : 0;
  let status: React.ReactNode;
  switch (item.status) {
    case 'queued':
      status = t('upload.queued');
      break;
    case 'uploading':
      status = (
        <>
          {t('upload.progress', { sent: formatBytes(item.sent), total: formatBytes(item.size) })}
          {item.rate > 0 && <> · {t('upload.rate', { rate: formatBytes(item.rate) })}</>}
          {item.resumed && <> · {t('upload.resumed')}</>}
        </>
      );
      break;
    case 'done':
      status = t('upload.doneIn', { folder: item.dir ? `${item.target.label}/${item.dir}` : item.target.label });
      break;
    case 'error':
      status = <span className="text-danger">{item.error || t('upload.failed')}</span>;
      break;
    default:
      status = t('upload.canceled');
  }
  return (
    <li className="group flex items-center gap-3 px-4 py-2.5">
      <FileGlyph name={item.name} size={32} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink" title={item.dir ? `${item.dir}/${item.name}` : item.name}>
          {item.name}
        </p>
        {item.status === 'uploading' && <ProgressBar value={pct} size="xs" className="my-1" label={item.name} />}
        <p className="truncate text-xs text-muted">{status}</p>
      </div>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center">
        {item.status === 'done' && <CheckCircleIcon size={17} className="text-ok" />}
        {(item.status === 'queued' || item.status === 'uploading') && (
          <IconButton label={t('upload.cancelItem', { name: item.name })} size="sm" onClick={() => engine.cancel(item.id)}>
            <CloseIcon size={14} />
          </IconButton>
        )}
        {(item.status === 'error' || item.status === 'canceled') && (
          <IconButton label={t('upload.retryItem', { name: item.name })} size="sm" onClick={() => engine.retry(item.id)}>
            <RefreshIcon size={14} />
          </IconButton>
        )}
      </div>
    </li>
  );
}

function InterruptedRow({ u }: { u: InterruptedUpload }) {
  const { t, formatBytes } = useI18n();
  const { engine } = useUploads();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <FileGlyph name={u.name} size={32} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{u.name}</p>
        <p className="truncate text-xs text-muted">{t('upload.interruptedHint', { size: formatBytes(u.size) })}</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          engine.enqueue([{ file: f, relPath: f.name }], {
            workspaceId: u.workspaceId,
            parentId: u.parentId,
            label: t('upload.previousFolder'),
          });
        }}
      />
      <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>
        {t('upload.resume')}
      </Button>
      <IconButton label={t('upload.discard', { name: u.name })} size="sm" onClick={() => engine.dismissInterrupted(u.key)}>
        <CloseIcon size={14} />
      </IconButton>
    </li>
  );
}

export function UploadPanel() {
  const { t, formatBytes } = useI18n();
  const { items, interrupted, engine } = useUploads();
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const lastCount = useRef(items.length);
  const s = uploadStats(items);
  const running = s.active + s.queued > 0;

  // New uploads re-open a dismissed/collapsed panel.
  useEffect(() => {
    if (items.length > lastCount.current) {
      setHidden(false);
      setCollapsed(false);
    }
    lastCount.current = items.length;
  }, [items.length]);

  if (hidden || (items.length === 0 && interrupted.length === 0)) return null;

  const title = running
    ? t('upload.titleRunning', { count: s.active + s.queued })
    : s.failed > 0
      ? t('upload.titleFailed', { count: s.failed })
      : items.length > 0
        ? t('upload.titleDone', { count: s.done })
        : t('upload.titleInterrupted', { count: interrupted.length });

  const sub = running
    ? [
        t('upload.doneOf', { done: s.done, total: s.total - s.canceled }),
        t('upload.progress', { sent: formatBytes(s.bytesSent), total: formatBytes(s.bytesTotal) }),
        s.rate > 0 ? t('upload.rate', { rate: formatBytes(s.rate) }) : null,
        s.eta != null && s.rate > 0 ? t('upload.eta', { time: formatDuration(s.eta) }) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : s.failed > 0
      ? t('upload.summary', { done: s.done, failed: s.failed })
      : null;

  const HeaderIcon = running ? null : s.failed > 0 ? AlertIcon : items.length ? CheckCircleIcon : UploadIcon;

  return (
    <section
      aria-label={t('upload.panel')}
      className="animate-fade-up fixed inset-x-2 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-[60] overflow-hidden rounded-xl border border-line bg-raised shadow-lg sm:inset-x-auto sm:right-4 sm:w-[380px] lg:right-6 lg:bottom-6"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            running ? 'bg-accent-soft text-accent' : s.failed ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok'
          }`}
        >
          {running ? <Spinner size={16} /> : HeaderIcon && <HeaderIcon size={16} />}
        </span>
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="truncate text-base font-semibold text-ink">{title}</p>
          {sub && <p className="truncate text-xs text-muted tabular-nums">{sub}</p>}
        </div>
        <IconButton
          label={collapsed ? t('upload.expand') : t('upload.collapse')}
          size="sm"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? <ChevronUpIcon size={15} /> : <ChevronDownIcon size={15} />}
        </IconButton>
        {!running && (
          <IconButton
            label={t('upload.closePanel')}
            size="sm"
            onClick={() => {
              engine.clearFinished();
              setHidden(true);
            }}
          >
            <CloseIcon size={15} />
          </IconButton>
        )}
      </div>
      {running && <ProgressBar value={s.bytesTotal ? s.bytesSent / s.bytesTotal : 0} size="xs" className="mx-4 mb-2" label={title} />}
      {!collapsed && (
        <>
          <ul className="scroll-slim max-h-[min(18rem,45dvh)] divide-y divide-line overflow-y-auto border-t border-line">
            {interrupted.map((u) => (
              <InterruptedRow key={u.key} u={u} />
            ))}
            {items.map((i) => (
              <ItemRow key={i.id} item={i} />
            ))}
          </ul>
          {(running || s.failed > 0) && (
            <div className="flex items-center justify-end gap-2 border-t border-line bg-inset/60 px-4 py-2">
              {s.failed > 0 && (
                <Button size="sm" variant="secondary" icon={<RefreshIcon size={14} />} onClick={() => engine.retryFailed()}>
                  {t('upload.retryFailed')}
                </Button>
              )}
              {running && (
                <Button size="sm" variant="ghost" onClick={() => engine.cancelAll()}>
                  {t('upload.cancelAll')}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
