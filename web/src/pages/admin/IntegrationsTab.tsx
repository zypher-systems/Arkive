import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useI18n } from '../../i18n';
import { useInstance } from '../../lib/instance';
import { useToast } from '../../components/Toast';
import { Badge, Section } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { Notice } from '../../components/ui/Notice';
import { Spinner } from '../../components/ui/Spinner';
import { errText } from './shared';

type Google = Awaited<ReturnType<typeof api.googleSettings>>;

export function IntegrationsTab() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { refresh: refreshInstance } = useInstance();
  const [g, setG] = useState<Google | null>(null);
  const [form, setForm] = useState({ client_id: '', client_secret: '', redirect_url: '' });
  const [busy, setBusy] = useState<'' | 'save' | 'clear'>('');
  const [error, setError] = useState('');

  function apply(s: Google) {
    setG(s);
    setForm({ client_id: s.client_id || '', client_secret: '', redirect_url: s.redirect_url || '' });
  }

  useEffect(() => {
    api
      .googleSettings()
      .then(apply)
      .catch((e) => {
        setError(errText(e, t('admin.loadFailed')));
        apply({ enabled: false, client_id: '', has_secret: false, redirect_url: '', source: 'none' });
      });
  }, [t]);

  const locked = g?.source === 'env';
  const redirect = form.redirect_url || `${window.location.origin}/api/auth/google/drive/callback`;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    setError('');
    try {
      apply(
        await api.saveGoogleSettings({
          client_id: form.client_id,
          client_secret: form.client_secret || undefined,
          redirect_url: form.redirect_url,
        }),
      );
      toast({ message: t('admin.integrations.saved') });
      void refreshInstance();
    } catch (err) {
      setError(errText(err, t('common.failed')));
    } finally {
      setBusy('');
    }
  }

  async function clear() {
    setBusy('clear');
    setError('');
    try {
      apply(await api.saveGoogleSettings({ clear: true }));
      toast({ message: t('admin.integrations.cleared') });
      void refreshInstance();
    } catch (err) {
      setError(errText(err, t('common.failed')));
    } finally {
      setBusy('');
    }
  }

  return (
    <form onSubmit={save}>
      <Section
        title={t('admin.integrations.driveTitle')}
        description={t('admin.integrations.driveDescription')}
        actions={
          g && (
            <Badge tone={g.enabled ? 'ok' : 'neutral'}>
              {g.enabled ? t('admin.integrations.statusOn') : t('admin.integrations.statusOff')}
            </Badge>
          )
        }
        footer={
          <>
            {g && <span className="mr-auto text-xs text-muted">{t('admin.integrations.source', { source: g.source })}</span>}
            <Button variant="ghost" size="sm" disabled={locked || !!busy} loading={busy === 'clear'} onClick={() => void clear()}>
              {t('admin.integrations.clear')}
            </Button>
            <Button variant="primary" size="sm" type="submit" disabled={locked || !!busy} loading={busy === 'save'}>
              {t('admin.integrations.save')}
            </Button>
          </>
        }
      >
        {!g ? (
          <Spinner className="text-faint" />
        ) : (
          <div className="space-y-4">
            {locked && <Notice kind="info">{t('admin.integrations.envNotice')}</Notice>}
            <Field label={t('admin.integrations.clientId')}>
              {({ id }) => (
                <Input
                  id={id}
                  disabled={locked}
                  className="font-mono text-sm"
                  autoComplete="off"
                  value={form.client_id}
                  onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('admin.integrations.clientSecret')}>
              {({ id }) => (
                <Input
                  id={id}
                  type="password"
                  disabled={locked}
                  className="font-mono text-sm"
                  autoComplete="new-password"
                  placeholder={g.has_secret ? t('admin.integrations.unchanged') : ''}
                  value={form.client_secret}
                  onChange={(e) => setForm({ ...form, client_secret: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('admin.integrations.redirectUrl')} hint={t('admin.integrations.redirectHint', { uri: redirect })}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  disabled={locked}
                  className="font-mono text-sm"
                  aria-describedby={describedBy}
                  placeholder={`${window.location.origin}/api/auth/google/drive/callback`}
                  value={form.redirect_url}
                  onChange={(e) => setForm({ ...form, redirect_url: e.target.value })}
                />
              )}
            </Field>
            {error && <Notice kind="error">{error}</Notice>}
          </div>
        )}
      </Section>
    </form>
  );
}
