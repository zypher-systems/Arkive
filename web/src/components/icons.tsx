import type { ReactNode } from 'react';

/**
 * Minimal monochrome stroke icon set. All icons inherit `currentColor`
 * and render at 14px by default. No fills, no gradients.
 */

type IconProps = {
  size?: number;
  className?: string;
};

function Icon({ size = 14, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function FolderIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M1.5 4.5c0-.8.7-1.5 1.5-1.5h2.6l1.2 1.5H13c.8 0 1.5.7 1.5 1.5v5c0 .8-.7 1.5-1.5 1.5H3c-.8 0-1.5-.7-1.5-1.5V4.5z" />
    </Icon>
  );
}

export function FolderOpenIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M2 4h4l1 1.2h7V6" />
      <path d="M1.5 6.5h13V12c0 .8-.7 1.5-1.5 1.5H3c-.8 0-1.5-.7-1.5-1.5V6.5z" />
    </Icon>
  );
}

export function FolderPlusIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M1.5 4.5c0-.8.7-1.5 1.5-1.5h2.6l1.2 1.5H11" />
      <path d="M1.5 6v4.5c0 .8.7 1.5 1.5 1.5h4" />
      <path d="M11.5 8v5M9 10.5h5" />
    </Icon>
  );
}

export function FolderMoveIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M1.5 4.5c0-.8.7-1.5 1.5-1.5h2.6l1.2 1.5H13c.8 0 1.5.7 1.5 1.5V7" />
      <path d="M1.5 6.5V10.5c0 .8.7 1.5 1.5 1.5h11c.8 0 1.5-.7 1.5-1.5V7" />
      <path d="M8 6v4.5M6 8.5l2 2 2-2" />
    </Icon>
  );
}

export function FolderCopyIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M1.5 4.5c0-.8.7-1.5 1.5-1.5h2.6l1.2 1.5H9" />
      <path d="M1.5 6v4.5c0 .8.7 1.5 1.5 1.5h3" />
      <rect x="8.5" y="8" width="6" height="6" rx="1" />
    </Icon>
  );
}

export function FilePlusIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M4 1.5h4.5L11 4v2.5" />
      <path d="M4 1.5v13h4" />
      <path d="M11.5 9v5M9 11.5h5" />
    </Icon>
  );
}

export function UploadIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M8 10.5v-7M5 6L8 3l3 3" />
      <path d="M2.5 11v1.5h11V11" />
    </Icon>
  );
}

export function DownloadIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M8 2.5v7M5 7l3 3 3-3" />
      <path d="M2.5 11v1.5h11V11" />
    </Icon>
  );
}

export function SearchIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3.5 3.5" />
    </Icon>
  );
}

export function TrashIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M2.5 4h11M6.5 4V2.5h3V4" />
      <path d="M4 4l.7 9.2c0 .4.4.8.8.8h5c.4 0 .8-.4.8-.8L12 4" />
      <path d="M6.8 7v4M9.2 7v4" />
    </Icon>
  );
}

export function ShareIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <circle cx="12" cy="3.2" r="1.7" />
      <circle cx="4" cy="8" r="1.7" />
      <circle cx="12" cy="12.8" r="1.7" />
      <path d="M5.4 7.1l5-2.7M5.4 8.9l5 2.7" />
    </Icon>
  );
}

export function HistoryIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M2.6 5.5A5.7 5.7 0 1 1 2.4 10" />
      <path d="M2.6 2.5v3h3" />
      <path d="M8 5v3.2l2.2 1.3" />
    </Icon>
  );
}

export function PencilIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M11.5 2.5l2 2L6 12l-2.7.7L4 10l7.5-7.5z" />
    </Icon>
  );
}

export function CloseIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icon>
  );
}

export function CheckIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M3 8.5l3.2 3.2L13 5" />
    </Icon>
  );
}

export function CheckCircleIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <circle cx="8" cy="8" r="6" />
      <path d="M5.5 8.2l1.8 1.8 3.2-3.8" />
    </Icon>
  );
}

export function ChevronRightIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M6 4l4 4-4 4" />
    </Icon>
  );
}

export function ArrowLeftIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M13.5 8h-10M6.5 4.5L3 8l3.5 3.5" />
    </Icon>
  );
}

export function ArrowUpIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M8 13.5v-10M4.5 6.5L8 3l3.5 3.5" />
    </Icon>
  );
}

export function HomeIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M2.5 7.5L8 3l5.5 4.5" />
      <path d="M4 7v6h8V7" />
    </Icon>
  );
}

export function ClockIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.2l2.2 1.3" />
    </Icon>
  );
}

export function TeamIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <circle cx="6" cy="5.5" r="2.5" />
      <path d="M1.5 13.5c.5-2.5 2.3-4 4.5-4s4 1.5 4.5 4" />
      <circle cx="11.8" cy="6" r="1.9" />
      <path d="M11.2 9.7c1.9.3 3.2 1.6 3.6 3.8" />
    </Icon>
  );
}

export function UserIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <circle cx="8" cy="5" r="2.8" />
      <path d="M2.8 13.8c.6-2.8 2.7-4.3 5.2-4.3s4.6 1.5 5.2 4.3" />
    </Icon>
  );
}

export function UserPlusIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <circle cx="6.2" cy="5" r="2.7" />
      <path d="M2 13.5c.5-2.6 2.1-4 4.2-4 1 0 1.9.3 2.7.9" />
      <path d="M12 8.5v5M9.5 11h5" />
    </Icon>
  );
}

export function UserMinusIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <circle cx="6.2" cy="5" r="2.7" />
      <path d="M2 13.5c.5-2.6 2.1-4 4.2-4 1 0 1.9.3 2.7.9" />
      <path d="M9.5 11.5h5" />
    </Icon>
  );
}

export function UserCheckIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <circle cx="6.2" cy="5" r="2.7" />
      <path d="M2 13.5c.5-2.6 2.1-4 4.2-4 1 0 1.9.3 2.7.9" />
      <path d="M9.3 11.2l1.6 1.6 2.9-3.3" />
    </Icon>
  );
}

export function AdminIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M8 1.8l4.5 1.7v3.3c0 3-2 5-4.5 6-2.5-1-4.5-3-4.5-6V3.5L8 1.8z" />
      <path d="M5.8 7.6l1.5 1.5 2.9-3.1" />
    </Icon>
  );
}

export function CloudIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M4.5 12.5h7a3 3 0 0 0 .6-5.9A4.2 4.2 0 0 0 4 7.3a2.8 2.8 0 0 0 .5 5.2z" />
    </Icon>
  );
}

export function KeyIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <circle cx="5.5" cy="8" r="2.5" />
      <path d="M8 8h6M12.5 8v2.5M14 8v1.8" />
    </Icon>
  );
}

export function MailIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <rect x="2" y="3.5" width="12" height="9" rx="1" />
      <path d="M2.5 4.5l5.5 4 5.5-4" />
    </Icon>
  );
}

export function DriveIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <rect x="2" y="4.5" width="12" height="7" rx="1" />
      <path d="M2 8h12" />
      <path d="M5 6.2h.01M12.5 10.2h.01" strokeWidth={2} />
    </Icon>
  );
}

export function LockIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <rect x="3.5" y="7" width="9" height="6" rx="1" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
    </Icon>
  );
}

export function LogoutIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M10 2.5h2.5v11H10" />
      <path d="M6 4.5L2.8 8 6 11.5M3 8h6" />
    </Icon>
  );
}

export function InfoIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.4V11" />
      <path d="M8 5.2v.01" strokeWidth={2} />
    </Icon>
  );
}

export function AlertIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.8v3.7" />
      <path d="M8 11v.01" strokeWidth={2} />
    </Icon>
  );
}

export function WarnIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M8 2.2L14.3 13.5H1.7L8 2.2z" />
      <path d="M8 6.5v3" />
      <path d="M8 11.5v.01" strokeWidth={2} />
    </Icon>
  );
}

export function ListViewIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M5.5 4h8M5.5 8h8M5.5 12h8" />
      <path d="M2.5 4h.01M2.5 8h.01M2.5 12h.01" strokeWidth={2} />
    </Icon>
  );
}

export function DetailsViewIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <path d="M2 6.2h12M2 9.8h12" />
    </Icon>
  );
}

export function TilesViewIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <path d="M8 2.5v11M2 8h12" />
    </Icon>
  );
}

export function CopyIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
      <path d="M10.5 5.5v-3h-8v8h3" />
    </Icon>
  );
}

export function PasteIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <rect x="3.5" y="4" width="9" height="9.5" rx="1" />
      <path d="M6 4V2.5h4V4" />
      <path d="M3.5 6.5h9" />
    </Icon>
  );
}

export function RestoreIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M3 3.5V7h3.5" />
      <path d="M3.4 7a5.3 5.3 0 1 1-.5 2.6" />
    </Icon>
  );
}

export function RefreshIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M13 3.5V7H9.5" />
      <path d="M12.6 7a5.3 5.3 0 1 0 .5 2.6" />
    </Icon>
  );
}

export function SendIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M14 2L7.5 8.5" />
      <path d="M14 2l-4.5 12-2-5.5L2 6.5 14 2z" />
    </Icon>
  );
}

export function StarIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M8 2l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1-3.1-2.9 4.2-.5L8 2z" />
    </Icon>
  );
}

export function ArchiveIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M2 3.5h12v3H2v-3z" />
      <path d="M3.5 6.5v6h9v-6" />
      <path d="M6.5 9.5h3" />
    </Icon>
  );
}

export function OpenIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M6.5 3.5h6v6" />
      <path d="M12.5 3.5L7.5 8.5" />
      <path d="M11 9.5v3h-8v-8h3" />
    </Icon>
  );
}

export function PreviewIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M1.8 8S3.5 4.5 8 4.5 14.2 8 14.2 8 12.5 11.5 8 11.5 1.8 8 1.8 8z" />
      <circle cx="8" cy="8" r="1.6" />
    </Icon>
  );
}

export function AudioIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M6 11.5V3.5l7-1.5v8.5" />
      <circle cx="4" cy="11.5" r="2" />
      <circle cx="11" cy="10.5" r="2" />
    </Icon>
  );
}

export function ConnectIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M6 2.5V6M10 2.5V6" />
      <path d="M4.5 6h7v2.5a3.5 3.5 0 0 1-7 0V6z" />
      <path d="M8 12v1.5" />
    </Icon>
  );
}

export function SpinnerIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M8 2.5a5.5 5.5 0 1 0 5.5 5.5" />
    </Icon>
  );
}

export function SunIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1" />
    </Icon>
  );
}

export function MoonIcon({ size, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M13.5 9.5A5 5 0 0 1 6.5 2.5a5 5 0 1 0 7 7z" />
    </Icon>
  );
}
