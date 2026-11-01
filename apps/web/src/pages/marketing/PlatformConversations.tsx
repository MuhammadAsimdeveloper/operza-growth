import { Link } from 'react-router-dom';
import { SEO } from '../../components/SEO';
import { buildBreadcrumbSchema, SCHEMA_SOFTWARE_APPLICATION } from '../../lib/schema';
import { trackEvent } from '../../lib/analytics';

export default function PlatformConversations() {
  const jsonLd = [
    SCHEMA_SOFTWARE_APPLICATION,
    buildBreadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'Platform', url: '/platform/crm' },
      { name: 'Omnichannel Inbox', url: '/platform/conversations' },
    ]),
  ];

  return (
    <>
      <SEO
        title="Omnichannel Communication Software & Unified Agency Inbox"
        description="Consolidate SMS, WhatsApp Cloud API, Email, and Meta Messenger into a single unified conversation stream with live WebSocket updates and AI Copilot assistance."
        canonical="/platform/conversations"
        keywords={[
          'omnichannel communication software',
          'SMS and WhatsApp CRM integration',
          'marketing agency CRM',
          'lead management software',
          'agency communication platform',
        ]}
        jsonLd={jsonLd}
      />

      <div style={styles.pageHeader}>
        <div style={styles.container}>
          <div style={styles.breadcrumbs}>
            <Link to="/" style={styles.breadLink}>Home</Link>
            <span>/</span>
            <span style={{ color: '#4f46e5' }}>Omnichannel Inbox</span>
          </div>

          <h1 style={styles.h1}>
            Unified Omnichannel Conversations &amp; Phone System
          </h1>
          <p style={styles.lead}>
            Communicate with leads and clients across SMS, WhatsApp Cloud API, Email, and Meta Messenger
            from one unified workspace. Equipped with real-time WebSockets, Twilio telephony, and AI reply copilot.
          </p>

          <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
            <Link
              to="/signup"
              style={styles.btnPrimary}
              onClick={() => trackEvent('signup_start', { source: 'conversations_page' })}
            >
              Start Free Trial →
            </Link>
            <Link to="/docs" style={styles.btnSecondary}>
              Read Telephony Docs
            </Link>
          </div>
        </div>
      </div>

      <section style={styles.section}>
        <div style={styles.container}>
          <div style={styles.grid2}>
            <div>
              <span style={styles.featureBadge}>CENTRALIZED CHANNELS</span>
              <h2 style={styles.h2}>Four Messaging Networks, One Single Stream</h2>
              <p style={styles.paragraph}>
                Stop switching between browser tabs and individual phone apps. Operza ingests messages
                from all major communication networks directly into the contact’s CRM timeline.
              </p>
              <ul style={styles.list}>
                <li>Twilio SMS &amp; MMS with A2P 10DLC campaign compliance registration</li>
                <li>Official WhatsApp Cloud API webhook integration with template messaging</li>
                <li>Meta Messenger webhook listener with replay-attack deduplication</li>
                <li>Inbound and outbound transactional email sync</li>
              </ul>
            </div>
            <div style={styles.cardBox}>
              <div style={styles.cardHeader}>
                <strong>Unified Conversation Stream</strong>
                <span style={styles.tagGreen}>WebSocket Connected</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5 }}>
                <div style={{ background: '#f1f5f9', padding: 10, borderRadius: 8, borderLeft: '3px solid #0ea5e9' }}>
                  <div style={{ fontWeight: 600, color: '#0369a1', marginBottom: 2 }}>📱 Inbound SMS via Twilio</div>
                  <div>"Hey! Can we reschedule our onboarding call to Thursday afternoon?"</div>
                </div>
                <div style={{ background: '#f1f5f9', padding: 10, borderRadius: 8, borderLeft: '3px solid #10b981' }}>
                  <div style={{ fontWeight: 600, color: '#047857', marginBottom: 2 }}>💬 WhatsApp Cloud API</div>
                  <div>"Contract review is complete, just sent signed copy."</div>
                </div>
                <div style={{ alignSelf: 'flex-end', background: '#4f46e5', color: '#fff', padding: 10, borderRadius: 8, maxWidth: '85%' }}>
                  <div>"Got it! Updating the appointment on your calendar right away."</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section style={styles.sectionAlt}>
        <div style={styles.container}>
          <div style={styles.grid2}>
            <div style={styles.cardBox}>
              <div style={styles.cardHeader}>
                <strong>Virtual Telephony &amp; IVR Routing</strong>
                <span style={styles.tagIndigo}>SIP / WebRTC Active</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#f8fafc', borderRadius: 6 }}>
                  <span>Main Line: +1 (800) 555-0199</span>
                  <span style={{ color: '#0f9d6e', fontWeight: 600 }}>Provisioned</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#f8fafc', borderRadius: 6 }}>
                  <span>Interactive Voice Response (IVR)</span>
                  <span style={{ color: '#4f46e5', fontWeight: 600 }}>Press 1 for Sales</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#f8fafc', borderRadius: 6 }}>
                  <span>Call Recording &amp; Transcripts</span>
                  <span style={{ color: '#0f9d6e', fontWeight: 600 }}>Enabled</span>
                </div>
              </div>
            </div>
            <div>
              <span style={styles.featureBadge}>PHONE SYSTEM</span>
              <h2 style={styles.h2}>Integrated Virtual Numbers &amp; Dialers</h2>
              <p style={styles.paragraph}>
                Equip your team with dedicated virtual business phone numbers. Make browser-based calls,
                route incoming leads to specific team members, and record calls directly to CRM contact logs.
              </p>
              <ul style={styles.list}>
                <li>Local and toll-free virtual number provisioning in over 50 countries</li>
                <li>Call recording, automated voicemail drops, and call forwarding</li>
                <li>AI conversation summarization for quick client debriefs</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section style={styles.ctaBox}>
        <div style={styles.container}>
          <h2 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 10px', color: '#0f172a' }}>
            Unify Your Client Communications
          </h2>
          <p style={{ fontSize: 15, color: '#475569', maxWidth: 520, margin: '0 auto 20px', lineHeight: 1.6 }}>
            Never miss a high-value client inquiry again. Try Operza's unified omnichannel inbox today.
          </p>
          <Link
            to="/signup"
            style={styles.btnPrimary}
            onClick={() => trackEvent('signup_start', { source: 'conversations_bottom_cta' })}
          >
            Start Free 7-Day Trial →
          </Link>
        </div>
      </section>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageHeader: {
    padding: '60px 20px 48px',
    background: 'radial-gradient(ellipse at top, #f0fdfa 0%, #ffffff 80%)',
    borderBottom: '1px solid #e2e8f0',
  },
  container: {
    maxWidth: 1120,
    margin: '0 auto',
  },
  breadcrumbs: {
    display: 'flex',
    gap: 8,
    fontSize: 12.5,
    color: '#64748b',
    marginBottom: 16,
    alignItems: 'center',
  },
  breadLink: {
    color: '#475569',
    textDecoration: 'none',
  },
  h1: {
    fontSize: 40,
    fontWeight: 800,
    letterSpacing: '-0.03em',
    color: '#0f172a',
    margin: '0 0 16px',
    lineHeight: 1.15,
  },
  lead: {
    fontSize: 17,
    color: '#475569',
    maxWidth: 720,
    lineHeight: 1.6,
    margin: 0,
  },
  btnPrimary: {
    display: 'inline-block',
    padding: '11px 22px',
    background: '#4f46e5',
    color: '#ffffff',
    borderRadius: 8,
    fontWeight: 650,
    fontSize: 14.5,
    textDecoration: 'none',
    boxShadow: '0 2px 8px rgba(79, 70, 229, 0.3)',
  },
  btnSecondary: {
    display: 'inline-block',
    padding: '11px 20px',
    background: '#ffffff',
    border: '1px solid #cbd5e1',
    color: '#334155',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 14.5,
    textDecoration: 'none',
  },
  section: {
    padding: '64px 20px',
  },
  sectionAlt: {
    padding: '64px 20px',
    background: '#f8fafc',
    borderTop: '1px solid #e2e8f0',
    borderBottom: '1px solid #e2e8f0',
  },
  grid2: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 48,
    alignItems: 'center',
  },
  featureBadge: {
    fontSize: 11,
    fontWeight: 700,
    color: '#4f46e5',
    letterSpacing: '0.06em',
  },
  h2: {
    fontSize: 26,
    fontWeight: 800,
    color: '#0f172a',
    margin: '8px 0 14px',
  },
  paragraph: {
    fontSize: 14.5,
    lineHeight: 1.6,
    color: '#475569',
    margin: '0 0 16px',
  },
  list: {
    paddingLeft: 18,
    fontSize: 14,
    color: '#334155',
    lineHeight: 1.7,
  },
  cardBox: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 24,
    boxShadow: '0 4px 16px rgba(15, 23, 42, 0.05)',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    fontSize: 13.5,
  },
  tagIndigo: {
    background: '#e0e7ff',
    color: '#3730a3',
    padding: '3px 8px',
    borderRadius: 99,
    fontSize: 11,
    fontWeight: 600,
  },
  tagGreen: {
    background: '#e6f7f1',
    color: '#0f9d6e',
    padding: '3px 8px',
    borderRadius: 99,
    fontSize: 11,
    fontWeight: 600,
  },
  ctaBox: {
    padding: '60px 20px',
    textAlign: 'center',
    background: '#f1f5f9',
    borderTop: '1px solid #e2e8f0',
  },
};
