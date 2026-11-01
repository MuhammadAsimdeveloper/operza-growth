import { useId } from 'react';

interface MissMinutesAvatarProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  animated?: boolean;
}

export function MissMinutesAvatar({
  size = 32,
  className = '',
  style = {},
  animated = false
}: MissMinutesAvatarProps) {
  const uniqueId = useId().replace(/:/g, '');
  const bodyGradId = `mm-body-${uniqueId}`;
  const rimGradId = `mm-rim-${uniqueId}`;
  const scanlinesId = `mm-scanlines-${uniqueId}`;

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        position: 'relative',
        borderRadius: '50%',
        ...style
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={animated ? { animation: 'pulse 2s infinite ease-in-out' } : undefined}
      >
        <defs>
          {/* TVA Warm Orange Gradient */}
          <linearGradient id={bodyGradId} x1="15" y1="15" x2="85" y2="85" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFA028" />
            <stop offset="60%" stopColor="#FF7700" />
            <stop offset="100%" stopColor="#E65100" />
          </linearGradient>

          {/* Brass / Golden Rim */}
          <linearGradient id={rimGradId} x1="5" y1="5" x2="95" y2="95" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FDE68A" />
            <stop offset="40%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#B45309" />
          </linearGradient>

          {/* Hologram Scanlines Pattern */}
          <pattern id={scanlinesId} width="100" height="4" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="100" y2="0" stroke="rgba(0,0,0,0.07)" strokeWidth="1" />
          </pattern>
        </defs>

        {/* Golden Clock Casing Outer Rim */}
        <circle cx="50" cy="50" r="46" fill={`url(#${rimGradId})`} stroke="#78350F" strokeWidth="2.5" />

        {/* Clock Dial Face */}
        <circle cx="50" cy="50" r="41" fill={`url(#${bodyGradId})`} />

        {/* Subtle Vintage CRT Scanlines Overlay */}
        <circle cx="50" cy="50" r="41" fill={`url(#${scanlinesId})`} />

        {/* Clock Tick Hour Markers (12, 3, 6, 9) */}
        <rect x="48.5" y="13" width="3" height="5" rx="1.5" fill="#FFFBEB" />
        <rect x="48.5" y="82" width="3" height="5" rx="1.5" fill="#FFFBEB" />
        <rect x="82" y="48.5" width="5" height="3" rx="1.5" fill="#FFFBEB" />
        <rect x="13" y="48.5" width="5" height="3" rx="1.5" fill="#FFFBEB" />

        {/* Expressive Cartoon Eyes */}
        {/* Left Eye */}
        <ellipse cx="37" cy="42" rx="7.5" ry="10" fill="#FFFFFF" stroke="#451A03" strokeWidth="2.5" />
        <ellipse cx="38.5" cy="43" rx="4" ry="5.5" fill="#1C1917" />
        <circle cx="37" cy="40" r="2" fill="#FFFFFF" />

        {/* Right Eye */}
        <ellipse cx="63" cy="42" rx="7.5" ry="10" fill="#FFFFFF" stroke="#451A03" strokeWidth="2.5" />
        <ellipse cx="61.5" cy="43" rx="4" ry="5.5" fill="#1C1917" />
        <circle cx="60" cy="40" r="2" fill="#FFFFFF" />

        {/* Warm Rosy Cheeks */}
        <ellipse cx="26" cy="53" rx="4.5" ry="3" fill="#FF5252" opacity="0.6" />
        <ellipse cx="74" cy="53" rx="4.5" ry="3" fill="#FF5252" opacity="0.6" />

        {/* Miss Minutes Trademark Cheerful Smile */}
        <path
          d="M36 57C36 57 42 66 50 66C58 66 64 57 64 57"
          stroke="#451A03"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        {/* Sweet Tongue / Mouth Fill */}
        <path
          d="M44 64C46 66 54 66 56 64C54 68 46 68 44 64Z"
          fill="#EF4444"
        />

        {/* Vintage Clock Hands */}
        <line
          x1="50"
          y1="50"
          x2="32"
          y2="34"
          stroke="#451A03"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <line
          x1="50"
          y1="50"
          x2="66"
          y2="30"
          stroke="#451A03"
          strokeWidth="2.8"
          strokeLinecap="round"
        />
        {/* Center Pivot Pin */}
        <circle cx="50" cy="50" r="3.5" fill="#FFFBEB" stroke="#451A03" strokeWidth="2" />

        {/* Cute Eyebrows */}
        <path d="M30 30C34 27 40 28 42 30" stroke="#451A03" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M58 30C60 28 66 27 70 30" stroke="#451A03" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}
