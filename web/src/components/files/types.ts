import type { Node } from '../../lib/api';

export type FileViewMode = 'list' | 'details' | 'tiles' | 'gallery';

export type FileCategory =
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'archive'
  | 'code'
  | 'text'
  | 'other';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|ico|jfif|heic|heif)$/i;
const VIDEO_EXT = /\.(mp4|webm|ogv|mov|m4v|mkv)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|flac|aac|opus)$/i;
const PDF_EXT = /\.pdf$/i;
const WORD_EXT = /\.(docx?|dotx?|odt|rtf|pages)$/i;
const EXCEL_EXT = /\.(xlsx?|xlsm|ods|numbers)$/i;
const POWERPOINT_EXT = /\.(pptx?|odp|key)$/i;
const ARCHIVE_EXT = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|zst)$/i;
const CODE_EXT =
  /\.(go|tsx?|jsx?|mjs|cjs|py|rs|css|scss|less|html?|xml|sh|bash|zsh|fish|sql|rb|java|kt|c|cc|cpp|h|hpp|php|vue|svelte|swift|dart|lua|r|pl|ps1|bat|cmd|ya?ml|toml|json|ini|conf|cfg|env|dockerfile|makefile|gradle|properties|lock)$/i;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|log|rst|adoc|org|tex)$/i;

/** Extensions the in-app text editor opens (GET/PUT /content). */
const EDITABLE_EXT =
  /\.(txt|md|markdown|json|csv|tsv|log|ya?ml|toml|ini|conf|cfg|env|xml|go|tsx?|jsx?|mjs|cjs|py|rs|css|scss|less|sh|bash|zsh|sql|rb|java|kt|c|cc|cpp|h|hpp|php|vue|svelte|swift|dart|lua|r|pl|ps1|rst|adoc|org|tex|gitignore|editorconfig|properties|gradle|dockerfile|makefile)$/i;

export function nameExtLabel(name: string) {
  const i = name.lastIndexOf('.');
  if (i > 0) {
    const ext = name.slice(i + 1);
    if (ext && ext.length <= 6) return ext.toUpperCase();
  }
  return 'FILE';
}

export function isImageName(name: string, mime?: string | null) {
  const m = (mime || '').toLowerCase();
  if (m.includes('svg')) return false;
  return m.startsWith('image/') || IMAGE_EXT.test(name);
}
export function isVideoName(name: string, mime?: string | null) {
  return (mime || '').toLowerCase().startsWith('video/') || VIDEO_EXT.test(name);
}
export function isAudioName(name: string, mime?: string | null) {
  return (mime || '').toLowerCase().startsWith('audio/') || AUDIO_EXT.test(name);
}
export function isPdfName(name: string, mime?: string | null) {
  return (mime || '').toLowerCase() === 'application/pdf' || PDF_EXT.test(name);
}

export function fileCategory(name: string, mime?: string | null): FileCategory {
  const m = (mime || '').toLowerCase();
  if (isImageName(name, m)) return 'image';
  if (isVideoName(name, m)) return 'video';
  if (isAudioName(name, m)) return 'audio';
  if (isPdfName(name, m)) return 'pdf';
  if (WORD_EXT.test(name) || m.includes('wordprocessingml') || m === 'application/msword') return 'doc';
  if (EXCEL_EXT.test(name) || m.includes('spreadsheetml') || m === 'application/vnd.ms-excel') return 'sheet';
  if (/\.(csv|tsv)$/i.test(name)) return 'sheet';
  if (POWERPOINT_EXT.test(name) || m.includes('presentationml')) return 'slides';
  if (ARCHIVE_EXT.test(name) || /zip|x-7z|x-rar|gzip|x-tar/.test(m)) return 'archive';
  if (/\.(md|markdown|txt|log|rst)$/i.test(name) || m === 'text/plain' || m === 'text/markdown') return 'text';
  if (CODE_EXT.test(name)) return 'code';
  if (TEXT_EXT.test(name) || m.startsWith('text/')) return 'text';
  return 'other';
}

export function isImageNode(node: Pick<Node, 'name' | 'mime' | 'kind'>) {
  return node.kind === 'file' && isImageName(node.name, node.mime);
}
export function isVideoNode(node: Pick<Node, 'name' | 'mime'>) {
  return isVideoName(node.name, node.mime);
}
export function isAudioNode(node: Pick<Node, 'name' | 'mime'>) {
  return isAudioName(node.name, node.mime);
}
export function isPdfNode(node: Pick<Node, 'name' | 'mime'>) {
  return isPdfName(node.name, node.mime);
}

/** Files the text editor can open (by extension or text/* mime, never HTML/SVG). */
export function isEditableText(node: Pick<Node, 'name' | 'mime' | 'kind'>) {
  if (node.kind !== 'file') return false;
  const m = (node.mime || '').toLowerCase();
  if (/\.(html?|svgz?)$/i.test(node.name) || m.includes('html') || m.includes('svg')) return false;
  if (EDITABLE_EXT.test(node.name)) return true;
  if (/^(readme|license|changelog|makefile|dockerfile)$/i.test(node.name)) return true;
  return (
    m.startsWith('text/') ||
    m === 'application/json' ||
    m === 'application/xml' ||
    m === 'application/x-yaml' ||
    m === 'application/javascript' ||
    m === 'application/x-sh'
  );
}

export function isMarkdownName(name: string) {
  return /\.(md|markdown)$/i.test(name);
}

/** Opens in the media viewer (image / video / audio / pdf). */
export function isMediaNode(node: Pick<Node, 'name' | 'mime' | 'kind'>) {
  if (node.kind !== 'file') return false;
  const c = fileCategory(node.name, node.mime);
  return c === 'image' || c === 'video' || c === 'audio' || c === 'pdf';
}

/** Synthetic node for places that only know a name (Recent). */
export function hintNode(name: string, kind: 'file' | 'folder', opts?: { id?: string; mime?: string | null }): Node {
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
