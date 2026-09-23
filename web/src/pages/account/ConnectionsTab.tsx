import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type StorageConnection, type Workspace } from '../../lib/api';
import { useConfirm } from '../../lib/confirm';
import { useInstance } from '../../lib/instance';
import { useWorkspaces } from '../../lib/workspaces';
import { useI18n } from '../../i18n';
import { useToast } from '../../components/Toast';
import { Button, LinkButton } from '../../components/ui/Button';
import { Badge, EmptyState, Section } from '../../components/ui/Card';
import { Field, Input, Select } from '../../components/ui/Input';
import { Notice } from '../../components/ui/Notice';
import { Spinner } from '../../components/ui/Spinner';
import { CloudIcon, ConnectIcon, TrashIcon } from '../../components/icons';

function MigrateButton({
  label,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="secondary" size="sm" loading={busy} disabled={disabled} onClick={onClick} className="justify-start">
      {label}
    </Button>
  );
}

export function ConnectionsTab() {
  const { t, formatDate } = useI18n();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const { info } = useInstance();
  const { refresh: refreshWorkspaces } = useWorkspaces();
  const { ask, dialog } = useConfirm();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [connections, setConnections] = useState<StorageConnection[] | null>(null);
  const [migrating, setMigrating] = useState('');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [type, setType] = useState<'webdav' | 'internxt'>('webdav');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);

  const gdriveEnabled = !!info?.google_drive_enabled;

  const load = useCallback(async () => {
    const [ws, conns] = await Promise.all([
      api.workspaces(),
      api.storageConnections().catch(() => [] as StorageConnection[]),
    ]);
    setWorkspaces(ws);
    setConnections(conns);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  // OAuth callback lands here with ?gdrive=connected or ?error=gdrive_…
  useEffect(() => {
    const connected = params.get('gdrive') === 'connected';
    const err = params.get('error');
    if (!connected && !err?.startsWith('gdrive')) return;
    if (connected) {
      toast({ message: t('account.connections.gdriveConnected') });
      void load();
      void refreshWorkspaces();
    } else {
      toast({ tone: 'error', message: t('account.connections.gdriveFailed', { code: err || '' }) });
    }
    const next = new URLSearchParams(params);
    next.delete('gdrive');
    next.delete('error');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const gdrive = connections?.find((c) => c.type === 'gdrive');
  const personal = workspaces.find((w) => w.type === 'personal');
  const driveMount =
    workspaces.find((w) => w.type === 'mount' && w.id === gdrive?.workspace_id) ||
    workspaces.find((w) => w.type === 'mount');
  const others = (connections || []).filter((c) => c.type !== 'gdrive');

  async function runMigrate(
    key: string,
    workspaceId: string,
    body: { use_default?: boolean; storage_backend_id?: string },
    okMessage: string,
  ) {
    setMigrating(key);
    setError('');
    setProgress(t('account.connections.copying'));
    try {
      const res = await api.migrateWorkspace(workspaceId, body);
      if (res.job?.id) {
        setProgress(t('account.connections.queued', { total: res.job.total }));
        for (let i = 0; i < 120; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const job = await api.migrationJob(res.job.id);
          if (job.status === 'completed') {
            toast({ message: t('account.connections.migrated', { message: okMessage, copied: job.copied, total: job.total }) });
            break;
          }
          if (job.status === 'failed') {
            setError(job.error || t('account.connections.migrateFailed'));
            break;
          }
          setProgress(t('account.connections.migrating', { copied: job.copied, total: job.total }));
        }
      } else {
        toast({
          message: res.migrated
            ? t('account.connections.migrated', { message: okMessage, copied: res.copied ?? 0, total: res.total ?? 0 })
            : okMessage,
        });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMigrating('');
      setProgress('');
    }
  }

  function disconnect(c: StorageConnection) {
    ask({
      title: t('account.connections.disconnectTitle'),
      message:
        c.type === 'gdrive' ? t('account.connections.disconnectGdrive') : t('account.connections.disconnectMessage', { name: c.name }),
      confirmLabel: t('account.connections.disconnect'),
      run: async () => {
        try {
          await api.disconnectStorage(c.id);
          await load();
          void refreshWorkspaces();
          toast({ message: t('account.connections.disconnected', { name: c.name || c.type }) });
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          throw e;
        }
      },
    });
  }

  async function connect(e: FormEvent) {
    e.preventDefault();
    setConnecting(true);
    setError('');
    try {
      await api.connectWebDAV({ type, url: url.trim(), username, password });
      setPassword('');
      setUrl('');
      setUsername('');
      toast({ message: t('account.connections.webdavConnected') });
      await load();
      void refreshWorkspaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }

  const busy = !!migrating;

  return (
    <div className="space-y-6">
      {error && <Notice kind="error">{error}</Notice>}

      {gdriveEnabled && (
        <Section
          title={t('account.connections.gdriveTitle')}
          description={t('account.connections.gdriveDescription')}
          actions={
            gdrive ? (
              <Badge tone="ok">{t('account.connections.connected')}</Badge>
            ) : undefined
          }
        >
          {connections === null ? (
            <div className="flex justify-center py-3">
              <Spinner className="text-faint" />
            </div>
          ) : gdrive ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-inset/60 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-muted ring-1 ring-line">
                  <CloudIcon size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium text-ink">{gdrive.account_email || gdrive.name}</p>
                  <p className="truncate text-sm text-muted">
                    {driveMount
                      ? t('account.connections.openUnder', { name: driveMount.name || t('nav.cloud') })
                      : t('account.connections.since', { date: formatDate(gdrive.created_at) })}
                  </p>
                </div>
                <Button size="sm" variant="danger" onClick={() => disconnect(gdrive)}>
                  {t('account.connections.disconnect')}
                </Button>
              </div>
              {personal && (
                <details className="group rounded-lg border border-line px-4 py-3">
                  <summary className="cursor-pointer text-base font-medium text-ink marker:text-faint">
                    {t('account.connections.advancedTitle')}
                  </summary>
                  <p className="mt-2 text-sm text-muted">{t('account.connections.advancedHint')}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <MigrateButton
                      label={t('account.connections.personalToDrive')}
                      busy={migrating === 'personal-drive'}
                      disabled={busy || personal.storage_backend_id === gdrive.id}
                      onClick={() =>
                        void runMigrate('personal-drive', personal.id, { storage_backend_id: gdrive.id }, t('account.connections.personalOnDrive'))
                      }
                    />
                    <MigrateButton
                      label={t('account.connections.personalToInstance')}
                      busy={migrating === 'personal-default'}
                      disabled={busy}
                      onClick={() =>
                        void runMigrate('personal-default', personal.id, { use_default: true }, t('account.connections.personalOnInstance'))
                      }
                    />
                    {driveMount && (
                      <>
                        <MigrateButton
                          label={t('account.connections.mountToDrive')}
                          busy={migrating === 'mount-drive'}
                          disabled={busy || driveMount.storage_backend_id === gdrive.id}
                          onClick={() =>
                            void runMigrate('mount-drive', driveMount.id, { storage_backend_id: gdrive.id }, t('account.connections.mountOnDrive'))
                          }
                        />
                        <MigrateButton
                          label={t('account.connections.mountToInstance')}
                          busy={migrating === 'mount-default'}
                          disabled={busy}
                          onClick={() =>
                            void runMigrate('mount-default', driveMount.id, { use_default: true }, t('account.connections.mountOnInstance'))
                          }
                        />
                      </>
                    )}
                  </div>
                  {progress && (
                    <p className="mt-3 flex items-center gap-2 text-sm text-muted" aria-live="polite">
                      <Spinner size={14} /> {progress}
                    </p>
                  )}
                </details>
              )}
            </div>
          ) : (
            <LinkButton href="/api/storage/google/start" variant="primary" icon={<ConnectIcon size={15} />}>
              {t('account.connections.connectGdrive')}
            </LinkButton>
          )}
        </Section>
      )}

      <form onSubmit={connect}>
        <Section
          title={t('account.connections.webdavTitle')}
          description={t('account.connections.webdavDescription')}
          footer={
            <Button type="submit" variant="primary" loading={connecting} disabled={!url.trim()} icon={<ConnectIcon size={15} />}>
              {t('account.connections.connect')}
            </Button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('account.connections.provider')}>
              {({ id }) => (
                <Select id={id} value={type} onChange={(e) => setType(e.target.value as 'webdav' | 'internxt')}>
                  <option value="webdav">{t('account.connections.providerWebdav')}</option>
                  <option value="internxt">{t('account.connections.providerInternxt')}</option>
                </Select>
              )}
            </Field>
            <Field label={t('account.connections.url')}>
              {({ id }) => (
                <Input
                  id={id}
                  type="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://webdav.icedrive.io/…"
                  spellCheck={false}
                />
              )}
            </Field>
            <Field label={t('account.connections.username')}>
              {({ id }) => <Input id={id} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />}
            </Field>
            <Field label={t('account.connections.password')}>
              {({ id }) => (
                <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              )}
            </Field>
          </div>
        </Section>
      </form>

      <Section title={t('account.connections.listTitle')} description={t('account.connections.listDescription')}>
        {connections === null ? (
          <div className="flex justify-center py-3">
            <Spinner className="text-faint" />
          </div>
        ) : others.length === 0 ? (
          <EmptyState compact icon={<CloudIcon size={20} />} title={t('account.connections.noneTitle')} hint={t('account.connections.noneHint')} />
        ) : (
          <ul className="divide-y divide-line">
            {others.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-inset text-muted ring-1 ring-line">
                  <CloudIcon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium text-ink">{c.name || c.type}</p>
                  <p className="truncate text-sm text-muted">
                    {c.type.toUpperCase()}
                    {c.account_email ? ` · ${c.account_email}` : ''} · {t('account.connections.since', { date: formatDate(c.created_at) })}
                  </p>
                </div>
                <Button size="sm" variant="ghost" icon={<TrashIcon size={14} />} onClick={() => disconnect(c)} className="hover:!text-danger">
                  <span className="max-sm:sr-only">{t('account.connections.disconnect')}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {dialog}
    </div>
  );
}
