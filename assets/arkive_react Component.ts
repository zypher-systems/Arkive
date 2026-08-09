// src/components/ArkiveLogo.tsx
import React from 'react';

export const ArkiveLogo: React.FC<{ size?: number; className?: string }> = ({ size = 40, className = '' }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`select-none ${className}`}
    >
      <defs>
        <linearGradient id="arkive-orange-grad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FF5500" />
          <stop offset="50%" stopColor="#FF8800" />
          <stop offset="100%" stopColor="#FFC700" />
        </linearGradient>

        <filter id="orange-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      <rect width="100" height="100" rx="22" fill="#12141A" stroke="#262A36" strokeWidth="2"/>

      <path 
        d="M50,16 L80,72 L64,72 L50,44 L36,72 L20,72 Z" 
        fill="none" 
        stroke="url(#arkive-orange-grad)" 
        strokeWidth="4.5" 
        strokeLinejoin="round"
        filter="url(#orange-glow)"
      />

      <path 
        d="M50,30 L50,82 M38,60 L62,60" 
        fill="none" 
        stroke="url(#arkive-orange-grad)" 
        strokeWidth="3.5" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        opacity="0.9"
      />

      <circle cx="50" cy="22" r="3.5" fill="#FFC700" filter="url(#orange-glow)" />
    </svg>
  );
};