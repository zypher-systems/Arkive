import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { PageHeader } from '../components/ui/PageHeader';
import { TabNav } from '../components/ui/Tabs';
import { CloudIcon, KeyIcon, SettingsIcon, ShieldIcon, UserIcon } from '../components/icons';
import { ProfileTab } from './account/ProfileTab';
import { SecurityTab } from './account/SecurityTab';
import { PreferencesTab } from './account/PreferencesTab';
import { ConnectionsTab } from './account/ConnectionsTab';
import { WebdavTab } from './account/WebdavTab';

const TABS = ['profile', 'security', 'preferences', 'connections', 'webdav'] as const;
type Tab = (typeof TABS)[number];

export default function AccountPage() {
  const { t } = useI18n();
  const { tab } = useParams();
  const [params] = useSearchParams();

  // Google Drive OAuth returns to /account?gdrive=… — show it on the Connections tab.
  if (!tab && (params.get('gdrive') || params.get('error')?.startsWith('gdrive'))) {
    return <Navigate to={`/account/connections?${params}`} replace />;
  }
  if (!tab || !(TABS as readonly string[]).includes(tab)) return <Navigate to="/account/profile" replace />;
  const current = tab as Tab;

  const items = [
    { to: '/account/profile', label: t('account.tabs.profile'), icon: <UserIcon size={15} /> },
    { to: '/account/security', label: t('account.tabs.security'), icon: <ShieldIcon size={15} /> },
    { to: '/account/preferences', label: t('account.tabs.preferences'), icon: <SettingsIcon size={15} /> },
    { to: '/account/connections', label: t('account.tabs.connections'), icon: <CloudIcon size={15} /> },
    { to: '/account/webdav', label: t('account.tabs.webdav'), icon: <KeyIcon size={15} /> },
  ];

  return (
    <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 pb-24 lg:px-6 lg:pb-8">
      <div className="max-w-3xl">
        <PageHeader title={t('account.title')} subtitle={t('account.subtitle')} />
        <TabNav items={items} label={t('account.tabs.label')} className="mb-6" />
        {current === 'profile' && <ProfileTab />}
        {current === 'security' && <SecurityTab />}
        {current === 'preferences' && <PreferencesTab />}
        {current === 'connections' && <ConnectionsTab />}
        {current === 'webdav' && <WebdavTab />}
      </div>
    </div>
  );
}
