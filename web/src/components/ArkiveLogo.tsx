import type { FC } from 'react';

export const ArkiveLogo: FC<{ size?: number; className?: string; glow?: boolean }> = ({
  size = 40,
  className = '',
  glow = true,
}) => (
  <span
    className={`relative inline-flex select-none ${className}`}
    style={{ width: size, height: size }}
    aria-hidden
  >
    {glow && (
      <span
        className="absolute inset-0 animate-pulse-soft rounded-[26%] bg-gradient-to-br from-arkive-accent/45 to-arkive-accent2/35 blur-[10px]"
        aria-hidden
      />
    )}
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className="relative"
    >
      <defs>
        <linearGradient id={`ark-grad-${size}`} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="55%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
        <linearGradient id={`ark-tile-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#141731" />
          <stop offset="100%" stopColor="#080a15" />
        </linearGradient>
        <filter id={`ark-soft-${size}`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feComposite in="SourceGraphic" in2="b" operator="over" />
        </filter>
      </defs>
      <rect width="100" height="100" rx="24" fill={`url(#ark-tile-${size})`} />
      <rect
        x="1.5"
        y="1.5"
        width="97"
        height="97"
        rx="22.5"
        fill="none"
        stroke={`url(#ark-grad-${size})`}
        strokeOpacity="0.55"
        strokeWidth="3"
      />
      <path
        d="M50 20 L79 74 H63.5 L50 47.5 L36.5 74 H21 Z"
        fill="none"
        stroke={`url(#ark-grad-${size})`}
        strokeWidth="5"
        strokeLinejoin="round"
        filter={`url(#ark-soft-${size})`}
      />
      <path
        d="M41 62 H59"
        stroke={`url(#ark-grad-${size})`}
        strokeWidth="4.5"
        strokeLinecap="round"
        opacity="0.9"
      />
      <circle cx="50" cy="14.5" r="3.5" fill="#22d3ee" filter={`url(#ark-soft-${size})`}>
        <animate
          attributeName="opacity"
          values="1;0.45;1"
          dur="3s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  </span>
);

export const ArkiveWordmark: FC<{ className?: string }> = ({ className = '' }) => (
  <span className={`font-display font-bold tracking-tight ${className}`}>
    Ark<span className="text-iridescent">ive</span>
  </span>
);
