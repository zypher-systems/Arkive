import { useEffect, useRef } from 'react';
import { downloadUrl, isPreviewable, type Node } from '../../lib/api';
import { isTextNode, type ContextMenuState } from './types';

type Props = {
  menu: ContextMenuState;
  onClose: () => void;
  onOpen: (node: Node) => void;
  onPreview: (node: Node) => void;
  onEdit?: (node: Node) => void;
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
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-arkive-panel ${
        danger ? 'text-red-300' : 'text-arkive-text'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function ContextMenu({
  menu,
  onClose,
  onOpen,
  onPreview,
  onEdit,
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
    left: Math.min(menu.x, window.innerWidth - 200),
    top: Math.min(menu.y, window.innerHeight - 280),
  };

  return (
    <div
      ref={ref}
      style={style}
      className="fixed z-[80] min-w-44 overflow-hidden rounded-xl border border-arkive-border bg-arkive-surface py-1 shadow-2xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.kind === 'pane' ? (
        <>
          <Item
            label="New folder"
            onClick={() => {
              onNewFolder();
              onClose();
            }}
          />
          <Item
            label="Upload"
            onClick={() => {
              onUpload();
              onClose();
            }}
          />
          {canPaste && onPaste && (
            <Item
              label="Paste"
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
            onClick={() => {
              onOpen(menu.node);
              onClose();
            }}
          />
          {isPreviewable(menu.node) && (
            <Item
              label="Preview"
              onClick={() => {
                onPreview(menu.node);
                onClose();
              }}
            />
          )}
          {canWrite && onEdit && isTextNode(menu.node) && (
            <Item
              label="Edit"
              onClick={() => {
                onEdit(menu.node);
                onClose();
              }}
            />
          )}
          {menu.node.kind === 'file' && (
            <a
              href={downloadUrl(menu.node.id)}
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-arkive-panel"
              onClick={onClose}
            >
              Download
            </a>
          )}
          <Item
            label="Share"
            onClick={() => {
              onShare(menu.node);
              onClose();
            }}
          />
          {menu.node.kind === 'file' && (
            <Item
              label="History"
              onClick={() => {
                onHistory(menu.node);
                onClose();
              }}
            />
          )}
          <div className="my-1 border-t border-arkive-border" />
          <Item
            label="Rename"
            onClick={() => {
              onRename(menu.node);
              onClose();
            }}
          />
          <Item
            label="Move"
            onClick={() => {
              onMove(menu.node);
              onClose();
            }}
          />
          <Item
            label="Copy"
            onClick={() => {
              onCopy(menu.node);
              onClose();
            }}
          />
          <Item
            label="Copy to…"
            onClick={() => {
              onCopyTo(menu.node);
              onClose();
            }}
          />
          <div className="my-1 border-t border-arkive-border" />
          <Item
            label="Move to trash"
            danger
            onClick={() => {
              onTrash(menu.node);
              onClose();
            }}
          />
        </>
      )}
    </div>
  );
}
