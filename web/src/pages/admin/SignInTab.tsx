import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useInstance } from '../../lib/instance';
import { useI18n } from '../../i18n';
import { useToast } from '../../components/Toast';
import { Badge, InfoRow, Section } from '../../components/ui/Card';
import { Switch } from '../../components/ui/Input';
import { Notice } from '../../components/ui/Notice';
import { Spinner } from '../../components/ui/Spinner';
import { errText } from './shared';

export function SignInTab() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { info, refresh: refreshInstance } = useInstance();
  const [open, setOpen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [oidc, setOidc] = useState<{ enabled: boolean; provider_name: string } | null>(info?.oidc ?? null);

  useEffect(() => {
    api
      .registrationSettings()
      .then((r) => setOpen(r.registration_open))
      .catch(() => setOpen(info?.registration_open ?? true));
    if (!info?.oidc) {
      api
        .oidcEnabled()
        .then(setOidc)
        .catch(() => setOidc({ enabled: false, provider_name: '' }));
    }
  }, [info]);

  async function toggle(v: boolean) {
    setBusy(true);
    setOpen(v);
    try {
      await api.putRegistrationSettings(v);
      toast({ message: v ? t('admin.signIn.opened') : t('admin.signIn.closed') });
      void refreshInstance();
    } catch (e) {
      setOpen(!v);
      toast({ tone: 'error', message: errText(e, t('common.failed')) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section title={t('admin.signIn.registrationTitle')} description={t('admin.signIn.registrationDescription')}>
        {open === null ? (
          <Spinner className="text-faint" />
        ) : (
          <Switch
            checked={open}
            disabled={busy}
            onChange={(v) => void toggle(v)}
            label={t('admin.signIn.open')}
            description={t('admin.signIn.openHint')}
          />
        )}
      </Section>

      <Section title={t('admin.signIn.oidcTitle')} description={t('admin.signIn.oidcDescription')}>
        {oidc === null ? (
          <Spinner className="text-faint" />
        ) : (
          <>
            <dl className="max-w-md divide-y divide-line">
              <InfoRow label={t('admin.signIn.status')}>
                {oidc.enabled ? (
                  <Badge tone="ok">{t('admin.signIn.enabled')}</Badge>
                ) : (
                  <Badge>{t('admin.signIn.disabled')}</Badge>
                )}
              </InfoRow>
              {oidc.enabled && <InfoRow label={t('admin.signIn.provider')}>{oidc.provider_name || '—'}</InfoRow>}
            </dl>
            {!oidc.enabled && (
              <Notice kind="info" className="mt-4">
                {t('admin.signIn.oidcHint')}
              </Notice>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
