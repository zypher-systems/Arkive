import { useEffect, useRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  Clipboard,
  ExternalLink,
  Copy,
  Download,
  Eye,
  FilePlus2,
  FolderInput,
  FolderPlus,
  FolderSymlink,
  History,
  Pencil,
  Share2,
  Trash2,
  Upload,
} from 'lucide-react';
import { downloadUrl, isPreviewable, type Node } from '../../lib/api';
import { isTextNode, type ContextMenuState } from './types';

type Props = {
  menu: ContextMenuState;
  onClose: () => void;
  onOpen: (node: Node) => void;
  onPreview: (node: Node) => void;
  onEdit?: (node: Node) => void;
  onNewFile?: () => void;
  onShare: (node: Node) => void;
  onHistory: (node: Node) => void;
  onRename: (node: Node) => void;
  onMove: (node: Node) => void;
  onCopy: (node: Node) => void;
  onCopyTo: (node: Node) => void;
  onTrash: (node: Node) => void;
  onNewFolder: () => void;
  onUpload: () => void;
  canPaste?: boolean;
  onPaste?: () => void;
  canWrite?: boolean;
};

function Item({
  label,
  icon,
  onClick,
  danger,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
        danger
          ? 'text-red-300/90 hover:bg-red-500/12 hover:text-red-200'
          : 'text-arkive-text/90 hover:bg-white/[0.07] hover:text-white'
      }`}
      onClick={onClick}
    >
      <span className={`shrink-0 ${danger ? '' : 'text-arkive-muted'}`}>{icon}</span>
      {label}
    </button>
  );
}

function Divider() {
  return <div className="my-1.5 border-t border-white/6" />;
}

export function ContextMenu({
  menu,
  onClose,
  onOpen,
  onPreview,
  onEdit,
  onNewFile,
  onShare,
  onHistory,
  onRename,
  onMove,
  onCopy,
  onCopyTo,
  onTrash,
  onNewFolder,
  onUpload,
  canPaste,
  onPaste,
  canWrite = true,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) onClose();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const style = {
    left: Math.min(menu.x, window.innerWidth - 220),
    top: Math.min(menu.y, window.innerHeight - 320),
  };

  return (
    <motion.div
      ref={ref}
      style={style}
      initial={{ opacity: 0, scale: 0.94, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 480, damping: 30 }}
      className="glass-strong glass-hairline fixed z-[80] min-w-52 origin-top-left overflow-hidden rounded-2xl p-1.5 shadow-[0_20px_60px_rgba(3,4,12,0.7)]"
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.kind === 'pane' ? (
        <>
          {canWrite && (
            <>
              <Item
                label="New folder"
                icon={<FolderPlus size={15} />}
                onClick={() => {
                  onNewFolder();
                  onClose();
                }}
              />
              {onNewFile && (
                <Item
                  label="New file"
                  icon={<FilePlus2 size={15} />}
                  onClick={() => {
                    onNewFile();
                    onClose();
                  }}
                />
              )}
            </>
          )}
          {canWrite && (
            <Item
              label="Upload"
              icon={<Upload size={15} />}
              onClick={() => {
                onUpload();
                onClose();
              }}
            />
          )}
          {canWrite && canPaste && onPaste && (
            <Item
              label="Paste"
              icon={<Clipboard size={15} />}
              onClick={() => {
                onPaste();
                onClose();
              }}
            />
          )}
        </>
      ) : (
        <>
          <Item
            label="Open"
            icon={<ExternalLink size={15} />}
            onClick={() => {
              onOpen(menu.node);
              onClose();
            }}
          />
          {isPreviewable(menu.node) && (
            <Item
              label="Preview"
              icon={<Eye size={15} />}
              onClick={() => {
                onPreview(menu.node);
                onClose();
              }}
            />
          )}
          {canWrite && onEdit && isTextNode(menu.node) && (
            <Item
              label="Edit"
              icon={<Pencil size={15} />}
              onClick={() => {
                onEdit(menu.node);
                onClose();
              }}
            />
          )}
          {menu.node.kind === 'file' && (
            <a
              href={downloadUrl(menu.node.id)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-arkive-text/90 transition-colors hover:bg-white/[0.07] hover:text-white"
              onClick={onClose}
            >
              <span className="shrink-0 text-arkive-muted">
                <Download size={15} />
              </span>
              Download
            </a>
          )}
          <Item
            label="Share"
            icon={<Share2 size={15} />}
            onClick={() => {
              onShare(menu.node);
              onClose();
            }}
          />
          {menu.node.kind === 'file' && (
            <Item
              label="History"
              icon={<History size={15} />}
              onClick={() => {
                onHistory(menu.node);
                onClose();
              }}
            />
          )}
          {canWrite && (
            <>
              <Divider />
              <Item
                label="Rename"
                icon={<Pencil size={15} />}
                onClick={() => {
                  onRename(menu.node);
                  onClose();
                }}
              />
              <Item
                label="Move"
                icon={<FolderInput size={15} />}
                onClick={() => {
                  onMove(menu.node);
                  onClose();
                }}
              />
            </>
          )}
          <Item
            label="Copy"
            icon={<Copy size={15} />}
            onClick={() => {
              onCopy(menu.node);
              onClose();
            }}
          />
          {canWrite && (
            <Item
              label="Copy to…"
              icon={<FolderSymlink size={15} />}
              onClick={() => {
                onCopyTo(menu.node);
                onClose();
              }}
            />
          )}
          {canWrite && (
            <>
              <Divider />
              <Item
                label="Move to trash"
                icon={<Trash2 size={15} />}
                danger
                onClick={() => {
                  onTrash(menu.node);
                  onClose();
                }}
              />
            </>
          )}
        </>
      )}
    </motion.div>
  );
}
