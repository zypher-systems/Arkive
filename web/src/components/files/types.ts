import type { Node } from '../../lib/api';

export type FileViewMode = 'list' | 'details' | 'tiles';

export type ContextMenuState =
  | { kind: 'node'; node: Node; x: number; y: number }
  | { kind: 'pane'; x: number; y: number }
  | null;

export type FileKindHint = 'file' | 'folder';

const IMAGE_EXT =
  /\.(png|jpe?g|gif|webp|bmp|avif|ico|jfif)$/i;
const VIDEO_EXT = /\.(mp4|webm|ogg|ogv|mov|m4v|mkv)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|flac|aac|opus)$/i;
const PDF_EXT = /\.pdf$/i;
const WORD_EXT = /\.(docx?|dotx?|odt|rtf)$/i;
const EXCEL_EXT = /\.(xlsx?|xlsm|ods)$/i;
const POWERPOINT_EXT = /\.(pptx?|odp)$/i;
const ARCHIVE_EXT = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/i;
const TEXT_EXT =
  /\.(txt|md|markdown|json|ya?ml|toml|csv|tsv|log|go|tsx?|jsx?|mjs|cjs|py|rs|css|scss|less|html?|xml|sh|bash|zsh|fish|ini|conf|cfg|env|sql|rb|java|kt|c|cc|cpp|h|hpp|php|vue|svelte|dockerfile|makefile|gitignore|editorconfig|lock|properties|gradle|swift|dart|lua|r|pl|ps1|bat|cmd)$/i;

export type OfficeKind = 'word' | 'excel' | 'powerpoint' | 'archive';

export function nameExtLabel(name: string) {
  if (name.includes('.')) {
    const ext = name.split('.').pop();
    if (ext && ext.length <= 8) return ext.toUpperCase();
  }
  return 'FILE';
}

export function isImageName(name: string, mime?: string | null) {
  const m = (mime || '').toLowerCase();
  return m.startsWith('image/') || IMAGE_EXT.test(name);
}

export function isVideoName(name: string, mime?: string | null) {
  const m = (mime || '').toLowerCase();
  return m.startsWith('video/') || VIDEO_EXT.test(name);
}

export function isAudioName(name: string, mime?: string | null) {
  const m = (mime || '').toLowerCase();
  return m.startsWith('audio/') || AUDIO_EXT.test(name);
}

export function isPdfName(name: string, mime?: string | null) {
  const m = (mime || '').toLowerCase();
  return m === 'application/pdf' || PDF_EXT.test(name);
}

export function isTextName(name: string, mime?: string | null) {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('text/')) return true;
  if (
    m === 'application/json' ||
    m === 'application/xml' ||
    m === 'application/javascript' ||
    m === 'application/typescript' ||
    m === 'application/x-sh' ||
    m === 'application/x-yaml'
  ) {
    return true;
  }
  if (m.startsWith('image/')) return false;
  return TEXT_EXT.test(name) && !IMAGE_EXT.test(name);
}

export function officeKind(name: string, mime?: string | null): OfficeKind | null {
  const m = (mime || '').toLowerCase();
  const n = name.toLowerCase();
  if (
    WORD_EXT.test(n) ||
    m.includes('wordprocessingml') ||
    m === 'application/msword' ||
    m === 'application/rtf'
  ) {
    return 'word';
  }
  if (
    EXCEL_EXT.test(n) ||
    m.includes('spreadsheetml') ||
    m === 'application/vnd.ms-excel'
  ) {
    return 'excel';
  }
  if (
    POWERPOINT_EXT.test(n) ||
    m.includes('presentationml') ||
    m === 'application/vnd.ms-powerpoint'
  ) {
    return 'powerpoint';
  }
  if (
    ARCHIVE_EXT.test(n) ||
    m === 'application/zip' ||
    m === 'application/x-7z-compressed' ||
    m === 'application/x-rar-compressed' ||
    m === 'application/gzip' ||
    m === 'application/x-tar'
  ) {
    return 'archive';
  }
  return null;
}

export function isImageNode(node: Node) {
  return isImageName(node.name, node.mime);
}

export function isVideoNode(node: Node) {
  return isVideoName(node.name, node.mime);
}

export function isAudioNode(node: Node) {
  return isAudioName(node.name, node.mime);
}

export function isPdfNode(node: Node) {
  return isPdfName(node.name, node.mime);
}

export function isTextNode(node: Node) {
  return isTextName(node.name, node.mime);
}

export function fileTypeLabel(node: Node) {
  if (node.kind === 'folder') return 'Folder';
  return nameExtLabel(node.name);
}

/** Synthetic node for thumbs that only have a name (Recent). */
export function hintNode(
  name: string,
  kind: FileKindHint,
  opts?: { id?: string; mime?: string | null },
): Node {
  return {
    id: opts?.id || '',
    workspace_id: '',
    name,
    kind,
    size: 0,
    mime: opts?.mime ?? null,
    created_at: '',
    updated_at: '',
  };
}
