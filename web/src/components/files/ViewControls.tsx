import { DetailsViewIcon, GalleryIcon, ListViewIcon, PanelRightIcon, SortIcon, TilesViewIcon } from '../icons';
import { IconButton } from '../ui/Button';
import { DropdownMenu } from '../ui/Menu';
import { Segmented } from '../ui/Segmented';
import type { FileViewMode } from './types';
import type { SortKey, SortSpec } from '../../lib/sort';
import { useI18n } from '../../i18n';

export function ViewSwitcher({ value, onChange }: { value: FileViewMode; onChange: (m: FileViewMode) => void }) {
  const { t } = useI18n();
  return (
    <Segmented
      size="sm"
      label={t('view.label')}
      value={value}
      onChange={onChange}
      items={[
        { value: 'list', icon: <ListViewIcon size={15} />, title: t('view.list') },
        { value: 'details', icon: <DetailsViewIcon size={15} />, title: t('view.details') },
        { value: 'tiles', icon: <TilesViewIcon size={15} />, title: t('view.tiles') },
        { value: 'gallery', icon: <GalleryIcon size={15} />, title: t('view.gallery') },
      ]}
    />
  );
}

export function SortMenu({ sort, onSort }: { sort: SortSpec; onSort: (s: SortSpec) => void }) {
  const { t } = useI18n();
  const keys: { key: SortKey; label: string }[] = [
    { key: 'name', label: t('sort.name') },
    { key: 'modified', label: t('sort.modified') },
    { key: 'size', label: t('sort.size') },
    { key: 'type', label: t('sort.type') },
  ];
  return (
    <DropdownMenu
      align="end"
      label={t('sort.label')}
      items={[
        { kind: 'label', id: 'l1', label: t('sort.by') },
        ...keys.map((k) => ({
          id: k.key,
          label: k.label,
          checked: sort.key === k.key,
          onSelect: () => onSort({ key: k.key, dir: sort.dir }),
        })),
        { kind: 'separator', id: 's' },
        { kind: 'label', id: 'l2', label: t('sort.order') },
        { id: 'asc', label: t('sort.asc'), checked: sort.dir === 'asc', onSelect: () => onSort({ ...sort, dir: 'asc' }) },
        { id: 'desc', label: t('sort.desc'), checked: sort.dir === 'desc', onSelect: () => onSort({ ...sort, dir: 'desc' }) },
      ]}
      trigger={
        <IconButton label={t('sort.label')} size="md">
          <SortIcon size={16} />
        </IconButton>
      }
    />
  );
}

export function DetailsToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  return (
    <IconButton
      label={open ? t('details.hide') : t('details.show')}
      aria-pressed={open}
      aria-keyshortcuts="i"
      size="md"
      onClick={onToggle}
      className={open ? '!bg-active !text-ink' : ''}
    >
      <PanelRightIcon size={16} />
    </IconButton>
  );
}
