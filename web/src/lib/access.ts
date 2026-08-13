export type WorkspaceRole = string | undefined | null;

export function canWriteFiles(opts: {
  viewKind?: string;
  sharePermission?: string;
  workspaceRole?: WorkspaceRole;
}): boolean {
  if (opts.viewKind === 'shared-folder') {
    return opts.sharePermission === 'write';
  }
  const role = opts.workspaceRole;
  return !role || role === 'owner' || role === 'admin' || role === 'member';
}

export function rangeSelect(orderedIds: string[], fromId: string, toId: string): string[] {
  const a = orderedIds.indexOf(fromId);
  const b = orderedIds.indexOf(toId);
  if (a < 0 || b < 0) return [toId];
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  return orderedIds.slice(start, end + 1);
}
