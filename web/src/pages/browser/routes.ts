import type { Node } from '../../lib/api';

export function folderHref(workspaceId: string, folderId?: string | null) {
  return folderId ? `/w/${workspaceId}/f/${folderId}` : `/w/${workspaceId}`;
}

/** Where to go to "show" a node: folders open, files open their folder with the file focused. */
export function nodeHref(n: Pick<Node, 'id' | 'kind' | 'workspace_id' | 'parent_id'>) {
  if (n.kind === 'folder') return folderHref(n.workspace_id, n.id);
  return `${folderHref(n.workspace_id, n.parent_id)}?focus=${encodeURIComponent(n.id)}`;
}

export function sharedHref(workspaceId: string, rootId: string, folderId?: string | null) {
  const base = `/shared/${workspaceId}/${rootId}`;
  return folderId && folderId !== rootId ? `${base}/f/${folderId}` : base;
}
