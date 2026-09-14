import { useEffect, useState } from 'react';
import { contentUrl, thumbUrl, type LiveDriveItem, type Node } from '../../lib/api';
import {
  fileTypeLabel,
  isAudioName,
  isAudioNode,
  isImageName,
  isImageNode,
  isPdfName,
  isPdfNode,
  isTextNode,
  isVideoName,
  isVideoNode,
  nameExtLabel,
  officeKind,
  type OfficeKind,
} from './types';

export function FolderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path
        d="M6 14c0-2.2 1.8-4 4-4h10l3 4h15c2.2 0 4 1.8 4 4v18c0 2.2-1.8 4-4 4H10c-2.2 0-4-1.8-4-4V14z"
        fill="currentColor"
        opacity="0.35"
      />
      <path
        d="M6 18h36v16c0 2.2-1.8 4-4 4H10c-2.2 0-4-1.8-4-4V18z"
        fill="currentColor"
      />
    </svg>
  );
}

function FileDocIcon({
  className,
  accent = 'currentColor',
}: {
  className?: string;
  accent?: string;
}) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path
        d="M12 6h16l10 10v26c0 1.1-.9 2-2 2H12c-1.1 0-2-.9-2-2V8c0-1.1.9-2 2-2z"
        fill={accent}
        opacity="0.2"
      />
      <path
        d="M28 6v10h10"
        fill="none"
        stroke={accent}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M12 6h16l10 10v26c0 1.1-.9 2-2 2H12c-1.1 0-2-.9-2-2V8c0-1.1.9-2 2-2z"
        fill="none"
        stroke={accent}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function VideoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <rect x="6" y="12" width="28" height="24" rx="3" fill="currentColor" opacity="0.25" />
      <rect
        x="6"
        y="12"
        width="28"
        height="24"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <path d="M34 20l10-5v18l-10-5V20z" fill="currentColor" />
    </svg>
  );
}

function AudioIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <circle cx="18" cy="32" r="7" fill="currentColor" opacity="0.3" />
      <circle cx="18" cy="32" r="7" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path
        d="M25 32V10l14 3v8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="39" cy="21" r="5" fill="currentColor" opacity="0.35" />
    </svg>
  );
}

function ArchiveIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <rect x="10" y="8" width="28" height="32" rx="2" fill="currentColor" opacity="0.2" />
      <rect
        x="10"
        y="8"
        width="28"
        height="32"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <path d="M22 8v32M26 8v32" stroke="currentColor" strokeWidth="2" opacity="0.7" />
      <rect x="20" y="20" width="8" height="6" rx="1" fill="currentColor" />
    </svg>
  );
}

const OFFICE_STYLE: Record<
  OfficeKind,
  { wrap: string; text: string; label: string; accent: string }
> = {
  word: {
    wrap: 'bg-blue-500/15 text-blue-300',
    text: 'text-blue-300',
    label: 'DOC',
    accent: 'currentColor',
  },
  excel: {
    wrap: 'bg-emerald-500/15 text-emerald-300',
    text: 'text-emerald-300',
    label: 'XLS',
    accent: 'currentColor',
  },
  powerpoint: {
    wrap: 'bg-orange-500/15 text-orange-300',
    text: 'text-orange-300',
    label: 'PPT',
    accent: 'currentColor',
  },
  archive: {
    wrap: 'bg-white/[0.06] text-arkive-muted',
    text: 'text-arkive-muted',
    label: 'ZIP',
    accent: 'currentColor',
  },
};

function OfficeBadge({
  kind,
  dense,
  label,
}: {
  kind: OfficeKind;
  dense: boolean;
  label?: string;
}) {
  const s = OFFICE_STYLE[kind];
  return (
    <span
      className={`flex flex-col items-center justify-center gap-0.5 ${s.wrap} ${
        dense
          ? 'h-9 w-9 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10'
          : 'h-full w-full'
      }`}
    >
      {kind === 'archive' ? (
        <ArchiveIcon className={dense ? 'h-5 w-5' : 'h-12 w-12'} />
      ) : (
        <FileDocIcon className={dense ? 'h-5 w-5' : 'h-12 w-12'} accent={s.accent} />
      )}
      <span className={`font-bold tracking-wide ${dense ? 'text-[8px]' : 'text-xs'} ${s.text}`}>
        {label || s.label}
      </span>
    </span>
  );
}

function TextPeek({ node }: { node: Node }) {
  const [snippet, setSnippet] = useState<string | null>(null);

  useEffect(() => {
    if (!node.id) return;
    let cancelled = false;
    const ctrl = new AbortController();
    void fetch(contentUrl(node.id), {
      credentials: 'include',
      signal: ctrl.signal,
      headers: { Range: 'bytes=0-479' },
    })
      .then(async (res) => {
        if (!res.ok && res.status !== 206) throw new Error('peek failed');
        const raw = await res.text();
        const text = raw.replace(/\s+/g, ' ').trim();
        if (!cancelled) setSnippet(text || 'Empty file');
      })
      .catch(() => {
        if (!cancelled) setSnippet(null);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [node.id]);

  if (!snippet) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-sky-300/90">
        <FileDocIcon className="h-12 w-12" accent="currentColor" />
        <span className="text-[10px] font-semibold tracking-wide">{fileTypeLabel(node)}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-arkive-bg/80 p-1.5">
      <span className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-sky-300/80">
        {fileTypeLabel(node)}
      </span>
      <pre className="min-h-0 flex-1 overflow-hidden whitespace-pre-wrap break-all font-mono text-[9px] leading-snug text-arkive-muted">
        {snippet}
      </pre>
    </div>
  );
}

function FolderThumb({ dense }: { dense: boolean }) {
  return (
    <span
      className={`flex items-center justify-center ${
        dense
          ? 'h-9 w-9 shrink-0 rounded-xl bg-gradient-to-br from-arkive-accent/30 to-arkive-accent2/20 text-violet-200 ring-1 ring-white/10 shadow-[0_0_12px_rgba(139,92,246,0.2)]'
          : 'h-full w-full bg-gradient-to-br from-arkive-accent/16 via-transparent to-arkive-accent2/12 text-violet-200'
      }`}
    >
      <FolderIcon className={dense ? 'h-6 w-6' : 'h-16 w-16 drop-shadow-sm'} />
    </span>
  );
}

type Props = {
  node: Node;
  size?: 'sm' | 'lg';
  /** When false, never fetch /content (Recent without reliable content). */
  allowContent?: boolean;
};

export function FileThumb({ node, size = 'sm', allowContent = true }: Props) {
  const dense = size === 'sm';
  const box = dense
    ? 'h-9 w-9 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10'
    : 'h-full w-full';

  if (node.kind === 'folder') {
    return <FolderThumb dense={dense} />;
  }

  const office = officeKind(node.name, node.mime);
  if (office) {
    return (
      <OfficeBadge
        kind={office}
        dense={dense}
        label={office === 'archive' ? nameExtLabel(node.name) : undefined}
      />
    );
  }

  if (allowContent && node.id && isImageNode(node)) {
    return (
      <span className={`block bg-white/[0.04] ${box}`}>
        <img
          src={thumbUrl(node.id)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={(e) => {
            const el = e.currentTarget;
            if (el.dataset.fallback) return;
            el.dataset.fallback = '1';
            el.src = contentUrl(node.id);
          }}
        />
      </span>
    );
  }

  if (allowContent && node.id && isVideoNode(node)) {
    return (
      <span className={`relative block bg-white/[0.05] ${box}`}>
        <video
          src={contentUrl(node.id)}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
          <span className="rounded-full bg-black/50 p-1 text-white">
            <VideoIcon className={dense ? 'h-4 w-4' : 'h-8 w-8'} />
          </span>
        </span>
      </span>
    );
  }

  if (isPdfNode(node)) {
    return (
      <span
        className={`flex flex-col items-center justify-center gap-0.5 bg-red-500/10 text-red-300 ${box}`}
      >
        <FileDocIcon className={dense ? 'h-6 w-6' : 'h-12 w-12'} accent="currentColor" />
        <span className={`font-bold tracking-wide ${dense ? 'text-[8px]' : 'text-xs'}`}>PDF</span>
      </span>
    );
  }

  if (isAudioNode(node)) {
    return (
      <span className={`flex items-center justify-center bg-violet-500/10 text-violet-300 ${box}`}>
        <AudioIcon className={dense ? 'h-5 w-5' : 'h-12 w-12'} />
      </span>
    );
  }

  if (allowContent && node.id && isTextNode(node) && !dense) {
    return (
      <span className={`block overflow-hidden ${box}`}>
        <TextPeek node={node} />
      </span>
    );
  }

  if (isTextNode(node) || isImageNode(node) || isVideoNode(node)) {
    return (
      <span className={`flex items-center justify-center bg-sky-500/10 text-sky-300 ${box}`}>
        <FileDocIcon className={dense ? 'h-5 w-5' : 'h-12 w-12'} accent="currentColor" />
      </span>
    );
  }

  return (
    <span
      className={`flex flex-col items-center justify-center gap-0.5 bg-white/[0.05] text-arkive-muted ${box}`}
    >
      <FileDocIcon className={dense ? 'h-5 w-5' : 'h-12 w-12'} accent="currentColor" />
      <span className={`font-semibold tracking-wide ${dense ? 'text-[8px]' : 'text-xs'}`}>
        {fileTypeLabel(node)}
      </span>
    </span>
  );
}

/** Live Drive items — icons only, never Arkive content URLs. */
export function LiveDriveThumb({
  item,
  size = 'sm',
}: {
  item: LiveDriveItem;
  size?: 'sm' | 'lg';
}) {
  const dense = size === 'sm';
  const box = dense
    ? 'h-9 w-9 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10'
    : 'h-full w-full';

  if (item.kind === 'folder') return <FolderThumb dense={dense} />;

  const office = officeKind(item.name, item.mime);
  if (office) {
    return (
      <OfficeBadge
        kind={office}
        dense={dense}
        label={office === 'archive' ? nameExtLabel(item.name) : undefined}
      />
    );
  }

  if (isPdfName(item.name, item.mime)) {
    return (
      <span
        className={`flex flex-col items-center justify-center gap-0.5 bg-red-500/10 text-red-300 ${box}`}
      >
        <FileDocIcon className={dense ? 'h-6 w-6' : 'h-12 w-12'} accent="currentColor" />
        <span className={`font-bold tracking-wide ${dense ? 'text-[8px]' : 'text-xs'}`}>PDF</span>
      </span>
    );
  }

  if (isImageName(item.name, item.mime)) {
    return (
      <span
        className={`flex items-center justify-center bg-arkive-accent2/10 text-arkive-accent2 ${box}`}
      >
        <FileDocIcon className={dense ? 'h-5 w-5' : 'h-12 w-12'} accent="currentColor" />
      </span>
    );
  }

  if (isVideoName(item.name, item.mime)) {
    return (
      <span className={`flex items-center justify-center bg-white/[0.06] text-arkive-muted ${box}`}>
        <VideoIcon className={dense ? 'h-5 w-5' : 'h-12 w-12'} />
      </span>
    );
  }

  if (isAudioName(item.name, item.mime)) {
    return (
      <span className={`flex items-center justify-center bg-violet-500/10 text-violet-300 ${box}`}>
        <AudioIcon className={dense ? 'h-5 w-5' : 'h-12 w-12'} />
      </span>
    );
  }

  return (
    <span
      className={`flex flex-col items-center justify-center gap-0.5 bg-white/[0.05] text-arkive-muted ${box}`}
    >
      <FileDocIcon className={dense ? 'h-5 w-5' : 'h-12 w-12'} accent="currentColor" />
      <span className={`font-semibold tracking-wide ${dense ? 'text-[8px]' : 'text-xs'}`}>
        {nameExtLabel(item.name)}
      </span>
    </span>
  );
}
