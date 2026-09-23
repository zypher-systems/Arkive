import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type Node } from '../../lib/api';
import { sortNodes } from '../../lib/sort';
import { useConfirm } from '../../lib/confirm';
import { useWorkspaces } from '../../lib/workspaces';
import { useI18n } from '../../i18n';
import { useToast } from '../../components/Toast';
import { FileList, RowAction } from '../../components/files/FileList';
import { ListSkeleton } from '../../components/files/EmptyFolder';
import { SelectionBar } from '../../components/files/SelectionBar';
import { MenuList, type MenuItem } from '../../components/ui/Menu';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { Select } from '../../components/ui/Input';
import { Notice } from '../../components/ui/Notice';
import { RestoreIcon, TrashIcon } from '../../components/icons';
import { canWriteFiles } from '../../lib/access';
import { useSelection } from './useSelection';
import { useListHotkeys } from './useListHotkeys';

export function TrashPage() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { workspaceId: paramWs } = useParams();
  const { personal, teams, refreshUsage } = useWorkspaces();
  const roots = [...(personal ? [personal] : []), ...teams];
  const ws = roots.find((w) => w.id === paramWs) || personal;
  const [items, setItems] = useState<Node[] | null>(null);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<{ items: MenuItem[]; point?: { x: number; y: number }; anchor?: HTMLElement } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { ask, dialog } = useConfirm();
  const canWrite = !!ws && canWriteFiles({ workspaceRole: ws.role });

  const load = useCallback(async () => {
    if (!ws) return;
    try {
      setItems(await api.trash(ws.id));
      setError('');
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [ws]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  const sorted = useMemo(
    () => sortNodes(items || [], { key: 'modified', dir: 'desc' }, locale),
    [items, locale],
  );
  const sel = useSelection(sorted.map((n) => n.id));
  const selectedNodes = sorted.filter((n) => sel.selected.has(n.id));

  async function restore(nodes: Node[]) {
    try {
      for (const n of nodes) await api.restore(n.id);
      toast({ message: t('files.restored', { count: nodes.length }) });
      sel.clear();
      await load();
      void refreshUsage();
    } catch (e) {
      toast({ tone: 'error', message: e instanceof Error ? e.message : t('files.restoreFailed') });
    }
  }

  function purge(nodes: Node[]) {
    ask({
      title: t('trash.purgeTitle', { count: nodes.length }),
      message: t('trash.purgeMessage', { count: nodes.length, name: nodes[0]?.name ?? '' }),
      confirmLabel: t('trash.deleteForever'),
      run: async () => {
        try {
          for (const n of nodes) await api.purge(n.id);
          sel.clear();
          await load();
          void refreshUsage();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          throw e;
        }
      },
    });
  }

  function emptyTrash() {
    if (!ws) return;
    ask({
      title: t('trash.emptyTitle'),
      message: t('trash.emptyMessage', { count: sorted.length }),
      confirmLabel: t('trash.empty'),
      run: async () => {
        try {
          await api.emptyTrash(ws.id);
          await load();
          void refreshUsage();
          toast({ message: t('trash.emptied') });
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          throw e;
        }
      },
    });
  }

  const menuFor = (n: Node, at: { x: number; y: number } | HTMLElement) => {
    const target = sel.selected.has(n.id) ? selectedNodes : [n];
    const items: MenuItem[] = canWrite
      ? [
          { id: 'restore', label: t('trash.restore'), icon: <RestoreIcon size={15} />, onSelect: () => void restore(target) },
          { kind: 'separator', id: 's' },
          { id: 'purge', label: t('trash.deleteForever'), icon: <TrashIcon size={15} />, danger: true, onSelect: () => purge(target) },
        ]
      : [{ kind: 'label', id: 'ro', label: t('files.readOnly') }];
    setMenu(at instanceof HTMLElement ? { items, anchor: at } : { items, point: at });
  };

  useListHotkeys({
    nodes: sorted,
    selection: sel,
    enabled: !menu,
    handlers: {
      open: (n) => canWrite && void restore([n]),
      trash: canWrite ? (ns) => purge(ns) : undefined,
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 lg:px-6">
        {sel.selected.size > 0 && canWrite ? (
          <div className="flex min-h-16 items-center py-2">
            <SelectionBar
              count={sel.selected.size}
              onClear={sel.clear}
              actions={[
                { id: 'restore', label: t('trash.restore'), icon: <RestoreIcon size={16} />, onClick: () => void restore(selectedNodes) },
                { id: 'purge', label: t('trash.deleteForever'), icon: <TrashIcon size={16} />, danger: true, onClick: () => purge(selectedNodes) },
              ]}
            />
          </div>
        ) : (
          <PageHeader
            title={t('nav.trash')}
            subtitle={t('trash.subtitle')}
            actions={
              <>
                {roots.length > 1 && (
                  <Select
                    value={ws?.id}
                    onChange={(e) => navigate(`/trash/${e.target.value}`)}
                    aria-label={t('trash.workspace')}
                    className="!w-44"
                  >
                    {roots.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.type === 'personal' ? t('nav.myFiles') : w.name}
                      </option>
                    ))}
                  </Select>
                )}
                {canWrite && sorted.length > 0 && (
                  <Button variant="danger" size="md" icon={<TrashIcon size={15} />} onClick={emptyTrash}>
                    {t('trash.empty')}
                  </Button>
                )}
              </>
            }
          />
        )}
        {error && <Notice kind="error" className="mb-3">{error}</Notice>}
      </div>
      <div ref={scrollRef} className="scroll-slim min-h-0 flex-1 overflow-y-auto px-1.5 pb-24 sm:px-2.5 lg:px-4 lg:pb-8">
        {items === null ? (
          <ListSkeleton />
        ) : (
          <FileList
            nodes={sorted}
            mode="list"
            scrollRef={scrollRef}
            selection={sel}
            selectable={canWrite}
            label={t('nav.trash')}
            columns={['deleted']}
            onOpen={() => undefined}
            onMenu={menuFor}
            rowActions={
              canWrite
                ? (n) => (
                    <>
                      <RowAction label={t('trash.restoreName', { name: n.name })} onClick={() => void restore([n])}>
                        <RestoreIcon size={15} />
                      </RowAction>
                      <RowAction label={t('trash.deleteForeverName', { name: n.name })} onClick={() => purge([n])}>
                        <TrashIcon size={15} />
                      </RowAction>
                    </>
                  )
                : undefined
            }
            emptyState={<EmptyState icon={<TrashIcon size={24} />} title={t('trash.emptyStateTitle')} hint={t('trash.emptyStateHint')} />}
          />
        )}
      </div>
      {menu && <MenuList items={menu.items} point={menu.point} anchor={menu.anchor} align="end" onClose={() => setMenu(null)} />}
      {dialog}
    </div>
  );
}
