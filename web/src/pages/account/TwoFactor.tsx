import { useEffect, useState, type FormEvent } from 'react';
import { api, isMissingEndpoint, type TwoFactorStatus } from '../../lib/api';
import { copyText, downloadBlob } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../i18n';
import { useToast } from '../../components/Toast';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge, Section } from '../../components/ui/Card';
import { Field, Input, Checkbox } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Notice } from '../../components/ui/Notice';
import { Spinner } from '../../components/ui/Spinner';
import { CheckIcon, CopyIcon, DownloadIcon, RefreshIcon, ShieldIcon } from '../../components/icons';
import { QrCode } from './QrCode';

function groupSecret(s: string) {
  return s.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}

/** 6-digit TOTP code field (big, letter-spaced, one-time-code autocomplete). */
export function CodeInput({
  id,
  value,
  onChange,
  allowRecovery = false,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  allowRecovery?: boolean;
  describedBy?: string;
}) {
  return (
    <Input
      id={id}
      value={value}
      aria-describedby={describedBy}
      onChange={(e) => onChange(allowRecovery ? e.target.value.trim() : e.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode={allowRecovery ? 'text' : 'numeric'}
      autoComplete="one-time-code"
      pattern={allowRecovery ? undefined : '[0-9]{6}'}
      maxLength={allowRecovery ? 32 : 6}
      placeholder={allowRecovery ? '123456' : '000000'}
      spellCheck={false}
      data-autofocus
      className="!h-12 text-center font-mono !text-xl tracking-[0.35em]"
    />
  );
}

/** Recovery codes grid with copy / download and an "I saved them" gate. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');
  return (
    <div className="space-y-4">
      <Notice kind="warning">{t('account.twofa.codesWarning')}</Notice>
      <ol className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-line bg-inset px-5 py-4 font-mono text-base tracking-wide text-ink">
        {codes.map((c) => (
          <li key={c} className="tabular-nums">
            {c}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={<CopyIcon size={14} />}
          onClick={() =>
            void copyText(text).then((ok) => ok && toast({ message: t('account.twofa.codesCopied') }))
          }
        >
          {t('account.twofa.copyAll')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={<DownloadIcon size={14} />}
          onClick={() =>
            downloadBlob(
              new Blob([`${t('account.twofa.codesFileHeader')}\n\n${text}\n`], { type: 'text/plain' }),
              'arkive-recovery-codes.txt',
            )
          }
        >
          {t('account.twofa.download')}
        </Button>
      </div>
      <label className="flex cursor-pointer items-center gap-2.5 text-base text-ink">
        <Checkbox checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        {t('account.twofa.savedCheck')}
      </label>
      <div className="flex justify-end">
        <Button variant="primary" disabled={!saved} onClick={onDone}>
          {t('account.twofa.done')}
        </Button>
      </div>
    </div>
  );
}

function StepDots({ step }: { step: number }) {
  const { t } = useI18n();
  return (
    <p className="mb-4 flex items-center gap-2 text-xs font-medium text-muted">
      {[1, 2, 3].map((s) => (
        <span
          key={s}
          aria-hidden
          className={`h-1.5 rounded-full transition-all ${s === step ? 'w-6 bg-accent' : s < step ? 'w-3 bg-accent/50' : 'w-3 bg-active'}`}
        />
      ))}
      <span className="ml-1">{t('account.twofa.step', { step, total: 3 })}</span>
    </p>
  );
}

function SetupDialog({ onClose, onEnabled }: { onClose: () => void; onEnabled: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [setup, setSetup] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .twoFactorSetup()
      .then(setSetup)
      .catch((e) => setError(e instanceof Error ? e.message : t('account.twofa.setupFailed')));
  }, [t]);

  async function enable(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.twoFactorEnable(code);
      setCodes(res.recovery_codes);
      setStep(3);
      onEnabled();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('account.twofa.invalidCode'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={step === 3 ? t('account.twofa.codesTitle') : t('account.twofa.setupTitle')}
      icon={<ShieldIcon size={17} />}
      onClose={() => {
        if (step === 3) toast({ message: t('account.twofa.enabledToast') });
        onClose();
      }}
      busy={busy}
      width="max-w-lg"
    >
      <StepDots step={step} />
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-base text-muted">{t('account.twofa.scanHint')}</p>
          {!setup && !error && (
            <div className="flex h-52 items-center justify-center">
              <Spinner className="text-faint" />
            </div>
          )}
          {setup && (
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <QrCode value={setup.otpauth_url} label={t('account.twofa.qrLabel')} />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm font-medium text-ink">{t('account.twofa.manualTitle')}</p>
                <p className="text-sm text-muted">{t('account.twofa.manualHint')}</p>
                <div className="flex items-start gap-1 rounded-lg border border-line bg-inset p-2.5">
                  <code className="min-w-0 flex-1 font-mono text-sm leading-relaxed break-words text-ink">
                    {groupSecret(setup.secret)}
                  </code>
                  <IconButton
                    size="sm"
                    label={t('account.twofa.copySecret')}
                    onClick={() =>
                      void copyText(setup.secret).then((ok) => ok && toast({ message: t('account.twofa.secretCopied') }))
                    }
                  >
                    <CopyIcon size={14} />
                  </IconButton>
                </div>
              </div>
            </div>
          )}
          {error && <Notice kind="error">{error}</Notice>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" disabled={!setup} onClick={() => setStep(2)}>
              {t('common.continue')}
            </Button>
          </div>
        </div>
      )}
      {step === 2 && (
        <form onSubmit={enable} className="space-y-4">
          <p className="text-base text-muted">{t('account.twofa.enterCodeHint')}</p>
          <Field label={t('account.twofa.codeLabel')} error={error || undefined}>
            {({ id, describedBy }) => <CodeInput id={id} value={code} onChange={setCode} describedBy={describedBy} />}
          </Field>
          <div className="flex justify-between gap-2 pt-1">
            <Button variant="ghost" onClick={() => setStep(1)}>
              {t('common.back')}
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={code.length !== 6}>
              {t('account.twofa.verify')}
            </Button>
          </div>
        </form>
      )}
      {step === 3 && (
        <RecoveryCodes
          codes={codes}
          onDone={() => {
            toast({ message: t('account.twofa.enabledToast') });
            onClose();
          }}
        />
      )}
    </Modal>
  );
}

function RegenerateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.twoFactorRegenerate(code);
      setCodes(res.recovery_codes);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('account.twofa.invalidCode'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('account.twofa.regenTitle')} icon={<RefreshIcon size={16} />} onClose={onClose} busy={busy} width="max-w-lg">
      {codes ? (
        <RecoveryCodes codes={codes} onDone={onClose} />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-base text-muted">{t('account.twofa.regenHint')}</p>
          <Field label={t('account.twofa.codeLabel')} error={error || undefined}>
            {({ id, describedBy }) => <CodeInput id={id} value={code} onChange={setCode} describedBy={describedBy} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={code.length !== 6}>
              {t('account.twofa.regenerate')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function DisableDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.twoFactorDisable(password, code);
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('account.twofa.disableFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('account.twofa.disableTitle')} icon={<ShieldIcon size={17} />} tone="danger" onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-base text-muted">{t('account.twofa.disableHint')}</p>
        <Field label={t('account.twofa.password')}>
          {({ id }) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-autofocus
            />
          )}
        </Field>
        <Field label={t('account.twofa.codeOrRecovery')}>
          {({ id }) => (
            <Input
              id={id}
              value={code}
              onChange={(e) => setCode(e.target.value.trim())}
              autoComplete="one-time-code"
              spellCheck={false}
              className="font-mono tracking-wider"
            />
          )}
        </Field>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="danger-solid" loading={busy} disabled={!password || !code}>
            {t('account.twofa.disable')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Two-factor card on the Security tab. Hidden when the server has no 2FA API. */
export function TwoFactorCard() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { refresh } = useAuth();
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'setup' | 'regen' | 'disable' | null>(null);

  async function load() {
    try {
      setStatus(await api.twoFactorStatus());
      setError('');
    } catch (e) {
      if (isMissingEndpoint(e)) setMissing(true);
      else setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (missing) return null;

  const enabled = !!status?.enabled;
  const remaining = status?.recovery_codes_remaining ?? 0;

  return (
    <>
      <Section
        id="twofa"
        title={
          <span className="flex items-center gap-2.5">
            {t('account.twofa.title')}
            {status &&
              (enabled ? (
                <Badge tone="ok" icon={<CheckIcon size={10} />}>
                  {t('account.twofa.on')}
                </Badge>
              ) : (
                <Badge>{t('account.twofa.off')}</Badge>
              ))}
          </span>
        }
        description={t('account.twofa.description')}
        footer={
          status ? (
            enabled ? (
              <>
                <Button variant="danger" onClick={() => setDialog('disable')}>
                  {t('account.twofa.disable')}
                </Button>
                <Button variant="secondary" icon={<RefreshIcon size={14} />} onClick={() => setDialog('regen')}>
                  {t('account.twofa.regenerate')}
                </Button>
              </>
            ) : (
              <Button variant="primary" icon={<ShieldIcon size={15} />} onClick={() => setDialog('setup')}>
                {t('account.twofa.setUp')}
              </Button>
            )
          ) : undefined
        }
      >
        {!status && !error && (
          <div className="flex justify-center py-4">
            <Spinner className="text-faint" />
          </div>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        {status && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  enabled ? 'bg-ok-soft text-ok' : 'bg-inset text-faint ring-1 ring-line'
                }`}
              >
                <ShieldIcon size={19} />
              </span>
              <div className="min-w-0">
                <p className="text-base font-medium text-ink">
                  {enabled ? t('account.twofa.enabledLead') : t('account.twofa.disabledLead')}
                </p>
                <p className="text-sm text-muted">
                  {enabled
                    ? t('account.twofa.remaining', { count: remaining })
                    : t('account.twofa.disabledHint')}
                </p>
              </div>
            </div>
            {enabled && remaining <= 3 && (
              <Notice kind="warning">
                {t('account.twofa.lowCodes', { count: remaining })}
              </Notice>
            )}
            {enabled && (
              <Notice kind="info">{t('account.twofa.webdavNote')}</Notice>
            )}
          </div>
        )}
      </Section>
      {dialog === 'setup' && (
        <SetupDialog
          onClose={() => {
            setDialog(null);
            void load();
          }}
          onEnabled={() => {
            void refresh();
            void load();
          }}
        />
      )}
      {dialog === 'regen' && (
        <RegenerateDialog
          onClose={() => setDialog(null)}
          onDone={() => {
            void load();
            toast({ message: t('account.twofa.regenerated') });
          }}
        />
      )}
      {dialog === 'disable' && (
        <DisableDialog
          onClose={() => setDialog(null)}
          onDone={() => {
            toast({ message: t('account.twofa.disabledToast') });
            void refresh();
            void load();
          }}
        />
      )}
    </>
  );
}
