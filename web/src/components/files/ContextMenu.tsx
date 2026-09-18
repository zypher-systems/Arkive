import { useEffect, useRef, type ReactNode } from 'react';
import {
  CopyIcon,
  DownloadIcon,
  FilePlusIcon,
  FolderCopyIcon,
  FolderMoveIcon,
  FolderPlusIcon,
  HistoryIcon,
  OpenIcon,
  PasteIcon,
  PencilIcon,
  PreviewIcon,
  ShareIcon,
  TrashIcon,
  UploadIcon,
} from '../icons';
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
      className={`flex w-full cursor-pointer items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-[13px] transition-colors ${
        danger
          ? 'text-danger hover:bg-danger-soft'
          : 'text-ink hover:bg-hover'
      }`}
      onClick={onClick}
    >
      <span className={`shrink-0 ${danger ? '' : 'text-muted'}`}>{icon}</span>
      {label}
    </button>
  );
}

function Divider() {
  return <div className="my-1 border-t border-line" />;
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
    <div
      ref={ref}
      style={style}
      className="animate-fade-in fixed z-[80] min-w-52 origin-top-left rounded-md border border-line bg-surface p-1 shadow-md"
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.kind === 'pane' ? (
        <>
          {canWrite && (
            <>
              <Item
                label="New folder"
                icon={<FolderPlusIcon size={14} />}
                onClick={() => {
                  onNewFolder();
                  onClose();
                }}
              />
              {onNewFile && (
                <Item
                  label="New file"
                  icon={<FilePlusIcon size={14} />}
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
              icon={<UploadIcon size={14} />}
              onClick={() => {
                onUpload();
                onClose();
              }}
            />
          )}
          {canWrite && canPaste && onPaste && (
            <Item
              label="Paste"
              icon={<PasteIcon size={14} />}
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
            icon={<OpenIcon size={14} />}
            onClick={() => {
              onOpen(menu.node);
              onClose();
            }}
          />
          {isPreviewable(menu.node) && (
            <Item
              label="Preview"
              icon={<PreviewIcon size={14} />}
              onClick={() => {
                onPreview(menu.node);
                onClose();
              }}
            />
          )}
          {canWrite && onEdit && isTextNode(menu.node) && (
            <Item
              label="Edit"
              icon={<PencilIcon size={14} />}
              onClick={() => {
                onEdit(menu.node);
                onClose();
              }}
            />
          )}
          {menu.node.kind === 'file' && (
            <a
              href={downloadUrl(menu.node.id)}
              className="flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-[13px] text-ink transition-colors hover:bg-hover"
              onClick={onClose}
            >
              <span className="shrink-0 text-muted">
                <DownloadIcon size={14} />
              </span>
              Download
            </a>
          )}
          <Item
            label="Share"
            icon={<ShareIcon size={14} />}
            onClick={() => {
              onShare(menu.node);
              onClose();
            }}
          />
          {menu.node.kind === 'file' && (
            <Item
              label="History"
              icon={<HistoryIcon size={14} />}
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
                icon={<PencilIcon size={14} />}
                onClick={() => {
                  onRename(menu.node);
                  onClose();
                }}
              />
              <Item
                label="Move"
                icon={<FolderMoveIcon size={14} />}
                onClick={() => {
                  onMove(menu.node);
                  onClose();
                }}
              />
            </>
          )}
          <Item
            label="Copy"
            icon={<CopyIcon size={14} />}
            onClick={() => {
              onCopy(menu.node);
              onClose();
            }}
          />
          {canWrite && (
            <Item
              label="Copy to…"
              icon={<FolderCopyIcon size={14} />}
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
                icon={<TrashIcon size={14} />}
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
    </div>
  );
}
