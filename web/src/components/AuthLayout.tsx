import type { ReactNode } from 'react';
import { ArkiveLogo, ArkiveWordmark } from './ArkiveLogo';
import { ThemeMenu } from './shell/TopBar';
import { useInstance, WEB_VERSION } from '../lib/instance';
import { useI18n } from '../i18n';

/**
 * Shell for signed-out screens (sign in, setup, reset, public links):
 * a calm canvas with the brand, a centered card and a small footer.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  width = 'max-w-[420px]',
  footer,
  bare = false,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: string;
  footer?: ReactNode;
  /** Render children without the card chrome. */
  bare?: boolean;
}) {
  const { t } = useI18n();
  const { info } = useInstance();
  return (
    <div className="relative flex min-h-full flex-col overflow-x-hidden bg-app">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_60%_60%_at_50%_0%,var(--accent-soft),transparent_70%)]"
      />
      <header className="relative flex h-16 items-center justify-between px-4 sm:px-6">
        <a href="/" className="flex items-center gap-2.5 rounded-md text-ink">
          <ArkiveLogo size={28} className="text-primary" />
          <ArkiveWordmark className="text-[17px]" />
        </a>
        <ThemeMenu />
      </header>
      <main className="relative flex flex-1 items-start justify-center px-4 pt-6 pb-12 sm:items-center sm:pt-0">
        <div className={`animate-fade-up w-full ${width}`}>
          {(title || subtitle) && (
            <div className="mb-6 text-center">
              {title && <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>}
              {subtitle && <p className="mx-auto mt-2 max-w-sm text-base text-muted">{subtitle}</p>}
            </div>
          )}
          {bare ? children : <div className="panel p-6 shadow-sm sm:p-7">{children}</div>}
          {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
        </div>
      </main>
      <footer className="relative px-4 pb-6 text-center text-xs text-faint">
        {t('auth.footer', { version: info?.version || WEB_VERSION })}
      </footer>
    </div>
  );
}
