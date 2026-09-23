import { useCallback, useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { api, type User } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n';
import { PageHeader } from '../components/ui/PageHeader';
import { TabNav } from '../components/ui/Tabs';
import { CountBadge } from '../components/ui/Card';
import { Notice } from '../components/ui/Notice';
import {
  AdminIcon,
  DatabaseIcon,
  MailIcon,
  PlugIcon,
  ScrollIcon,
  SignInIcon,
  TeamIcon,
  WrenchIcon,
} from '../components/icons';
import { UsersTab } from './admin/UsersTab';
import { StorageTab } from './admin/StorageTab';
import { SignInTab } from './admin/SignInTab';
import { EmailTab } from './admin/EmailTab';
import { IntegrationsTab } from './admin/IntegrationsTab';
import { MaintenanceTab } from './admin/MaintenanceTab';
import { AuditTab } from './admin/AuditTab';
import { errText } from './admin/shared';

const TABS = ['users', 'storage', 'sign-in', 'email', 'integrations', 'maintenance', 'audit'] as const;
type Tab = (typeof TABS)[number];

export default function AdminPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { tab } = useParams();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState('');

  const refreshUsers = useCallback(async () => {
    try {
      setUsers(await api.adminUsers());
      setError('');
    } catch (e) {
      setUsers((u) => u ?? []);
      setError(errText(e, t('admin.loadFailed')));
    }
  }, [t]);

  useEffect(() => {
    if (user?.is_instance_admin) void refreshUsers();
  }, [user?.is_instance_admin, refreshUsers]);

  // On narrow screens the tab strip scrolls; keep the active tab visible.
  useEffect(() => {
    document
      .querySelector('#admin-tabs a[aria-current="page"]')
      ?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [tab]);

  if (!user?.is_instance_admin) return <Navigate to="/" replace />;
  if (tab && !(TABS as readonly string[]).includes(tab)) return <Navigate to="/admin" replace />;
  const current: Tab = (tab as Tab) || 'users';
  const pending = (users || []).filter((u) => u.status === 'pending').length;

  const items = [
    { to: '/admin/users', label: t('admin.tabs.users'), icon: <TeamIcon size={15} />, badge: <CountBadge count={pending} tone="accent" /> },
    { to: '/admin/storage', label: t('admin.tabs.storage'), icon: <DatabaseIcon size={15} /> },
    { to: '/admin/sign-in', label: t('admin.tabs.signIn'), icon: <SignInIcon size={15} /> },
    { to: '/admin/email', label: t('admin.tabs.email'), icon: <MailIcon size={15} /> },
    { to: '/admin/integrations', label: t('admin.tabs.integrations'), icon: <PlugIcon size={15} /> },
    { to: '/admin/maintenance', label: t('admin.tabs.maintenance'), icon: <WrenchIcon size={15} /> },
    { to: '/admin/audit', label: t('admin.tabs.audit'), icon: <ScrollIcon size={15} /> },
  ];
  // "/admin" (no tab) should highlight Users.
  if (!tab) items[0] = { ...items[0], to: '/admin' };

  return (
    <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 pb-24 lg:px-6 lg:pb-8">
      <div className="max-w-5xl">
        <PageHeader icon={<AdminIcon size={18} />} title={t('admin.title')} subtitle={t('admin.subtitle')} />
        <div id="admin-tabs">
          <TabNav items={items} label={t('admin.tabsLabel')} className="mb-6" />
        </div>
        {error && <Notice kind="error" className="mb-4">{error}</Notice>}
        {current === 'users' && <UsersTab users={users} me={user} refresh={refreshUsers} />}
        {current === 'storage' && <StorageTab />}
        {current === 'sign-in' && <SignInTab />}
        {current === 'email' && <EmailTab />}
        {current === 'integrations' && <IntegrationsTab />}
        {current === 'maintenance' && <MaintenanceTab />}
        {current === 'audit' && <AuditTab users={users || []} />}
      </div>
    </div>
  );
}
