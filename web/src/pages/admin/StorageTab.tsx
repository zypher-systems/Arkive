import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type StorageBackend, type Workspace } from '../../lib/api';
import { useConfirm } from '../../lib/confirm';
import { useI18n } from '../../i18n';
import { useToast } from '../../components/Toast';
import { Badge, EmptyState, Section } from '../../components/ui/Card';
import { Button, IconButton } from '../../components/ui/Button';
import { Field, Input, Select, Switch, Checkbox } from '../../components/ui/Input';
import { DropdownMenu } from '../../components/ui/Menu';
import { Modal } from '../../components/ui/Modal';
import { Notice } from '../../components/ui/Notice';
import { Segmented } from '../../components/ui/Segmented';
import { Spinner } from '../../components/ui/Spinner';
import { CheckCircleIcon, CloudIcon, DatabaseIcon, MoreIcon, PlusIcon, StarIcon, TrashIcon } from '../../components/icons';
import { bytesToGb, errText, gbToBytes } from './shared';

/** Non-secret, human-meaningful parts of a backend config. */
function configSummary(b: StorageBackend) {
  const c = b.config || {};
  const parts: string[] = [];
  for (const k of ['endpoint', 'bucket', 'region', 'mount_path', 'url', 'path']) {
    const v = c[k];
    if (typeof v === 'string' && v) parts.push(k === 'bucket' ? `bucket: ${v}` : v);
  }
  return parts.join(' · ');
}

function AddBackendModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [type, setType] = useState<'local' | 's3'>('local');
  const [name, setName] = useState('');
  const [mountPath, setMountPath] = useState('/data/arkive');
  const [s3, setS3] = useState({
    endpoint: '',
    access_key: '',
    secret_key: '',
    bucket: '',
    region: 'us-east-1',
    use_ssl: false,
    force_path_style: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const config = type === 's3' ? { ...s3 } : { mount_path: mountPath };
      await api.createBackend({ name: name.trim(), type, config, is_default: false });
      toast({ message: t('admin.storage.added') });
      onAdded();
      onClose();
    } catch (err) {
      setError(errText(err, t('common.failed')));
    } finally {
      setBusy(false);
    }
  }

  const s3Fields = [
    ['endpoint', t('admin.storage.endpoint'), 'text', true],
    ['bucket', t('admin.storage.bucket'), 'text', true],
    ['region', t('admin.storage.region'), 'text', false],
    ['access_key', t('admin.storage.accessKey'), 'text', true],
    ['secret_key', t('admin.storage.secretKey'), 'password', true],
  ] as const;

  return (
    <Modal
      title={t('admin.storage.addTitle')}
      icon={<DatabaseIcon size={17} />}
      onClose={onClose}
      busy={busy}
      width="max-w-lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="add-backend" loading={busy}>
            {t('admin.storage.testAndSave')}
          </Button>
        </>
      }
    >
      <form id="add-backend" onSubmit={submit} className="space-y-4">
        <Segmented
          full
          label={t('admin.storage.type')}
          value={type}
          onChange={setType}
          items={[
            { value: 'local', label: t('admin.storage.typeLocal') },
            { value: 's3', label: t('admin.storage.typeS3') },
          ]}
        />
        <Field label={t('admin.storage.name')}>
          {({ id }) => <Input id={id} required data-autofocus value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        {type === 'local' ? (
          <Field label={t('admin.storage.mountPath')} hint={t('admin.storage.mountPathHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                required
                aria-describedby={describedBy}
                className="font-mono"
                value={mountPath}
                onChange={(e) => setMountPath(e.target.value)}
              />
            )}
          </Field>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {s3Fields.map(([key, label, inputType, required]) => (
                <Field key={key} label={label}>
                  {({ id }) => (
                    <Input
                      id={id}
                      required={required}
                      type={inputType}
                      autoComplete={inputType === 'password' ? 'new-password' : 'off'}
                      value={String(s3[key])}
                      onChange={(e) => setS3({ ...s3, [key]: e.target.value })}
                    />
                  )}
                </Field>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-base text-ink">
                <Checkbox checked={s3.use_ssl} onChange={(e) => setS3({ ...s3, use_ssl: e.target.checked })} />
                {t('admin.storage.useSsl')}
              </label>
              <label className="flex items-center gap-2 text-base text-ink">
                <Checkbox
                  checked={s3.force_path_style}
                  onChange={(e) => setS3({ ...s3, force_path_style: e.target.checked })}
                />
                {t('admin.storage.pathStyle')}
              </label>
            </div>
          </>
        )}
        {error && <Notice kind="error">{error}</Notice>}
      </form>
    </Modal>
  );
}

export function StorageTab() {
  const { t } = useI18n();
  const { toast, dismiss } = useToast();
  const { ask, dialog } = useConfirm();
  const [backends, setBackends] = useState<StorageBackend[] | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [quotaGB, setQuotaGB] = useState('');
  const [quotaBusy, setQuotaBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [copyOnAssign, setCopyOnAssign] = useState(false);
  const [migratingWs, setMigratingWs] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [b, w, q] = await Promise.all([
        api.backends(),
        api.workspaces(),
        api.quotaSettings().catch(() => ({ default_workspace_quota_bytes: null })),
      ]);
      setBackends(b);
      setWorkspaces(w);
      setQuotaGB(bytesToGb(q.default_workspace_quota_bytes));
      setError('');
    } catch (e) {
      setBackends((b) => b ?? []);
      setError(errText(e, t('admin.loadFailed')));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(fn: () => Promise<unknown>, ok: string, reload = true) {
    try {
      await fn();
      if (reload) await refresh();
      toast({ message: ok });
    } catch (e) {
      toast({ tone: 'error', message: errText(e, t('common.failed')) });
    }
  }

  const defaultId = backends?.find((b) => b.is_default)?.id || '';
  const wsLabel = (w: Workspace) =>
    w.type === 'personal' ? t('nav.myFiles') : w.type === 'mount' ? t('admin.storage.mount', { name: w.name }) : w.name;

  return (
    <div className="space-y-6">
      {error && <Notice kind="error">{error}</Notice>}

      <Section
        title={t('admin.storage.backendsTitle')}
        description={t('admin.storage.backendsDescription')}
        actions={
          <Button variant="secondary" size="sm" icon={<PlusIcon size={14} />} onClick={() => setAdding(true)}>
            {t('admin.storage.add')}
          </Button>
        }
      >
        {backends === null ? (
          <div className="flex justify-center py-6">
            <Spinner className="text-faint" />
          </div>
        ) : backends.length === 0 ? (
          <EmptyState compact icon={<DatabaseIcon size={20} />} title={t('admin.storage.empty')} />
        ) : (
          <ul className="-mx-2 divide-y divide-line">
            {backends.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-2 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-inset text-muted ring-1 ring-line">
                  {b.type === 'local' || b.type === 'nfs' ? <DatabaseIcon size={16} /> : <CloudIcon size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-base font-medium text-ink">
                    <span className="truncate">{b.name}</span>
                    <Badge>{b.type}</Badge>
                    {b.is_default && <Badge tone="accent" icon={<StarIcon size={10} />}>{t('admin.storage.default')}</Badge>}
                  </p>
                  {configSummary(b) && (
                    <p className="truncate font-mono text-xs text-muted" title={configSummary(b)}>
                      {configSummary(b)}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<CheckCircleIcon size={14} />}
                  className="max-sm:hidden"
                  onClick={() => void act(() => api.testBackend(b.id), t('admin.storage.testOk', { name: b.name }), false)}
                >
                  {t('admin.storage.test')}
                </Button>
                <DropdownMenu
                  align="end"
                  label={t('admin.storage.actionsFor', { name: b.name })}
                  items={[
                    {
                      id: 'test',
                      label: t('admin.storage.test'),
                      icon: <CheckCircleIcon size={15} />,
                      onSelect: () => void act(() => api.testBackend(b.id), t('admin.storage.testOk', { name: b.name }), false),
                    },
                    {
                      id: 'default',
                      label: t('admin.storage.makeDefault'),
                      icon: <StarIcon size={15} />,
                      disabled: b.is_default,
                      onSelect: () => void act(() => api.setDefaultBackend(b.id), t('admin.storage.defaultSet', { name: b.name })),
                    },
                    { kind: 'separator', id: 's' },
                    {
                      id: 'delete',
                      label: t('admin.storage.delete'),
                      icon: <TrashIcon size={15} />,
                      danger: true,
                      disabled: b.is_default,
                      onSelect: () =>
                        ask({
                          title: t('admin.storage.deleteTitle'),
                          message: t('admin.storage.deleteMessage', { name: b.name }),
                          confirmLabel: t('admin.storage.delete'),
                          run: async () => {
                            try {
                              await api.deleteBackend(b.id);
                              await refresh();
                            } catch (e) {
                              toast({ tone: 'error', message: errText(e, t('common.failed')) });
                              throw e;
                            }
                          },
                        }),
                    },
                  ]}
                  trigger={
                    <IconButton label={t('admin.storage.actionsFor', { name: b.name })}>
                      <MoreIcon size={17} />
                    </IconButton>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={t('admin.storage.quotaTitle')}
        description={t('admin.storage.quotaDescription')}
        footer={
          <Button
            variant="primary"
            size="sm"
            loading={quotaBusy}
            onClick={async () => {
              setQuotaBusy(true);
              await act(() => api.putQuotaSettings(gbToBytes(quotaGB)), t('admin.storage.quotaSaved'), false);
              setQuotaBusy(false);
            }}
          >
            {t('common.save')}
          </Button>
        }
      >
        <Field label={t('admin.storage.quotaLabel')} hint={t('admin.gbUnlimited')} className="max-w-xs">
          {({ id, describedBy }) => (
            <Input
              id={id}
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              aria-describedby={describedBy}
              placeholder={t('admin.users.unlimited')}
              value={quotaGB}
              onChange={(e) => setQuotaGB(e.target.value)}
            />
          )}
        </Field>
      </Section>

      <Section title={t('admin.storage.assignTitle')} description={t('admin.storage.assignDescription')}>
        <div className="mb-4 rounded-lg border border-line bg-inset/60 px-4 py-3">
          <Switch
            checked={copyOnAssign}
            onChange={setCopyOnAssign}
            label={t('admin.storage.copyExisting')}
            description={t('admin.storage.copyExistingHint')}
          />
        </div>
        <ul className="-mx-2 divide-y divide-line">
          {workspaces.map((ws) => (
            <li key={ws.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-2 py-2.5">
              <span className="min-w-0 flex-1 truncate text-base font-medium text-ink">{wsLabel(ws)}</span>
              <div className="flex items-center gap-2 max-sm:w-full">
                {migratingWs === ws.id && <Spinner size={15} className="text-faint" />}
                <Select
                  aria-label={t('admin.storage.backendFor', { name: wsLabel(ws) })}
                  value={ws.storage_backend_id || defaultId}
                  disabled={migratingWs === ws.id || !backends?.length}
                  className="sm:!w-60"
                  onChange={(e) => {
                    const id = e.target.value;
                    setMigratingWs(ws.id);
                    const tid = toast({
                      tone: 'info',
                      duration: 0,
                      message: copyOnAssign
                        ? t('admin.storage.migrating', { name: wsLabel(ws) })
                        : t('admin.storage.updating', { name: wsLabel(ws) }),
                    });
                    void api
                      .assignWorkspaceBackend(ws.id, id, copyOnAssign)
                      .then((res) => {
                        toast({
                          message: res.migrated
                            ? t('admin.storage.migrated', { copied: res.copied, total: res.total, name: wsLabel(ws) })
                            : t('admin.storage.assigned', { name: wsLabel(ws) }),
                        });
                        return refresh();
                      })
                      .catch((err) => toast({ tone: 'error', message: errText(err, t('common.failed')) }))
                      .finally(() => {
                        setMigratingWs('');
                        dismiss(tid);
                      });
                  }}
                >
                  {backends?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {adding && <AddBackendModal onClose={() => setAdding(false)} onAdded={() => void refresh()} />}
      {dialog}
    </div>
  );
}
