import { icons, type IconName } from '@finorchestrate/icons';

export type { IconName };

interface IconProps {
  name: IconName;
  size?: number;
  /** Give a label only when the icon is the sole content; decorative icons stay hidden from assistive tech. */
  label?: string;
  className?: string;
}

export function Icon({ name, size = 20, label, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      dangerouslySetInnerHTML={{ __html: icons[name] }}
    />
  );
}

/** Product mark: a voice signal leaving a guarded envelope. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="fo-logo-gradient" x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--color-voice-1)" />
          <stop offset="1" stopColor="var(--color-voice-2)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--color-ink)" />
      <circle cx="10" cy="22" r="2.6" fill="url(#fo-logo-gradient)" />
      <path d="M10 15.2a6.8 6.8 0 0 1 6.8 6.8" fill="none" stroke="url(#fo-logo-gradient)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M10 9a13 13 0 0 1 13 13" fill="none" stroke="url(#fo-logo-gradient)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
