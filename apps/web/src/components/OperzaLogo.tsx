interface OperzaLogoProps {
  size?: number;
  variant?: 'full' | 'mark' | 'icon';
  className?: string;
  isSuperAdmin?: boolean;
}

export function OperzaLogo({
  size = 32,
  variant = 'full',
  className = '',
  isSuperAdmin = false,
}: OperzaLogoProps) {
  const markSize = size;
  const gradientId = `operza-grad-${Math.random().toString(36).substring(2, 9)}`;
  const glowId = `operza-glow-${Math.random().toString(36).substring(2, 9)}`;

  // SVG Mark: Continuous Isometric Workflow Loop + Agency Aperture
  const mark = (
    <svg
      width={markSize}
      height={markSize}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', flexShrink: 0 }}
      aria-label="Operza Mark"
    >
      <defs>
        <linearGradient id={gradientId} x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF6D5A" />
          <stop offset="50%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#4F46E5" />
        </linearGradient>
        <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#FF6D5A" floodOpacity="0.3" />
        </filter>
      </defs>

      {/* Background Rounded Shield */}
      <rect width="40" height="40" rx="10" fill="#121722" stroke="rgba(255, 255, 255, 0.08)" strokeWidth="1" />

      {/* Interlocking Automation Nexus Nodes */}
      <g filter={`url(#${glowId})`}>
        {/* Outer Continuous Mobius Flow */}
        <path
          d="M12 20C12 15.5817 15.5817 12 20 12C24.4183 12 28 15.5817 28 20C28 24.4183 24.4183 28 20 28"
          stroke={`url(#${gradientId})`}
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        {/* Inner Synchronous Aperture Loop */}
        <circle cx="20" cy="20" r="3.2" fill="#FFFFFF" />
        {/* Orbital Node Points */}
        <circle cx="12" cy="20" r="2.2" fill="#FF6D5A" />
        <circle cx="28" cy="20" r="2.2" fill="#4F46E5" />
        <circle cx="20" cy="12" r="2.2" fill="#8B5CF6" />
      </g>
    </svg>
  );

  if (variant === 'mark' || variant === 'icon') {
    return (
      <div className={`operza-logo-mark ${className}`} style={{ display: 'inline-flex', alignItems: 'center' }}>
        {mark}
      </div>
    );
  }

  return (
    <div
      className={`operza-logo ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '10px',
        userSelect: 'none',
      }}
    >
      {mark}
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              fontSize: `${Math.max(15, size * 0.52)}px`,
              fontWeight: 750,
              letterSpacing: '-0.03em',
              color: 'var(--text)',
              fontFamily: 'var(--font)',
            }}
          >
            Operza
          </span>
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: '#FF6D5A',
              display: 'inline-block',
              boxShadow: '0 0 6px #FF6D5A',
            }}
          />
        </div>
        <span
          style={{
            fontSize: `${Math.max(10, size * 0.36)}px`,
            color: 'var(--text-3)',
            fontWeight: 500,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
          }}
        >
          {isSuperAdmin ? 'Platform Control' : 'Agency Workspace'}
        </span>
      </div>
    </div>
  );
}
