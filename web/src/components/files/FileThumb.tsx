import { useState } from 'react';
import { thumbUrl, type LiveDriveItem, type Node } from '../../lib/api';
import { fileCategory, nameExtLabel, type FileCategory } from './types';

/** Muted category tints (light / dark) — keeps the graphite+amber UI calm. */
const TINTS: Record<FileCategory, string> = {
  folder: 'text-folder',
  image: 'bg-[#e3f0ee] text-[#2d6f66] dark:bg-[#18302d] dark:text-[#7cc7bb]',
  video: 'bg-[#ece6f5] text-[#5b4690] dark:bg-[#26203a] dark:text-[#b7a4e6]',
  audio: 'bg-[#f5e4ee] text-[#8a3a67] dark:bg-[#35202c] dark:text-[#e6a3c7]',
  pdf: 'bg-[#f7e2de] text-[#a33a2c] dark:bg-[#3a1f1b] dark:text-[#f0a397]',
  doc: 'bg-[#e1eaf6] text-[#2f5b93] dark:bg-[#1c2a3d] dark:text-[#9fbfe8]',
  sheet: 'bg-[#dfefe4] text-[#2a7045] dark:bg-[#17301f] dark:text-[#8fd3a8]',
  slides: 'bg-[#f7e8d8] text-[#9a5a20] dark:bg-[#382817] dark:text-[#eab37c]',
  archive: 'bg-[#ecebe6] text-[#5f5d55] dark:bg-[#2a2a27] dark:text-[#bdbab0]',
  code: 'bg-[#e6e8f5] text-[#434c8f] dark:bg-[#20233a] dark:text-[#aab2ea]',
  text: 'bg-[#eeeeea] text-[#555b64] dark:bg-[#26282d] dark:text-[#b5bac2]',
  other: 'bg-[#eeeeea] text-[#555b64] dark:bg-[#26282d] dark:text-[#b5bac2]',
};

function FolderShape({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="text-folder">
      <path d="M4 11.5A3.5 3.5 0 0 1 7.5 8h8.2c.9 0 1.8.4 2.4 1.1L20.4 12H32.5A3.5 3.5 0 0 1 36 15.5V16H4v-4.5z" fill="currentColor" opacity=".55" />
      <path d="M4 15h32v14.5a3.5 3.5 0 0 1-3.5 3.5h-25A3.5 3.5 0 0 1 4 29.5V15z" fill="currentColor" />
      <path d="M4 15h32v1.5H4z" fill="#fff" opacity=".18" />
    </svg>
  );
}

function CategoryIcon({ cat, size }: { cat: FileCategory; size: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (cat) {
    case 'image':
      return (
        <svg {...common}>
          <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
          <circle cx="5.8" cy="6.2" r="1.2" />
          <path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3" />
        </svg>
      );
    case 'video':
      return (
        <svg {...common}>
          <rect x="1.8" y="3.5" width="9" height="9" rx="1.5" />
          <path d="M10.8 7l3.4-2v6l-3.4-2" />
        </svg>
      );
    case 'audio':
      return (
        <svg {...common}>
          <path d="M6 12V3.5l7-1.5v8.5" />
          <circle cx="4.5" cy="12" r="1.8" />
          <circle cx="11.5" cy="10.5" r="1.8" />
        </svg>
      );
    case 'archive':
      return (
        <svg {...common}>
          <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
          <path d="M7 2.5v2h2v2H7v2h2" />
        </svg>
      );
    case 'code':
      return (
        <svg {...common}>
          <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />
        </svg>
      );
    case 'sheet':
      return (
        <svg {...common}>
          <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
          <path d="M2.5 6.2h11M2.5 9.8h11M6.5 2.5v11" />
        </svg>
      );
    case 'slides':
      return (
        <svg {...common}>
          <rect x="2" y="3" width="12" height="8" rx="1.2" />
          <path d="M8 11v2.5M5.5 13.5h5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M4 1.8h5L12.2 5v9.2H4z" />
          <path d="M9 1.8V5h3.2M6 8h4M6 10.5h4" />
        </svg>
      );
  }
}

/**
 * Icon tile for a file/folder, based only on its name/mime (no network).
 * `size` is the tile edge in px.
 */
export function FileGlyph({
  name,
  kind = 'file',
  mime,
  size = 32,
  showExt = true,
}: {
  name: string;
  kind?: 'file' | 'folder';
  mime?: string | null;
  size?: number;
  showExt?: boolean;
}) {
  const cat: FileCategory = kind === 'folder' ? 'folder' : fileCategory(name, mime);
  if (cat === 'folder') {
    return (
      <span className="inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
        <FolderShape size={Math.round(size * 0.92)} />
      </span>
    );
  }
  const big = size >= 64;
  const ext = nameExtLabel(name);
  return (
    <span
      className={`inline-flex shrink-0 flex-col items-center justify-center gap-0.5 ${big ? 'rounded-xl' : 'rounded-md'} ${TINTS[cat]}`}
      style={{ width: size, height: size }}
    >
      <CategoryIcon cat={cat} size={Math.round(size * (big ? 0.34 : 0.5))} />
      {big && showExt && ext !== 'FILE' && (
        <span className="max-w-[80%] truncate text-2xs font-semibold tracking-wide opacity-80">{ext}</span>
      )}
    </span>
  );
}

/**
 * Thumbnail for a node: real image thumbnail (GET /api/nodes/{id}/thumb)
 * for images, glyph otherwise. `fill` stretches to the parent (tiles).
 */
export function FileThumb({
  node,
  size = 32,
  fill = false,
  allowRemote = true,
  rounded = true,
}: {
  node: Pick<Node, 'id' | 'name' | 'kind' | 'mime'> & { updated_at?: string };
  size?: number;
  fill?: boolean;
  allowRemote?: boolean;
  rounded?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const cat = node.kind === 'folder' ? 'folder' : fileCategory(node.name, node.mime);
  const canThumb = allowRemote && !!node.id && cat === 'image' && !failed;

  if (fill) {
    return (
      <span className="relative flex h-full w-full items-center justify-center overflow-hidden bg-inset">
        {canThumb ? (
          <img
            src={thumbUrl(node.id, node.updated_at)}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <FileGlyph name={node.name} kind={node.kind} mime={node.mime} size={72} />
        )}
      </span>
    );
  }
  if (canThumb) {
    return (
      <span
        className={`inline-block shrink-0 overflow-hidden bg-inset ring-1 ring-line ring-inset ${rounded ? 'rounded-md' : ''}`}
        style={{ width: size, height: size }}
      >
        <img
          src={thumbUrl(node.id, node.updated_at)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  return <FileGlyph name={node.name} kind={node.kind} mime={node.mime} size={size} />;
}

export function LiveDriveThumb({ item, size = 32 }: { item: LiveDriveItem; size?: number }) {
  return <FileGlyph name={item.name} kind={item.kind} mime={item.mime} size={size} />;
}
