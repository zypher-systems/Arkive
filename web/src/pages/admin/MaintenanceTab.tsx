import { useEffect, useState } from 'react';
import { api, isMissingEndpoint } from '../../lib/api';
import { useI18n } from '../../i18n';
import { useToast } from '../../components/Toast';
import { Section } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { Notice } from '../../components/ui/Notice';
import { RefreshIcon } from '../../components/icons';
import { errText } from './shared';

function wholeNumber(raw: string, max = Infinity): number | null {
  const n = Number(raw.trim());
  if (raw.trim() === '' || !Number.isInteger(n) || n < 0 || n > max) return null;
  return n;
}

export function MaintenanceTab() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [trashDays, setTrashDays] = useState('');
  const [trashErr, setTrashErr] = useState('');
  const [trashBusy, setTrashBusy] = useState(false);
  const [versions, setVersions] = useState('');
  const [versionsState, setVersionsState] = useState<'loading' | 'ok' | 'missing'>('loading');
  const [versionsErr, setVersionsErr] = useState('');
  const [versionsBusy, setVersionsBusy] = useState(false);
  const [reindexBusy, setReindexBusy] = useState(false);

  useEffect(() => {
    api
      .trashSettings()
      .then((r) => setTrashDays(String(r.trash_retention_days ?? 30)))
      .catch(() => setTrashDays('30'));
    api
      .versionSettings()
      .then((r) => {
        setVersions(String(r.max_versions));
        setVersionsState('ok');
      })
      .catch((e) => {
        if (isMissingEndpoint(e)) setVersionsState('missing');
        else {
          setVersionsState('ok');
          setVersionsErr(errText(e, t('admin.loadFailed')));
        }
      });
  }, [t]);

  async function saveTrash() {
    const n = wholeNumber(trashDays);
    if (n === null) {
      setTrashErr(t('admin.maintenance.trashInvalid'));
      return;
    }
    setTrashErr('');
    setTrashBusy(true);
    try {
      await api.putTrashSettings(n);
      toast({ message: t('admin.maintenance.trashSaved', { count: n }) });
    } catch (e) {
      setTrashErr(errText(e, t('common.failed')));
    } finally {
      setTrashBusy(false);
    }
  }

  async function saveVersions() {
    const n = wholeNumber(versions, 100);
    if (n === null) {
      setVersionsErr(t('admin.maintenance.versionsInvalid'));
      return;
    }
    setVersionsErr('');
    setVersionsBusy(true);
    try {
      const r = await api.putVersionSettings(n);
      setVersions(String(r.max_versions));
      toast({ message: t('admin.maintenance.versionsSaved', { count: r.max_versions }) });
    } catch (e) {
      setVersionsErr(errText(e, t('common.failed')));
    } finally {
      setVersionsBusy(false);
    }
  }

  async function reindex() {
    setReindexBusy(true);
    try {
      const r = await api.reindexSearch();
      toast({
        message:
          t('admin.maintenance.reindexed', { count: r.indexed }) +
          (r.remaining > 0 ? ` — ${t('admin.maintenance.reindexRemaining', { remaining: r.remaining })}` : ''),
      });
    } catch (e) {
      toast({ tone: 'error', message: errText(e, t('common.failed')) });
    } finally {
      setReindexBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section
        title={t('admin.maintenance.trashTitle')}
        description={t('admin.maintenance.trashDescription')}
        footer={
          <Button variant="primary" size="sm" loading={trashBusy} onClick={() => void saveTrash()}>
            {t('admin.maintenance.save')}
          </Button>
        }
      >
        <Field label={t('admin.maintenance.trashLabel')} error={trashErr || undefined} className="max-w-xs">
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="number"
              min={0}
              inputMode="numeric"
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              value={trashDays}
              onChange={(e) => setTrashDays(e.target.value)}
            />
          )}
        </Field>
      </Section>

      <Section
        title={t('admin.maintenance.versionsTitle')}
        description={t('admin.maintenance.versionsDescription')}
        footer={
          versionsState === 'ok' ? (
            <Button variant="primary" size="sm" loading={versionsBusy} onClick={() => void saveVersions()}>
              {t('admin.maintenance.save')}
            </Button>
          ) : undefined
        }
      >
        {versionsState === 'missing' ? (
          <Notice kind="info">{t('admin.newerServer')}</Notice>
        ) : (
          <Field label={t('admin.maintenance.versionsLabel')} error={versionsErr || undefined} className="max-w-xs">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                disabled={versionsState === 'loading'}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                value={versions}
                onChange={(e) => setVersions(e.target.value)}
              />
            )}
          </Field>
        )}
      </Section>

      <Section
        title={t('admin.maintenance.searchTitle')}
        description={t('admin.maintenance.searchDescription')}
        actions={
          <Button variant="secondary" size="sm" loading={reindexBusy} icon={<RefreshIcon size={14} />} onClick={() => void reindex()}>
            {t('admin.maintenance.reindex')}
          </Button>
        }
      />
    </div>
  );
}
