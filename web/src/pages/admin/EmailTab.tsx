import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useI18n } from '../../i18n';
import { useToast } from '../../components/Toast';
import { Badge, Section } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { Notice } from '../../components/ui/Notice';
import { Spinner } from '../../components/ui/Spinner';
import { errText } from './shared';

type Smtp = Awaited<ReturnType<typeof api.smtpSettings>>;

export function EmailTab() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [smtp, setSmtp] = useState<Smtp | null>(null);
  const [form, setForm] = useState({ host: '', port: '587', user: '', password: '', from: '' });
  const [busy, setBusy] = useState<'' | 'save' | 'clear'>('');
  const [error, setError] = useState('');

  function apply(s: Smtp) {
    setSmtp(s);
    setForm({ host: s.host || '', port: s.port || '587', user: s.user || '', password: '', from: s.from || '' });
  }

  useEffect(() => {
    api
      .smtpSettings()
      .then(apply)
      .catch((e) => {
        setError(errText(e, t('admin.loadFailed')));
        apply({ enabled: false, host: '', port: '587', user: '', from: '', has_password: false, source: 'none' });
      });
  }, [t]);

  const locked = smtp?.source === 'env';

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    setError('');
    try {
      apply(await api.saveSMTPSettings({ ...form, password: form.password || undefined }));
      toast({ message: t('admin.email.saved') });
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
      apply(await api.saveSMTPSettings({ clear: true }));
      toast({ message: t('admin.email.cleared') });
    } catch (err) {
      setError(errText(err, t('common.failed')));
    } finally {
      setBusy('');
    }
  }

  const field = (key: keyof typeof form, label: string, extra: Record<string, unknown> = {}) => (
    <Field label={label}>
      {({ id }) => (
        <Input
          id={id}
          disabled={locked}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          {...extra}
        />
      )}
    </Field>
  );

  return (
    <form onSubmit={save}>
      <Section
        title={t('admin.email.title')}
        description={t('admin.email.description')}
        actions={
          smtp && (
            <Badge tone={smtp.enabled ? 'ok' : 'neutral'}>
              {smtp.enabled ? t('admin.email.statusOn') : t('admin.email.statusOff')}
            </Badge>
          )
        }
        footer={
          <>
            {smtp && <span className="mr-auto text-xs text-muted">{t('admin.email.source', { source: smtp.source })}</span>}
            <Button variant="ghost" size="sm" disabled={locked || !!busy} loading={busy === 'clear'} onClick={() => void clear()}>
              {t('admin.email.clear')}
            </Button>
            <Button variant="primary" size="sm" type="submit" disabled={locked || !!busy} loading={busy === 'save'}>
              {t('admin.email.save')}
            </Button>
          </>
        }
      >
        {!smtp ? (
          <Spinner className="text-faint" />
        ) : (
          <div className="space-y-4">
            {locked && <Notice kind="info">{t('admin.email.envNotice')}</Notice>}
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              {field('host', t('admin.email.host'), { placeholder: 'smtp.example.com', autoComplete: 'off' })}
              {field('port', t('admin.email.port'), { inputMode: 'numeric' })}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {field('user', t('admin.email.user'), { autoComplete: 'off' })}
              {field('password', t('admin.email.password'), {
                type: 'password',
                autoComplete: 'new-password',
                placeholder: smtp.has_password ? t('admin.email.unchanged') : '',
              })}
            </div>
            {field('from', t('admin.email.from'), { type: 'email', placeholder: 'arkive@example.com' })}
            {error && <Notice kind="error">{error}</Notice>}
          </div>
        )}
      </Section>
    </form>
  );
}
