import { useI18n } from '../../i18n';
import { LOCALES, type LocaleCode } from '../../i18n/locales';
import { useTheme, type ThemePref } from '../../lib/theme';
import { Section } from '../../components/ui/Card';
import { Field, Select } from '../../components/ui/Input';
import { Segmented } from '../../components/ui/Segmented';
import { MonitorIcon, MoonIcon, SunIcon } from '../../components/icons';

export function PreferencesTab() {
  const { t, locale, setLocale } = useI18n();
  const { pref, setPref } = useTheme();

  return (
    <div className="space-y-6">
      <Section title={t('account.prefs.languageTitle')} description={t('account.prefs.languageDescription')}>
        <div className="max-w-sm">
          <Field label={t('account.prefs.language')} hint={t('account.prefs.translateHint')}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={locale}
                onChange={(e) => setLocale(e.target.value as LocaleCode)}
              >
                {LOCALES.map((l) => (
                  <option key={l.code} value={l.code} lang={l.code}>
                    {l.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Section>

      <Section title={t('account.prefs.themeTitle')} description={t('account.prefs.themeDescription')}>
        <Segmented<ThemePref>
          label={t('account.prefs.themeTitle')}
          value={pref}
          onChange={setPref}
          items={[
            { value: 'system', label: t('theme.system'), icon: <MonitorIcon size={15} /> },
            { value: 'light', label: t('theme.light'), icon: <SunIcon size={15} /> },
            { value: 'dark', label: t('theme.dark'), icon: <MoonIcon size={15} /> },
          ]}
        />
        <p className="mt-3 text-sm text-muted">{t('account.prefs.themeHint')}</p>
      </Section>
    </div>
  );
}
