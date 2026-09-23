import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { contentUrl, downloadUrl, type Node } from '../../lib/api';
import { useFocusTrap } from '../../lib/hooks';
import { useI18n } from '../../i18n';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  InfoIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '../icons';
import { Spinner } from '../ui/Spinner';
import { FileGlyph } from './FileThumb';
import { fileCategory } from './types';

const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6];

function ViewerButton({
  label,
  onClick,
  children,
  href,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  href?: string;
  disabled?: boolean;
}) {
  const cls =
    'flex h-10 w-10 items-center justify-center rounded-full text-white/85 transition hover:bg-white/12 hover:text-white disabled:opacity-35 disabled:hover:bg-transparent coarse:h-11 coarse:w-11 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#f1bd66]';
  if (href) {
    return (
      <a href={href} aria-label={label} title={label} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}

/**
 * Full-screen media viewer (lightbox) for images, video, audio and PDF.
 * ←/→ navigate the folder's media, +/−/0 zoom images, Esc closes. On touch
 * devices, swipe left/right to navigate.
 */
export function Viewer({
  items,
  index,
  onIndex,
  onClose,
  onInfo,
}: {
  items: Node[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onInfo?: (n: Node) => void;
}) {
  const { t, formatBytes } = useI18n();
  const node = items[index];
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  useFocusTrap(ref);

  const cat = node ? fileCategory(node.name, node.mime) : 'other';
  const isImage = cat === 'image';
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setLoaded(false);
  }, [node?.id]);

  // Preload neighbours for instant navigation.
  useEffect(() => {
    for (const i of [index - 1, index + 1]) {
      const n = items[i];
      if (n && fileCategory(n.name, n.mime) === 'image') {
        const img = new Image();
        img.src = contentUrl(n.id);
      }
    }
  }, [index, items]);

  const step = useCallback(
    (dir: 1 | -1) => {
      const next = index + dir;
      if (next >= 0 && next < items.length) onIndex(next);
    },
    [index, items.length, onIndex],
  );

  const zoomBy = useCallback((dir: 1 | -1) => {
    setZoom((z) => {
      const idx = ZOOMS.findIndex((v) => v >= z - 1e-6);
      const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (idx < 0 ? 3 : idx) + dir))];
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        step(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        step(-1);
      } else if (isImage && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        zoomBy(1);
      } else if (isImage && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        zoomBy(-1);
      } else if (isImage && e.key === '0') {
        e.preventDefault();
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, step, zoomBy, isImage]);

  if (!node) return null;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={t('viewer.label', { name: node.name })}
      className="animate-fade-in fixed inset-0 z-[140] flex flex-col bg-[#0b0c0e] text-white"
    >
      <div className="flex h-14 shrink-0 items-center gap-2 px-2 sm:px-4">
        <ViewerButton label={t('viewer.close')} onClick={onClose}>
          <CloseIcon size={19} />
        </ViewerButton>
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-base font-medium text-white">{node.name}</p>
          <p className="truncate text-xs text-white/60">
            {items.length > 1 && t('viewer.position', { index: index + 1, total: items.length })}
            {items.length > 1 && ' · '}
            {formatBytes(node.size)}
          </p>
        </div>
        {isImage && (
          <div className="hidden items-center gap-1 sm:flex">
            <ViewerButton label={t('viewer.zoomOut')} onClick={() => zoomBy(-1)} disabled={zoom <= ZOOMS[0]}>
              <ZoomOutIcon size={18} />
            </ViewerButton>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              className="h-8 min-w-14 rounded-full px-2 text-sm text-white/80 tabular-nums transition hover:bg-white/12"
              aria-label={t('viewer.zoomReset')}
              title={t('viewer.zoomReset')}
            >
              {Math.round(zoom * 100)}%
            </button>
            <ViewerButton label={t('viewer.zoomIn')} onClick={() => zoomBy(1)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]}>
              <ZoomInIcon size={18} />
            </ViewerButton>
            <span className="mx-1 h-6 w-px bg-white/15" />
          </div>
        )}
        {onInfo && (
          <ViewerButton label={t('viewer.info')} onClick={() => onInfo(node)}>
            <InfoIcon size={18} />
          </ViewerButton>
        )}
        <ViewerButton label={t('common.download')} href={downloadUrl(node.id)}>
          <DownloadIcon size={18} />
        </ViewerButton>
      </div>

      <div
        data-autofocus
        tabIndex={-1}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden outline-none"
        onWheel={(e) => {
          if (!isImage || !(e.ctrlKey || e.metaKey)) return;
          e.preventDefault();
          zoomBy(e.deltaY < 0 ? 1 : -1);
        }}
        onPointerDown={(e) => {
          if (e.pointerType !== 'mouse') swipe.current = { x: e.clientX, y: e.clientY };
          if (isImage && zoom > 1) {
            drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          d.moved = true;
          setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
        }}
        onPointerUp={(e) => {
          drag.current = null;
          const s = swipe.current;
          swipe.current = null;
          if (s && zoom <= 1) {
            const dx = e.clientX - s.x;
            const dy = e.clientY - s.y;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
          }
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {isImage && (
          <>
            {!loaded && <Spinner size={28} className="absolute text-white/60" />}
            <img
              key={node.id}
              src={contentUrl(node.id)}
              alt={node.name}
              draggable={false}
              onLoad={() => setLoaded(true)}
              onDoubleClick={() => {
                if (zoom === 1) setZoom(2);
                else {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }
              }}
              className={`max-h-full max-w-full object-contain transition-[opacity] duration-200 select-none ${loaded ? 'opacity-100' : 'opacity-0'} ${zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transition: drag.current ? 'none' : 'transform 0.15s ease-out, opacity 0.2s',
              }}
            />
          </>
        )}
        {cat === 'video' && (
          <video key={node.id} src={contentUrl(node.id)} controls autoPlay className="max-h-full max-w-full bg-black" />
        )}
        {cat === 'audio' && (
          <div className="flex w-full max-w-md flex-col items-center gap-6 px-6">
            <FileGlyph name={node.name} mime={node.mime} size={112} />
            <audio key={node.id} src={contentUrl(node.id)} controls autoPlay className="w-full" />
          </div>
        )}
        {cat === 'pdf' && (
          <iframe
            key={node.id}
            title={node.name}
            src={contentUrl(node.id)}
            className="h-full w-full max-w-5xl bg-white sm:rounded-t-lg"
          />
        )}

        {hasPrev && (
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={t('viewer.previous')}
            className="absolute top-1/2 left-2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white/90 transition hover:bg-black/60 sm:flex"
          >
            <ChevronLeftIcon size={22} />
          </button>
        )}
        {hasNext && (
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={t('viewer.next')}
            className="absolute top-1/2 right-2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white/90 transition hover:bg-black/60 sm:flex"
          >
            <ChevronRightIcon size={22} />
          </button>
        )}
      </div>

      {items.length > 1 && isImage && (
        <div className="hidden h-20 shrink-0 items-center justify-center gap-1.5 overflow-x-auto px-4 pb-3 sm:flex" aria-hidden>
          {items.slice(Math.max(0, index - 6), index + 7).map((n) => {
            const i = items.indexOf(n);
            return (
              <button
                key={n.id}
                type="button"
                tabIndex={-1}
                onClick={() => onIndex(i)}
                className={`h-14 w-14 shrink-0 overflow-hidden rounded-md transition ${
                  i === index ? 'ring-2 ring-[#f1bd66]' : 'opacity-55 hover:opacity-100'
                }`}
              >
                {fileCategory(n.name, n.mime) === 'image' ? (
                  <img src={`/api/nodes/${n.id}/thumb`} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <FileGlyph name={n.name} mime={n.mime} size={56} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>,
    document.body,
  );
}
