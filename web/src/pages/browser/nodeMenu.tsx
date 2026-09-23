import type { Node } from '../../lib/api';
import { downloadUrl } from '../../lib/api';
import type { MenuItem } from '../../components/ui/Menu';
import {
  ArchiveIcon,
  CopyIcon,
  DownloadIcon,
  FolderCopyIcon,
  FolderMoveIcon,
  HistoryIcon,
  InfoIcon,
  OpenIcon,
  PencilIcon,
  ShareIcon,
  TrashIcon,
} from '../../components/icons';
import { isEditableText } from '../../components/files/types';
import type { TFunction } from '../../i18n';
import { isMac } from '../../lib/hooks';

export type NodeMenuHandlers = {
  open: (n: Node) => void;
  edit?: (n: Node) => void;
  details: (n: Node, tab?: 'info' | 'sharing' | 'versions') => void;
  share?: (n: Node) => void;
  rename?: (n: Node) => void;
  moveTo?: (ns: Node[]) => void;
  copyTo?: (ns: Node[]) => void;
  copy?: (ns: Node[]) => void;
  download: (ns: Node[]) => void;
  trash?: (ns: Node[]) => void;
};

const mod = isMac ? '⌘' : 'Ctrl+';

/** Context / ⋯ menu for one node, or for the whole selection when several are selected. */
export function nodeMenuItems(node: Node, selection: Node[], h: NodeMenuHandlers, t: TFunction): MenuItem[] {
  const multi = selection.length > 1 && selection.some((n) => n.id === node.id);
  if (multi) {
    return [
      { kind: 'label', id: 'count', label: t('selection.count', { count: selection.length }) },
      { id: 'zip', label: t('files.downloadZip'), icon: <ArchiveIcon size={15} />, onSelect: () => h.download(selection) },
      ...(h.moveTo ? [{ id: 'move', label: t('files.moveTo'), icon: <FolderMoveIcon size={15} />, onSelect: () => h.moveTo!(selection) }] : []),
      ...(h.copyTo ? [{ id: 'copyto', label: t('files.copyTo'), icon: <FolderCopyIcon size={15} />, onSelect: () => h.copyTo!(selection) }] : []),
      ...(h.copy ? [{ id: 'copy', label: t('files.copy'), icon: <CopyIcon size={15} />, shortcut: `${mod}C`, onSelect: () => h.copy!(selection) }] : []),
      ...(h.trash
        ? ([
            { kind: 'separator', id: 's2' },
            { id: 'trash', label: t('files.moveToTrash'), icon: <TrashIcon size={15} />, danger: true, shortcut: 'Del', onSelect: () => h.trash!(selection) },
          ] as MenuItem[])
        : []),
    ];
  }
  const isFile = node.kind === 'file';
  const items: MenuItem[] = [
    { id: 'open', label: t('common.open'), icon: <OpenIcon size={15} />, shortcut: '↵', onSelect: () => h.open(node) },
  ];
  if (isFile && h.edit && isEditableText(node)) {
    items.push({ id: 'edit', label: t('files.edit'), icon: <PencilIcon size={15} />, onSelect: () => h.edit!(node) });
  }
  items.push(
    isFile
      ? { id: 'dl', label: t('common.download'), icon: <DownloadIcon size={15} />, href: downloadUrl(node.id) }
      : { id: 'zip', label: t('files.downloadZip'), icon: <ArchiveIcon size={15} />, onSelect: () => h.download([node]) },
  );
  if (h.share) items.push({ id: 'share', label: t('files.share'), icon: <ShareIcon size={15} />, onSelect: () => h.share!(node) });
  items.push({ id: 'info', label: t('files.details'), icon: <InfoIcon size={15} />, shortcut: 'i', onSelect: () => h.details(node, 'info') });
  if (isFile) items.push({ id: 'versions', label: t('files.versions'), icon: <HistoryIcon size={15} />, onSelect: () => h.details(node, 'versions') });

  const edits: MenuItem[] = [];
  if (h.rename) edits.push({ id: 'rename', label: t('files.rename'), icon: <PencilIcon size={15} />, shortcut: 'F2', onSelect: () => h.rename!(node) });
  if (h.moveTo) edits.push({ id: 'move', label: t('files.moveTo'), icon: <FolderMoveIcon size={15} />, onSelect: () => h.moveTo!([node]) });
  if (h.copyTo) edits.push({ id: 'copyto', label: t('files.copyTo'), icon: <FolderCopyIcon size={15} />, onSelect: () => h.copyTo!([node]) });
  if (h.copy) edits.push({ id: 'copy', label: t('files.copy'), icon: <CopyIcon size={15} />, shortcut: `${mod}C`, onSelect: () => h.copy!([node]) });
  if (edits.length) items.push({ kind: 'separator', id: 's1' }, ...edits);
  if (h.trash) {
    items.push(
      { kind: 'separator', id: 's2' },
      { id: 'trash', label: t('files.moveToTrash'), icon: <TrashIcon size={15} />, danger: true, shortcut: 'Del', onSelect: () => h.trash!([node]) },
    );
  }
  return items;
}
