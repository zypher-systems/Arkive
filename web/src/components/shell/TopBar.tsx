import { useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ArkiveLogo } from '../ArkiveLogo';
import {
  AdminIcon,
  ChevronDownIcon,
  FilePlusIcon,
  FolderPlusIcon,
  FolderUploadIcon,
  KeyboardIcon,
  LogoutIcon,
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  SearchIcon,
  SunIcon,
  UploadIcon,
  UserIcon,
} from '../icons';
import { Button, IconButton } from '../ui/Button';
import { Avatar, Kbd } from '../ui/Card';
import { DropdownMenu, type MenuItem } from '../ui/Menu';
import { useAuth } from '../../lib/auth';
import { useTheme, type ThemePref } from '../../lib/theme';
import { useI18n } from '../../i18n';
import { isMac } from '../../lib/hooks';
import { useInstance, WEB_VERSION } from '../../lib/instance';
import { useUploadEngine, type UploadTarget } from '../../lib/uploads';
import { fromFileList } from '../../lib/dropFiles';

export function ThemeMenu() {
  const { t } = useI18n();
  const { pref, theme, setPref } = useTheme();
  const opts: { value: ThemePref; label: string; icon: React.ReactNode }[] = [
    { value: 'system', label: t('theme.system'), icon: <MonitorIcon size={15} /> },
    { value: 'light', label: t('theme.light'), icon: <SunIcon size={15} /> },
    { value: 'dark', label: t('theme.dark'), icon: <MoonIcon size={15} /> },
  ];
  return (
    <DropdownMenu
      align="end"
      label={t('theme.label')}
      minWidth={176}
      items={opts.map((o) => ({
        id: o.value,
        label: (
          <span className="flex items-center gap-2.5">
            <span className="text-muted">{o.icon}</span>
            {o.label}
          </span>
        ),
        checked: pref === o.value,
        onSelect: () => setPref(o.value),
      }))}
      trigger={
        <IconButton label={t('theme.label')} size="lg">
          {theme === 'dark' ? <MoonIcon size={17} /> : <SunIcon size={17} />}
        </IconButton>
      }
    />
  );
}

export function UserMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const { t } = useI18n();
  const { user, logout } = useAuth();
  const { info } = useInstance();
  const navigate = useNavigate();
  const name = user?.display_name || user?.email || '?';
  const version = info?.version || WEB_VERSION;

  const items: MenuItem[] = [
    {
      kind: 'label',
      id: 'who',
      label: (
        <span className="block normal-case tracking-normal">
          <span className="block truncate text-sm font-semibold text-ink">{user?.display_name || '—'}</span>
          <span className="block truncate text-xs font-normal text-muted">{user?.email}</span>
        </span>
      ),
    },
    { kind: 'separator', id: 's0' },
    { id: 'account', label: t('nav.account'), icon: <UserIcon size={15} />, onSelect: () => navigate('/account') },
    ...(user?.is_instance_admin
      ? [{ id: 'admin', label: t('nav.admin'), icon: <AdminIcon size={15} />, onSelect: () => navigate('/admin') } as MenuItem]
      : []),
    {
      id: 'keys',
      label: t('shell.shortcuts'),
      icon: <KeyboardIcon size={15} />,
      shortcut: '?',
      onSelect: onShortcuts,
    },
    { kind: 'separator', id: 's1' },
    { id: 'logout', label: t('auth.signOut'), icon: <LogoutIcon size={15} />, onSelect: () => void logout() },
    { kind: 'separator', id: 's2' },
    { kind: 'label', id: 'ver', label: <span className="normal-case tracking-normal">{t('shell.version', { version })}</span> },
  ];

  return (
    <DropdownMenu
      align="end"
      label={t('shell.userMenu')}
      minWidth={240}
      items={items}
      trigger={
        <button
          type="button"
          aria-label={t('shell.userMenuFor', { name })}
          className="flex h-9 items-center gap-2 rounded-full p-0.5 transition hover:bg-hover coarse:h-11 sm:rounded-lg sm:py-1 sm:pr-2 sm:pl-1"
        >
          <Avatar name={name} size={30} />
          <ChevronDownIcon size={14} className="hidden text-faint sm:block" />
        </button>
      }
    />
  );
}

/** Hidden file inputs + helpers to open the OS pickers for a target folder. */
export function useFilePickers() {
  const { engine } = useUploadEngine();
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<UploadTarget | null>(null);

  const inputs = (
    <>
      <input
        ref={filesRef}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        onChange={(e) => {
          const picked = fromFileList(e.target.files);
          if (targetRef.current && picked.length) engine.enqueue(picked, targetRef.current);
          e.target.value = '';
        }}
      />
      <input
        ref={folderRef}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => {
          const picked = fromFileList(e.target.files);
          if (targetRef.current && picked.length) engine.enqueue(picked, targetRef.current);
          e.target.value = '';
        }}
      />
    </>
  );

  return {
    inputs,
    pickFiles: (target: UploadTarget) => {
      targetRef.current = target;
      filesRef.current?.click();
    },
    pickFolder: (target: UploadTarget) => {
      targetRef.current = target;
      folderRef.current?.click();
    },
  };
}

export function UploadMenu({ fallbackTarget, compact }: { fallbackTarget: UploadTarget | null; compact?: boolean }) {
  const { t } = useI18n();
  const { activeFolder } = useUploadEngine();
  const { inputs, pickFiles, pickFolder } = useFilePickers();
  const target = activeFolder ? (activeFolder.readOnly ? null : activeFolder.target) : fallbackTarget;

  const items: MenuItem[] = [
    {
      id: 'files',
      label: t('upload.files'),
      icon: <UploadIcon size={15} />,
      disabled: !target,
      onSelect: () => target && pickFiles(target),
    },
    {
      id: 'folder',
      label: t('upload.folder'),
      icon: <FolderUploadIcon size={15} />,
      disabled: !target,
      onSelect: () => target && pickFolder(target),
    },
    ...(activeFolder?.newFolder || activeFolder?.newFile
      ? ([
          { kind: 'separator', id: 'sep' },
          ...(activeFolder.newFolder
            ? [{ id: 'mkdir', label: t('files.newFolder'), icon: <FolderPlusIcon size={15} />, shortcut: isMac ? '⇧N' : 'Shift+N', onSelect: activeFolder.newFolder }]
            : []),
          ...(activeFolder.newFile
            ? [
                { id: 'txt', label: t('files.newTextFile'), icon: <FilePlusIcon size={15} />, onSelect: () => activeFolder.newFile?.('.txt') },
                { id: 'md', label: t('files.newMarkdownFile'), icon: <FilePlusIcon size={15} />, onSelect: () => activeFolder.newFile?.('.md') },
              ]
            : []),
        ] as MenuItem[])
      : []),
    ...(target
      ? ([
          { kind: 'separator', id: 'sep2' },
          { kind: 'label', id: 'dest', label: <span className="normal-case tracking-normal">{t('upload.into', { folder: target.label })}</span> },
        ] as MenuItem[])
      : []),
  ];

  return (
    <>
      {inputs}
      <DropdownMenu
        align="end"
        label={t('upload.menu')}
        minWidth={232}
        items={items}
        trigger={
          compact ? (
            <IconButton label={t('upload.menu')} variant="accent" size="lg" className="!h-14 !w-14 !rounded-full">
              <UploadIcon size={22} />
            </IconButton>
          ) : (
            <Button variant="accent" icon={<UploadIcon size={16} />} iconRight={<ChevronDownIcon size={14} className="-mr-1 opacity-80" />}>
              {t('upload.button')}
            </Button>
          )
        }
      />
    </>
  );
}

export function TopBar({
  onOpenNav,
  onOpenSearch,
  onShortcuts,
  fallbackTarget,
}: {
  onOpenNav: () => void;
  onOpenSearch: () => void;
  onShortcuts: () => void;
  fallbackTarget: UploadTarget | null;
}) {
  const { t } = useI18n();
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/80 px-3 backdrop-blur supports-[backdrop-filter]:bg-surface/70 sm:gap-3 sm:px-4 lg:px-6">
      <IconButton label={t('shell.openNav')} size="lg" className="lg:hidden" onClick={onOpenNav}>
        <MenuIcon size={19} />
      </IconButton>
      <NavLink to="/" className="flex items-center gap-2 lg:hidden" aria-label={t('shell.home')}>
        <ArkiveLogo size={26} className="text-primary" />
      </NavLink>

      <button
        type="button"
        onClick={onOpenSearch}
        aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
        className="ml-auto flex h-9 min-w-0 items-center gap-2.5 rounded-lg border border-line bg-inset px-3 text-left text-base text-faint transition hover:border-strong hover:bg-surface sm:ml-0 sm:w-full sm:max-w-md coarse:h-11 max-sm:w-11 max-sm:justify-center max-sm:border-transparent max-sm:bg-transparent max-sm:px-0"
      >
        <SearchIcon size={16} className="shrink-0 max-sm:text-muted" />
        <span className="hidden flex-1 truncate sm:block">{t('search.placeholder')}</span>
        <span className="sr-only sm:hidden">{t('search.open')}</span>
        <span className="hidden items-center gap-1 sm:flex">
          <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="flex items-center gap-1 sm:ml-auto sm:gap-2">
        <div className="hidden sm:block">
          <UploadMenu fallbackTarget={fallbackTarget} />
        </div>
        <ThemeMenu />
        <UserMenu onShortcuts={onShortcuts} />
      </div>
    </header>
  );
}
