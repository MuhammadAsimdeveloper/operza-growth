import { useState, useEffect } from 'react';
import { Icon } from './Icon';

interface TourStep {
  badge: string;
  title: string;
  description: string;
  icon: string;
  highlights: string[];
  ctaUrl?: string;
  ctaText?: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    badge: 'ALL-IN-ONE BUSINESS OS',
    title: 'Welcome to Operza — Your Business Operating System',
    description:
      'Operza unifies your entire business technology stack into one cohesive, cloud-native platform. Say goodbye to paying for 10 separate disconnected tools.',
    icon: 'layout',
    highlights: [
      'Replaces HubSpot, GoHighLevel, n8n, WordPress, and Twilio in one workspace',
      'True multi-tenancy with sub-account locations and snapshot duplication',
      'Deep AI Copilot Swarm assistance contextually embedded across every screen',
    ],
    ctaUrl: '/command-center',
    ctaText: 'Explore Cockpit',
  },
  {
    badge: 'EXECUTIVE NAVIGATION',
    title: 'Command Center & Global Ctrl + K Palette',
    description:
      'Monitor real-time business telemetry and jump anywhere in milliseconds using the universal keyboard command palette.',
    icon: 'terminal',
    highlights: [
      'Press Ctrl + K (or Cmd + K on Mac) anywhere to open instant search across 50+ apps',
      'Live KPI telemetry tracking pipeline value, active deals, and webhook throughput',
      'Quick action shortcuts to add contacts, launch softphone, or create workflows',
    ],
    ctaUrl: '/command-center',
    ctaText: 'Open Command Center',
  },
  {
    badge: 'GHL-GRADE CRM',
    title: 'Contact 360 & Pipeline Opportunity Management',
    description:
      'Complete contact timelines with omnichannel communications, stage-based kanban pipelines, and GoHighLevel-grade quick actions.',
    icon: 'users',
    highlights: [
      'Quick-Action bar on contact profile: 1-click Direct SMS, Rich Email, and Softphone Calling',
      'Smart Lists with compound filtering by tags, stage, source, and activity',
      'Automated opportunity value tracking and stale deal alerts',
    ],
    ctaUrl: '/contacts',
    ctaText: 'View Contacts',
  },
  {
    badge: 'N8N-GRADE AUTOMATION',
    title: 'Visual 2D Nodal Workflows & Execution Inspector',
    description:
      'Design, inspect, and dry-run complex multi-step automations on an infinite 2D canvas with live step execution telemetry.',
    icon: 'zap',
    highlights: [
      'Full 2D node graph with smooth cubic bezier curves and live pulse particles',
      'Step Execution Inspector drawer: inspect Input JSON, Output JSON, and latency (ms)',
      'Rich node palette: Triggers, Logic (If/Else, Switch, Loop), AI Agents, and HTTP Requests',
    ],
    ctaUrl: '/workflows',
    ctaText: 'Open Visual Workflows',
  },
  {
    badge: 'TRUE HOSTING & CMS',
    title: 'Multi-Page Sites, Custom Domains & Static Exports',
    description:
      'Build WordPress & GHL-grade responsive websites with live DNS verification and 1-click static export packs for true cloud hosting.',
    icon: 'globe',
    highlights: [
      'Live DNS record checker (A record, CNAME, and TXT verification challenge)',
      '1-Click "Download Static Hosting Bundle (ZIP)" for Vercel, Netlify, Cloudflare Pages, or VPS',
      'Global navigation symbols (shared header/footer) and responsive mobile preview',
    ],
    ctaUrl: '/websites',
    ctaText: 'Manage Websites',
  },
  {
    badge: 'WEBRTC TELEPHONY',
    title: 'Browser Softphone & Carrier SIP Trunking',
    description:
      'Make and receive real telephone calls right from your browser with live microphone audio waveforms and carrier compliance.',
    icon: 'phone',
    highlights: [
      'Live WebRTC audio streaming with interactive real-time decibel volume visualizer',
      'Twilio Account SID / Auth Token and SIP Trunk carrier configuration',
      'Interactive DTMF dialpad with audible acoustic tones and call recording logs',
    ],
    ctaUrl: '/phone',
    ctaText: 'Open Softphone',
  },
];

export function OnboardingTour() {
  const [isOpen, setIsOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    // Check if user has already completed or skipped the tutorial
    const completed = localStorage.getItem('operza_tutorial_completed');
    if (!completed) {
      // Auto-open tutorial for new visitors
      const timer = setTimeout(() => {
        setIsOpen(true);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    // Listen for custom trigger to re-open the tour from header/settings
    const handleReopen = () => {
      setStepIndex(0);
      setIsOpen(true);
    };
    window.addEventListener('operza:open-tour', handleReopen);
    return () => window.removeEventListener('operza:open-tour', handleReopen);
  }, []);

  const handleClose = () => {
    localStorage.setItem('operza_tutorial_completed', 'true');
    setIsOpen(false);
  };

  const handleNext = () => {
    if (stepIndex < TOUR_STEPS.length - 1) {
      setStepIndex((prev) => prev + 1);
    } else {
      handleClose();
    }
  };

  const handlePrev = () => {
    if (stepIndex > 0) {
      setStepIndex((prev) => prev - 1);
    }
  };

  if (!isOpen) return null;

  const currentStep = TOUR_STEPS[stepIndex];

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal} role="dialog" aria-modal="true" aria-label="Operza Product Tour">
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.badgeRow}>
            <span style={styles.badge}>{currentStep.badge}</span>
            <span style={styles.stepCount}>
              Step {stepIndex + 1} of {TOUR_STEPS.length}
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            style={styles.skipBtn}
            title="Skip Tutorial"
          >
            <span>Skip Tutorial</span>
            <Icon name="x" size={14} />
          </button>
        </div>

        {/* Progress Bar */}
        <div style={styles.progressBarBg}>
          <div
            style={{
              ...styles.progressBarFill,
              width: `${((stepIndex + 1) / TOUR_STEPS.length) * 100}%`,
            }}
          />
        </div>

        {/* Body */}
        <div style={styles.body}>
          <div style={styles.iconCircle}>
            <Icon name={currentStep.icon} size={28} />
          </div>

          <h2 style={styles.title}>{currentStep.title}</h2>
          <p style={styles.description}>{currentStep.description}</p>

          {/* Highlights Card */}
          <div style={styles.highlightsCard}>
            <div style={styles.highlightsTitle}>Key Capabilities</div>
            <ul style={styles.highlightsList}>
              {currentStep.highlights.map((h, i) => (
                <li key={i} style={styles.highlightItem}>
                  <div style={styles.checkIcon}>
                    <Icon name="check" size={12} />
                  </div>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Footer Navigation */}
        <div style={styles.footer}>
          <div style={styles.dotsContainer}>
            {TOUR_STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setStepIndex(i)}
                style={{
                  ...styles.dot,
                  ...(i === stepIndex ? styles.dotActive : {}),
                }}
                aria-label={`Jump to step ${i + 1}`}
              />
            ))}
          </div>

          <div style={styles.actionsRow}>
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={handlePrev}
                className="btn btn--subtle"
                style={styles.navBtn}
              >
                <Icon name="arrow-left" size={13} /> Back
              </button>
            )}

            <button
              type="button"
              onClick={handleNext}
              className="btn btn--primary"
              style={styles.nextBtn}
            >
              {stepIndex === TOUR_STEPS.length - 1 ? (
                <>
                  <span>Get Started with Operza</span>
                  <Icon name="check" size={14} />
                </>
              ) : (
                <>
                  <span>Next Step</span>
                  <Icon name="arrow-right" size={14} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(5, 8, 15, 0.75)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    display: 'grid',
    placeItems: 'center',
    padding: 20,
    zIndex: 99999,
  },
  modal: {
    width: '100%',
    maxWidth: 580,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-xl, 16px)',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.45)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    animation: 'fade-in 0.25s ease-out',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 24px 14px',
    borderBottom: '1px solid var(--line)',
  },
  badgeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  badge: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: '0.06em',
    padding: '3px 8px',
    borderRadius: 6,
    background: 'rgba(99, 102, 241, 0.14)',
    color: '#818cf8',
    textTransform: 'uppercase',
  },
  stepCount: {
    fontSize: 12,
    color: 'var(--text-3)',
    fontWeight: 500,
  },
  skipBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'transparent',
    border: 'none',
    color: 'var(--text-3)',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
    padding: '5px 8px',
    borderRadius: 6,
    transition: 'color 0.15s',
  },
  progressBarBg: {
    width: '100%',
    height: 3,
    background: 'var(--surface-2)',
  },
  progressBarFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #4f46e5, #818cf8)',
    transition: 'width 0.25s ease',
  },
  body: {
    padding: '24px 28px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 14,
    background: 'linear-gradient(135deg, rgba(79, 70, 229, 0.15), rgba(129, 140, 248, 0.25))',
    color: '#6366f1',
    display: 'grid',
    placeItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: '-0.02em',
    color: 'var(--text)',
    lineHeight: 1.3,
    margin: 0,
  },
  description: {
    fontSize: 13.5,
    lineHeight: 1.6,
    color: 'var(--text-2)',
    margin: 0,
  },
  highlightsCard: {
    background: 'var(--surface-2)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  highlightsTitle: {
    fontSize: 11.5,
    fontWeight: 700,
    color: 'var(--text-3)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  highlightsList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  highlightItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: 'var(--text)',
  },
  checkIcon: {
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: 'rgba(16, 185, 129, 0.15)',
    color: '#10b981',
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 24px',
    borderTop: '1px solid var(--line)',
    background: 'var(--surface-2)',
  },
  dotsContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: 'var(--line-strong, #374151)',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  dotActive: {
    background: '#6366f1',
    width: 22,
    borderRadius: 4,
  },
  actionsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  navBtn: {
    padding: '8px 14px',
    fontSize: 12.5,
    fontWeight: 600,
  },
  nextBtn: {
    padding: '8px 18px',
    fontSize: 13,
    fontWeight: 700,
    background: '#4f46e5',
    color: '#fff',
    borderColor: '#4f46e5',
    boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  },
};
