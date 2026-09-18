import type { FC } from 'react';

/**
 * Flat brand mark: graphite tile with an amber archive-box "A".
 * No gradients, glows, or animation.
 */
export const ArkiveLogo: FC<{ size?: number; className?: string }> = ({
  size = 40,
  className = '',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 100 100"
    width={size}
    height={size}
    className={className}
    aria-hidden
    role="presentation"
  >
    <rect width="100" height="100" rx="14" fill="currentColor" className="ark-logo-tile" />
    <path
      d="M30 78V34.6L50 16l20 18.6V78h-9.5V44.4h-21V78H30z"
      fill="var(--logo-accent, #d99a2b)"
    />
    <rect x="39.5" y="58" width="21" height="4.6" rx="2.3" fill="currentColor" opacity="0.55" />
  </svg>
);

export const ArkiveWordmark: FC<{ className?: string }> = ({ className = '' }) => (
  <span className={`font-semibold tracking-tight ${className}`}>Arkive</span>
);
