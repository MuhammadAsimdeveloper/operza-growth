import { useState } from 'react';

interface MissMinutesRoboProps {
  onClick: () => void;
  pendingCount?: number;
  isStreaming?: boolean;
}

export function MissMinutesRobo({
  onClick,
  pendingCount = 0,
  isStreaming = false,
}: MissMinutesRoboProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label="Operza Copilot — Miss Minutes Autonomous Assistant"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* TVA Speech Bubble / Tooltip */}
      {isHovered && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            right: '0',
            marginBottom: '14px',
            backgroundColor: '#1E1B18',
            border: '1.5px solid #F59E0B',
            color: '#FEF3C7',
            padding: '8px 14px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            boxShadow: '0 10px 25px -3px rgba(245, 158, 11, 0.35)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            pointerEvents: 'none',
            zIndex: 10001,
            animation: 'fadeInUp 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <span style={{ fontSize: '14px' }}>⏰</span>
          <span>"Hey y'all! Need help managing Operza?"</span>
          <div
            style={{
              position: 'absolute',
              bottom: '-6px',
              right: '26px',
              width: '10px',
              height: '10px',
              backgroundColor: '#1E1B18',
              borderRight: '1.5px solid #F59E0B',
              borderBottom: '1.5px solid #F59E0B',
              transform: 'rotate(45deg)',
            }}
          />
        </div>
      )}

      {/* Outer Holographic Ambient Glow Aura */}
      <div
        style={{
          position: 'absolute',
          inset: -4,
          borderRadius: '50%',
          background: isStreaming
            ? 'radial-gradient(circle, rgba(239, 68, 68, 0.4) 0%, rgba(245, 158, 11, 0.2) 70%, transparent 100%)'
            : isHovered
            ? 'radial-gradient(circle, rgba(245, 158, 11, 0.45) 0%, rgba(217, 119, 6, 0.2) 70%, transparent 100%)'
            : 'radial-gradient(circle, rgba(245, 158, 11, 0.25) 0%, transparent 70%)',
          filter: 'blur(8px)',
          transition: 'all 0.3s ease',
          pointerEvents: 'none',
        }}
      />

      {/* Main TVA Robot Mascot Container with Floating Animation */}
      <div
        style={{
          width: '58px',
          height: '58px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          transform: isHovered ? 'scale(1.08) translateY(-4px)' : 'translateY(0)',
          transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
          boxShadow: isHovered
            ? '0 12px 28px rgba(245, 158, 11, 0.5), 0 0 15px rgba(255, 109, 90, 0.4)'
            : '0 8px 20px rgba(0, 0, 0, 0.45), 0 0 10px rgba(245, 158, 11, 0.3)',
        }}
      >
        {/* Miss Minutes Authentic Vector Illustration */}
        <svg
          width="58"
          height="58"
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* TVA Warm Orange Gradient */}
            <linearGradient id="tva-body-grad" x1="15" y1="15" x2="85" y2="85" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FFA028" />
              <stop offset="60%" stopColor="#FF7700" />
              <stop offset="100%" stopColor="#E65100" />
            </linearGradient>

            {/* Brass / Golden Rim */}
            <linearGradient id="tva-rim-grad" x1="5" y1="5" x2="95" y2="95" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FDE68A" />
              <stop offset="40%" stopColor="#F59E0B" />
              <stop offset="100%" stopColor="#B45309" />
            </linearGradient>

            {/* Hologram Scanlines Pattern */}
            <pattern id="tva-scanlines" width="100" height="4" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="100" y2="0" stroke="rgba(0,0,0,0.07)" strokeWidth="1" />
            </pattern>
          </defs>

          {/* Golden Clock Casing Outer Rim */}
          <circle cx="50" cy="50" r="46" fill="url(#tva-rim-grad)" stroke="#78350F" strokeWidth="2.5" />

          {/* Clock Dial Face */}
          <circle cx="50" cy="50" r="41" fill="url(#tva-body-grad)" />

          {/* Subtle Vintage CRT Scanlines Overlay */}
          <circle cx="50" cy="50" r="41" fill="url(#tva-scanlines)" />

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

          {/* Right Eye (Playful / slightly wider) */}
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

          {/* Vintage Clock Hands: Hour Hand & Minute Hand */}
          {/* Hour Hand (pointing toward 10 o'clock) */}
          <line
            x1="50"
            y1="50"
            x2="32"
            y2="34"
            stroke="#451A03"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          {/* Minute Hand (pointing toward 2 o'clock) */}
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

          {/* Cute Little Eyebrows */}
          <path d="M30 30C34 27 40 28 42 30" stroke="#451A03" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M58 30C60 28 66 27 70 30" stroke="#451A03" strokeWidth="2.5" strokeLinecap="round" />
        </svg>

        {/* Pending Approvals / Urgent Notification Counter Badge */}
        {pendingCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '-3px',
              right: '-3px',
              backgroundColor: '#EF4444',
              color: '#FFFFFF',
              borderRadius: '999px',
              padding: '2px 7px',
              fontSize: '11px',
              fontWeight: 750,
              boxShadow: '0 2px 6px rgba(239, 68, 68, 0.6)',
              border: '2px solid #1E293B',
              animation: 'pulse 1.8s infinite',
            }}
          >
            {pendingCount}
          </span>
        )}

        {/* Live Copilot Active Hologram Pulse Indicator */}
        <span
          style={{
            position: 'absolute',
            bottom: '0',
            right: '0',
            width: '12px',
            height: '12px',
            backgroundColor: isStreaming ? '#EF4444' : '#10B981',
            borderRadius: '50%',
            border: '2px solid #0F172A',
            boxShadow: isStreaming
              ? '0 0 8px #EF4444'
              : '0 0 8px #10B981',
          }}
        />
      </div>
    </div>
  );
}
