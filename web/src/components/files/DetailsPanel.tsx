import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { downloadUrl, type Node, type Workspace } from '../../lib/api';
import { useEscape, useFocusTrap, useIsDesktop } from '../../lib/hooks';
import { useI18n } from '../../i18n';
import { ActivitySection, VersionsSection } from '../VersionsPanel';
import { SharingSection } from '../SharePanel';
import { CloseIcon, DownloadIcon, InfoIcon, OpenIcon, ShareIcon } from '../icons';
import { Button, IconButton, LinkButton } from '../ui/Button';
import { InfoRow } from '../ui/Card';
import { Tabs, tabPanelProps } from '../ui/Tabs';
import { FileGlyph, FileThumb } from './FileThumb';
import { fileCategory, nameExtLabel } from './types';

export type DetailsTab = 'info' | 'sharing' | 'versions' | 'activity';

type Props = {
  /** The single node to describe; null shows the folder summary. */
  node: Node | null;
  selectionCount: number;
  selectionBytes: number;
  folder: { name: string; count: number };
  tab: DetailsTab;
  onTab: (t: DetailsTab) => void;
  onClose: () => void;
  onOpen: (n: Node) => void;
  location?: string;
  owner?: ReactNode;
  workspaces: Workspace[];
  canWrite: boolean;
  canShare: boolean;
  onChanged?: () => void;
};

function Body({
  node,
  selectionCount,
  selectionBytes,
  folder,
  tab,
  onTab,
  onClose,
  onOpen,
  location,
  owner,
  workspaces,
  canWrite,
  canShare,
  onChanged,
}: Props) {
  const { t, formatBytes, formatDateTime } = useI18n();
  const base = useId();

  if (!node) {
    return (
      <>
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line pr-2 pl-5">
          <h2 className="text-base font-semibold text-ink">{t('details.title')}</h2>
          <IconButton label={t('details.close')} onClick={onClose}>
            <CloseIcon size={16} />
          </IconButton>
        </div>
        <div className="flex flex-col items-center px-6 py-10 text-center">
          <FileGlyph name={folder.name} kind="folder" size={72} />
          <p className="mt-3 text-md font-semibold text-ink">{selectionCount > 1 ? t('details.selected', { count: selectionCount }) : folder.name}</p>
          <p className="mt-1 text-sm text-muted">
            {selectionCount > 1
              ? t('details.selectedSize', { size: formatBytes(selectionBytes) })
              : t('details.folderItems', { count: folder.count })}
          </p>
          {selectionCount <= 1 && <p className="mt-6 max-w-[16rem] text-sm text-faint">{t('details.hint')}</p>}
        </div>
      </>
    );
  }

  const isFile = node.kind === 'file';
  const tabs = [
    { value: 'info' as const, label: t('details.info') },
    ...(canShare ? [{ value: 'sharing' as const, label: t('details.sharing') }] : []),
    ...(isFile ? [{ value: 'versions' as const, label: t('details.versions') }] : []),
    { value: 'activity' as const, label: t('details.activity') },
  ];
  const current = tabs.some((x) => x.value === tab) ? tab : 'info';
  const isImage = fileCategory(node.name, node.mime) === 'image';

  return (
    <>
      <div className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-3">
        <FileThumb node={node} size={40} />
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="line-clamp-2 text-base font-semibold break-words text-ink" title={node.name}>
            {node.name}
          </h2>
          <p className="text-xs text-muted">
            {isFile ? `${nameExtLabel(node.name)} · ${formatBytes(node.size)}` : t('files.folder')}
          </p>
        </div>
        <IconButton label={t('details.close')} onClick={onClose} className="-mr-2">
          <CloseIcon size={16} />
        </IconButton>
      </div>
      <Tabs items={tabs} value={current} onChange={onTab} label={t('details.tabs')} idBase={base} className="shrink-0 px-3" />
      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-5 py-4" {...tabPanelProps(base, current)}>
        {current === 'info' && (
          <div className="space-y-5">
            {isImage && (
              <button
                type="button"
                onClick={() => onOpen(node)}
                className="block aspect-[4/3] w-full overflow-hidden rounded-lg border border-line"
                aria-label={t('details.openPreview')}
              >
                <FileThumb node={node} fill />
              </button>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={<OpenIcon size={14} />} onClick={() => onOpen(node)}>
                {t('common.open')}
              </Button>
              {isFile && (
                <LinkButton size="sm" variant="secondary" href={downloadUrl(node.id)} icon={<DownloadIcon size={14} />}>
                  {t('common.download')}
                </LinkButton>
              )}
              {canShare && (
                <Button size="sm" variant="secondary" icon={<ShareIcon size={14} />} onClick={() => onTab('sharing')}>
                  {t('files.share')}
                </Button>
              )}
            </div>
            <dl className="divide-y divide-line">
              <InfoRow label={t('details.type')}>{isFile ? node.mime || nameExtLabel(node.name) : t('files.folder')}</InfoRow>
              {isFile && <InfoRow label={t('details.size')}>{formatBytes(node.size)}</InfoRow>}
              {location && <InfoRow label={t('details.location')}>{location}</InfoRow>}
              {owner && <InfoRow label={t('details.owner')}>{owner}</InfoRow>}
              <InfoRow label={t('details.modified')}>{formatDateTime(node.updated_at)}</InfoRow>
              <InfoRow label={t('details.created')}>{formatDateTime(node.created_at)}</InfoRow>
              {node.permission && (
                <InfoRow label={t('details.access')}>{node.permission === 'write' ? t('share.canEdit') : t('share.canView')}</InfoRow>
              )}
            </dl>
          </div>
        )}
        {current === 'sharing' && <SharingSection node={node} workspaces={workspaces} />}
        {current === 'versions' && isFile && <VersionsSection node={node} canWrite={canWrite} onRestored={onChanged} />}
        {current === 'activity' && <ActivitySection node={node} />}
      </div>
    </>
  );
}

/**
 * Right-side details panel (info · sharing · versions · activity). Docked
 * on desktop; a full-height sheet on smaller screens.
 */
export function DetailsPanel(props: Props) {
  const desktop = useIsDesktop();
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  if (desktop) {
    return (
      <aside
        aria-label={t('details.title')}
        className="animate-slide-in-right flex w-[340px] shrink-0 flex-col border-l border-line bg-surface xl:w-[380px]"
      >
        <Body {...props} />
      </aside>
    );
  }
  return <DetailsSheet {...props} sheetRef={ref} />;
}

function DetailsSheet(props: Props & { sheetRef: React.RefObject<HTMLDivElement | null> }) {
  const { t } = useI18n();
  useFocusTrap(props.sheetRef);
  useEscape(props.onClose);
  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-[95] flex items-end bg-overlay sm:justify-end"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        ref={props.sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('details.title')}
        tabIndex={-1}
        className="animate-slide-up flex h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-lg outline-none sm:animate-slide-in-right sm:h-full sm:w-[400px] sm:rounded-none"
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-strong sm:hidden" aria-hidden />
        <Body {...props} />
      </div>
    </div>,
    document.body,
  );
}

export { InfoIcon as DetailsIcon };
