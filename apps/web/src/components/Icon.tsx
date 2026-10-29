import type { ReactNode, SVGProps } from 'react';

const paths: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  message: <path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-5A8 8 0 1 1 21 12Z" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5.6M17.5 20a5.4 5.4 0 0 0-2.2-4.3" />
    </>
  ),
  kanban: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="10" y="4" width="5" height="10" rx="1.5" />
      <rect x="17" y="4" width="4" height="13" rx="1.5" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5Z" />
      <path d="M3 9h18M16 13h2" />
    </>
  ),
  megaphone: (
    <>
      <path d="M4 10v4a1 1 0 0 0 1 1h2l9 4V5L7 9H5a1 1 0 0 0-1 1Z" />
      <path d="M19 8.5a4 4 0 0 1 0 7M8 15v3.5a1.5 1.5 0 0 0 3 0V16" />
    </>
  ),
  share: (
    <>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="17.5" cy="6" r="2.5" />
      <circle cx="17.5" cy="18" r="2.5" />
      <path d="m8.3 10.8 6.9-3.5M8.3 13.2l6.9 3.5" />
    </>
  ),
  funnel: <path d="M3 5h18l-7 8v6l-4 2v-8Z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h4" />
    </>
  ),
  survey: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h4" />
      <path d="m15.5 17.5 1 1 2-2.5" />
    </>
  ),
  zap: <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12Z" />,
  chart: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z" />
      <path d="M10.5 20a2 2 0 0 0 3 0" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-up': <path d="m6 15 6-6 6 6" />,
  'chevron-right': <path d="m9 6 6 6-6 6" />,
  'chevron-left': <path d="m15 6-6 6 6 6" />,
  'arrow-up': <path d="M12 19V5M6 11l6-6 6 6" />,
  'arrow-down': <path d="M12 5v14M6 13l6 6 6-6" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  star: <path d="m12 3.5 2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.9l6-.8Z" />,
  dots: (
    <>
      <circle cx="12" cy="5.5" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="12" cy="18.5" r="1.4" />
    </>
  ),
  send: <path d="M21 4 3 11l7 2.5L12.5 21Z" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  trash: (
    <>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  edit: <path d="M4 20h4L20 8l-4-4L4 16Z" />,
  tag: (
    <>
      <path d="M3 12V4h8l9 9-8 8Z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </>
  ),
  phone: <path d="M6 3h3l2 5-2.5 1.5a12 12 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4 5.2 2 2 0 0 1 6 3Z" />,
  sliders: <path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 4v6M8 14v6" />,
  dollar: <path d="M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 7s2.2 3.4 5 4 5 1.1 5 3.5-2.2 3.5-5 3.5-5-1.1-5-3" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.3l3.4 2" />
    </>
  ),
  link: <path d="M10 13a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L11.5 6M14 11a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.1-1.1" />,
  play: <path d="M7 4.5v15l13-7.5Z" />,
  pause: (
    <>
      <rect x="7" y="4" width="3.5" height="16" rx="1" />
      <rect x="13.5" y="4" width="3.5" height="16" rx="1" />
    </>
  ),
  building: (
    <>
      <rect x="4" y="3" width="12" height="18" rx="1.5" />
      <path d="M16 9h3a1 1 0 0 1 1 1v11M7.5 7h5M7.5 11h5M7.5 15h5M7.5 19h5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  logout: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  sparkles: <path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10" width="15" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  plug: <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0Zm6 9v4" />,
  webhook: (
    <>
      <circle cx="6" cy="17" r="3" />
      <circle cx="18" cy="17" r="3" />
      <circle cx="12" cy="6" r="3" />
      <path d="m8.5 14.5 2-4.5M15.5 14.5l-2-4.5M9 17h6" />
    </>
  ),
  wait: (
    <>
      <path d="M6 3h12M6 21h12" />
      <path d="M7 3c0 4 5 5 5 9s-5 5-5 9M17 3c0 4-5 5-5 9s5 5 5 9" />
    </>
  ),
  task: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  condition: <path d="M12 3v5m0 8v5M5 12h14M12 8l4 4-4 4-4-4Z" />,
  facebook: <path d="M14.5 8.5H17V5h-2.5A4.5 4.5 0 0 0 10 9.5V12H7.5v3.5H10V22h3.5v-6.5H16l.5-3.5H13.5V9.6c0-.7.4-1.1 1-1.1Z" />,
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17" cy="7" r="1" />
    </>
  ),
  linkedin: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M8 10v7M8 7.2v.1M12 17v-4a2 2 0 0 1 4 0v4" />
    </>
  ),
  whatsapp: (
    <>
      <path d="M20.5 11.6a8.5 8.5 0 0 1-12.6 7.5L3.5 20.5l1.4-4.3A8.5 8.5 0 1 1 20.5 11.6Z" />
      <path d="M9.1 8.3c.2-.5.5-.5.8-.4l.8 1.5c.1.2.1.4 0 .6l-.5.6c-.1.2-.1.4 0 .5.5.8 1.2 1.4 2 1.8.2.1.4.1.5 0l.6-.5c.2-.1.4-.2.6-.1l1.5.8c.2.1.3.3.2.5-.2.6-.8 1.2-1.6 1.2-1.2 0-3.1-.8-4.6-2.3S8 9.5 8.2 8.6c.1-.1.6-.3.9-.3Z" />
    </>
  ),
  tiktok: <path d="M14 4v9.5a3.5 3.5 0 1 1-3-3.4M14 4c.4 2.2 1.8 3.6 4 3.8" />,
  google: <path d="M20.5 12.2H12v3.4h4.9a4.4 4.4 0 0 1-4.9 3 4.9 4.9 0 0 1 0-9.8 4.5 4.5 0 0 1 3.1 1.2l2.4-2.4A8.2 8.2 0 1 0 12 20.5c4.7 0 8-3.3 8-8 0-.5 0-.9-.1-1.3Z" />,
  refresh: <path d="M20 11a8 8 0 0 0-14-4L4 9M4 5v4h4M4 13a8 8 0 0 0 14 4l2-2M20 19v-4h-4" />,
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M15 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1" />
    </>
  ),
  book: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Zm0 0V19M20 18v3H6.5" />,
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m4 18 5-5 4 4 3-3 4 4" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" />
    </>
  ),
  upload: <path d="M12 16V4m-4 4 4-4 4 4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />,
  download: <path d="M12 4v12m-4-4 4 4 4-4M4 20h16" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  'map-pin': (
    <>
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  qr: (
    <>
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1" />
      <path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 20.5h1M20.5 14h-1" />
    </>
  ),
  repeat: <path d="M4 9a5 5 0 0 1 5-5h9l-3-3m3 3-3 3M20 15a5 5 0 0 1-5 5H6l3 3m-3-3 3-3" />,
  store: (
    <>
      <path d="M4 9.5 5.5 4h13L20 9.5" />
      <path d="M4 9.5a2.2 2.2 0 0 0 4.4 0 2.2 2.2 0 0 0 4.4 0 2.2 2.2 0 0 0 4.4 0 2.2 2.2 0 0 0 2.8 1.6" />
      <path d="M5.5 12.5V20h13v-7.5M10 20v-4.5h4V20" />
    </>
  ),
  'credit-card': (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.2" />
      <path d="M3 10h18M7 14.5h4" />
    </>
  ),
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: string;
  size?: number;
}

export function Icon({ name, size = 18, strokeWidth = 1.8, ...rest }: IconProps) {
  const content = paths[name] ?? paths.sparkles;
  return (
    <svg
      className={`icon icon--${name} ${rest.className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {content}
    </svg>
  );
}
