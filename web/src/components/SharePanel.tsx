import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type LinkMode, type Node, type PublicLink, type Share, type Workspace } from '../lib/api';
import { useConfirm } from '../lib/confirm';
import { copyText } from '../lib/hooks';
import { useI18n } from '../i18n';
import { useToast } from './Toast';
import { CheckIcon, CopyIcon, InboxIcon, LinkIcon, LockIcon, PlusIcon, TeamIcon, TrashIcon } from './icons';
import { Button, IconButton } from './ui/Button';
import { Avatar, Badge } from './ui/Card';
import { Field, Input, Select } from './ui/Input';
import { Modal } from './ui/Modal';
import { Notice } from './ui/Notice';
import { Segmented } from './ui/Segmented';
import { Spinner } from './ui/Spinner';

function linkUrl(l: PublicLink) {
  return `${window.location.origin}${l.url || `/s/${l.token}`}`;
}

function LinkCard({ link, onRevoke }: { link: PublicLink; onRevoke: () => void }) {
  const { t, formatDateTime } = useI18n();
  const [copied, setCopied] = useState(false);
  const upload = link.mode === 'upload';
  const expired = !!link.expires_at && new Date(link.expires_at).getTime() < Date.now();
  return (
    <li className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
            upload ? 'bg-info-soft text-info' : 'bg-accent-soft text-accent-strong'
          }`}
        >
          {upload ? <InboxIcon size={15} /> : <LinkIcon size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{upload ? t('share.uploadLink') : t('share.viewLink')}</p>
          <p className="truncate font-mono text-xs text-muted" title={linkUrl(link)}>
            {linkUrl(link).replace(/^https?:\/\//, '')}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {link.has_password && (
              <Badge icon={<LockIcon size={10} />}>{t('share.passwordBadge')}</Badge>
            )}
            {link.expires_at && (
              <Badge tone={expired ? 'danger' : 'neutral'}>
                {expired ? t('share.expired') : t('share.expires', { when: formatDateTime(link.expires_at) })}
              </Badge>
            )}
            {!upload &&
              (link.max_downloads != null ? (
                <Badge>{t('share.downloadsOf', { count: link.download_count ?? 0, max: link.max_downloads })}</Badge>
              ) : link.download_count ? (
                <Badge>{t('share.downloads', { count: link.download_count })}</Badge>
              ) : null)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            label={copied ? t('common.copied') : t('share.copyLink')}
            size="sm"
            onClick={() =>
              void copyText(linkUrl(link)).then((ok) => {
                if (!ok) return;
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? <CheckIcon size={15} className="text-ok" /> : <CopyIcon size={15} />}
          </IconButton>
          <IconButton label={t('share.revokeLink')} size="sm" className="hover:!bg-danger-soft hover:!text-danger" onClick={onRevoke}>
            <TrashIcon size={15} />
          </IconButton>
        </div>
      </div>
    </li>
  );
}

function NewLinkForm({
  node,
  onCreated,
  onCancel,
}: {
  node: Node;
  onCreated: (l: PublicLink) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const isFolder = node.kind === 'folder';
  const [mode, setMode] = useState<LinkMode>('view');
  const [password, setPassword] = useState('');
  const [expiry, setExpiry] = useState('');
  const [maxDownloads, setMaxDownloads] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const body: { password?: string; expires_at?: string | null; max_downloads?: number | null; mode?: LinkMode } = {};
    if (password) body.password = password;
    if (expiry) body.expires_at = new Date(expiry).toISOString();
    if (mode === 'view' && maxDownloads.trim()) {
      const n = Number(maxDownloads);
      if (!Number.isInteger(n) || n <= 0) {
        setError(t('share.maxDownloadsInvalid'));
        return;
      }
      body.max_downloads = n;
    }
    if (mode === 'upload') body.mode = 'upload';
    setBusy(true);
    try {
      const link = await api.createLink(node.id, body);
      // Older servers ignore `mode`: never leave a browsable link behind when the user asked for upload-only.
      if (mode === 'upload' && link.mode !== 'upload') {
        await api.deleteLink(link.id).catch(() => undefined);
        setError(t('share.uploadUnsupported'));
        return;
      }
      const ok = await copyText(linkUrl(link));
      toast({ message: ok ? t('share.linkCreatedCopied') : t('share.linkCreated') });
      onCreated(link);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('share.linkFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-line bg-inset/60 p-3.5">
      {isFolder && (
        <Segmented
          full
          size="sm"
          label={t('share.linkType')}
          value={mode}
          onChange={setMode}
          items={[
            { value: 'view', label: t('share.modeView'), icon: <LinkIcon size={13} /> },
            { value: 'upload', label: t('share.modeUpload'), icon: <InboxIcon size={13} /> },
          ]}
        />
      )}
      <p className="text-xs text-muted">{mode === 'upload' ? t('share.modeUploadHint') : t('share.modeViewHint')}</p>
      <Field label={t('share.password')} hint={t('share.optional')}>
        {({ id }) => (
          <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
      </Field>
      <div className={`grid gap-3 ${mode === 'view' ? 'sm:grid-cols-2' : ''}`}>
        <Field label={t('share.expiry')}>
          {({ id }) => <Input id={id} type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} />}
        </Field>
        {mode === 'view' && (
          <Field label={t('share.maxDownloads')}>
            {({ id }) => (
              <Input
                id={id}
                type="number"
                min={1}
                inputMode="numeric"
                placeholder={t('share.unlimited')}
                value={maxDownloads}
                onChange={(e) => setMaxDownloads(e.target.value)}
              />
            )}
          </Field>
        )}
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" variant="primary" type="submit" loading={busy} icon={<CopyIcon size={14} />}>
          {t('share.createAndCopy')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Sharing controls for one node: people & teams, and public links
 * (view links and — for folders — upload-only file requests).
 */
export function SharingSection({ node, workspaces }: { node: Node; workspaces: Workspace[] }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [shares, setShares] = useState<Share[] | null>(null);
  const [links, setLinks] = useState<PublicLink[] | null>(null);
  const [email, setEmail] = useState('');
  const [teamId, setTeamId] = useState('');
  const [permission, setPermission] = useState<'read' | 'write'>('read');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newLink, setNewLink] = useState(false);
  const { ask, dialog } = useConfirm();
  const teams = workspaces.filter((w) => w.type === 'team');

  const load = useCallback(async () => {
    const [s, l] = await Promise.all([api.shares(node.id), api.links(node.id)]);
    setShares(s);
    setLinks(l);
  }, [node.id]);

  useEffect(() => {
    setShares(null);
    setLinks(null);
    setNewLink(false);
    setError('');
    void load().catch((e) => setError(e instanceof Error ? e.message : t('share.loadFailed')));
  }, [load, t]);

  async function addShare(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (teamId) await api.createShare(node.id, { grantee_workspace_id: teamId, permission });
      else await api.createShare(node.id, { grantee_email: email.trim(), permission });
      setEmail('');
      setTeamId('');
      await load();
      toast({ message: t('share.added') });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('share.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="share-people">
        <h3 id="share-people" className="mb-2.5 text-sm font-semibold text-ink">
          {t('share.people')}
        </h3>
        <form onSubmit={addShare} className="space-y-2">
          <div className="flex gap-2">
            <Input
              type="email"
              value={email}
              disabled={!!teamId}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('share.emailPlaceholder')}
              aria-label={t('share.email')}
              className="min-w-0 flex-1"
            />
            <Select
              value={permission}
              onChange={(e) => setPermission(e.target.value as 'read' | 'write')}
              aria-label={t('share.permission')}
              className="!w-[7.5rem] shrink-0"
            >
              <option value="read">{t('share.canView')}</option>
              <option value="write">{t('share.canEdit')}</option>
            </Select>
          </div>
          {teams.length > 0 && (
            <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label={t('share.orTeam')}>
              <option value="">{t('share.orTeam')}</option>
              {teams.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </Select>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!email.trim() && !teamId} icon={<PlusIcon size={14} />}>
              {t('share.add')}
            </Button>
          </div>
        </form>
        <ul className="mt-3 divide-y divide-line">
          {shares === null && (
            <li className="flex justify-center py-4">
              <Spinner className="text-faint" />
            </li>
          )}
          {shares?.length === 0 && <li className="py-2 text-sm text-muted">{t('share.noPeople')}</li>}
          {shares?.map((s) => {
            const name = s.grantee_name || s.grantee_email || t('share.team');
            return (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                {s.grantee_workspace_id && !s.grantee_email ? (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-info-soft text-info">
                    <TeamIcon size={15} />
                  </span>
                ) : (
                  <Avatar name={name} size={32} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{name}</p>
                  <p className="truncate text-xs text-muted">{s.grantee_email || t('share.team')}</p>
                </div>
                <Badge tone={s.permission === 'write' ? 'accent' : 'neutral'}>
                  {s.permission === 'write' ? t('share.canEdit') : t('share.canView')}
                </Badge>
                <IconButton
                  label={t('share.revokeFor', { name })}
                  size="sm"
                  className="hover:!bg-danger-soft hover:!text-danger"
                  onClick={() =>
                    ask({
                      title: t('share.revokeTitle'),
                      message: t('share.revokeMessage', { name }),
                      confirmLabel: t('share.revoke'),
                      run: async () => {
                        try {
                          await api.deleteShare(s.id);
                          await load();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                          throw e;
                        }
                      },
                    })
                  }
                >
                  <TrashIcon size={14} />
                </IconButton>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="share-links">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <h3 id="share-links" className="text-sm font-semibold text-ink">
            {t('share.links')}
          </h3>
          {!newLink && (
            <Button size="sm" variant="secondary" icon={<PlusIcon size={14} />} onClick={() => setNewLink(true)}>
              {t('share.newLink')}
            </Button>
          )}
        </div>
        {newLink && (
          <div className="mb-3">
            <NewLinkForm
              node={node}
              onCancel={() => setNewLink(false)}
              onCreated={() => {
                setNewLink(false);
                void load();
              }}
            />
          </div>
        )}
        <ul className="space-y-2">
          {links === null && (
            <li className="flex justify-center py-4">
              <Spinner className="text-faint" />
            </li>
          )}
          {links?.length === 0 && !newLink && <li className="text-sm text-muted">{t('share.noLinks')}</li>}
          {links?.map((l) => (
            <LinkCard
              key={l.id}
              link={l}
              onRevoke={() =>
                ask({
                  title: t('share.revokeLinkTitle'),
                  message: t('share.revokeLinkMessage'),
                  confirmLabel: t('share.revoke'),
                  run: async () => {
                    try {
                      await api.deleteLink(l.id);
                      await load();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                      throw e;
                    }
                  },
                })
              }
            />
          ))}
        </ul>
      </section>

      {error && <Notice kind="error">{error}</Notice>}
      {dialog}
    </div>
  );
}

/** Modal wrapper for places without a details panel (search, recent). */
export function ShareDialog({ node, workspaces, onClose }: { node: Node; workspaces: Workspace[]; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Modal title={t('share.title', { name: node.name })} onClose={onClose} width="max-w-lg">
      <SharingSection node={node} workspaces={workspaces} />
    </Modal>
  );
}
