import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, isMissingEndpoint, type InstanceInfo } from './api';

/** Web bundle version (from package.json via Vite define). */
export const WEB_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/**
 * Loads public instance capabilities. Prefers the aggregate
 * `GET /api/instance` (contract §6) and falls back to the older individual
 * endpoints when the server predates it.
 */
export async function loadInstance(): Promise<InstanceInfo> {
  try {
    return await api.instance();
  } catch (e) {
    if (!isMissingEndpoint(e)) throw e;
  }
  const [oidc, reg, gdrive, setup] = await Promise.all([
    api.oidcEnabled().catch(() => ({ enabled: false, provider_name: 'SSO' })),
    api.registrationOpen().catch(() => ({ open: true })),
    api.googleDriveEnabled().catch(() => ({ enabled: false })),
    api.setupStatus().catch(() => ({ needed: false })),
  ]);
  return {
    oidc,
    registration_open: reg.open,
    google_drive_enabled: gdrive.enabled,
    setup_needed: setup.needed,
  };
}

type InstanceState = {
  info: InstanceInfo | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const InstanceContext = createContext<InstanceState | null>(null);

export function InstanceProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<InstanceInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setInfo(await loadInstance());
    } catch {
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <InstanceContext.Provider value={{ info, loading, refresh }}>{children}</InstanceContext.Provider>;
}

export function useInstance() {
  const ctx = useContext(InstanceContext);
  if (!ctx) throw new Error('useInstance outside provider');
  return ctx;
}
