import type { Workspace } from '../../lib/api';

export type NavView =
  | { kind: 'workspace'; id: string }
  | { kind: 'shared' }
  | {
      kind: 'shared-folder';
      workspaceId: string;
      rootId: string;
      parentId: string | null;
      permission: 'read' | 'write';
    }
  | { kind: 'recent' }
  | { kind: 'live-drive'; parent: string };

export function workspaceLabel(w: Workspace) {
  if (w.type === 'personal') return 'My files';
  if (w.type === 'mount') return w.name || 'Google Drive';
  return w.name;
}
