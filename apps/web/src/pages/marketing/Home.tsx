import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SEO } from '../../components/SEO';
import { Icon } from '../../components/Icon';
import {
  SCHEMA_ORGANIZATION,
  SCHEMA_WEBSITE,
  SCHEMA_SOFTWARE_APPLICATION,
  buildFaqSchema,
} from '../../lib/schema';
import { trackEvent } from '../../lib/analytics';

const HOME_FAQS = [
  {
    question: 'What is Operza?',
    answer:
      'Operza is an all-in-one business operating system and multi-tenant agency CRM. It unites client relationship management, 2D visual workflow automation, sales funnel building, omnichannel communications (SMS, WhatsApp, Email, Messenger), and white-label client portals into a single high-performance platform.',
  },
  {
    question: 'How does Operza enforce multi-tenant agency isolation?',
    answer:
      'Operza enforces multi-tenancy at the PostgreSQL database layer via transaction-scoped Row-Level Security (RLS) policies (`SET LOCAL app.current_agency_id`). This guarantees fail-closed isolation so no tenant can ever read or modify another agency’s contacts, deals, or workflows.',
  },
  {
    question: 'Can I white-label Operza for my agency clients?',
    answer:
      'Yes. Operza includes complete white-label capabilities: custom domain mapping with automated Let’s Encrypt TLS/SSL, brand color themes, custom logo and favicon injection, and unbranded client portals for invoicing and contract signing.',
  },
  {
    question: 'How does workflow automation work in Operza?',
    answer:
      'Operza features an interactive 2D node-and-wire canvas. You can connect event triggers (form submissions, inbound SMS, status updates) to sequential or conditional branching actions (YES/NO rules, webhook dispatches, human approval gates, and email notifications) powered by a durable BullMQ Redis queue.',
  },
  {
    question: 'Can I self-host Operza on my own infrastructure?',
    answer:
      'Yes. Operza provides standard Docker containers and zero-lock-in relational PostgreSQL migrations. You can deploy Operza on AWS, DigitalOcean, Railway, or on-premise hardware with full data sovereignty.',
  },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<'crm' | 'workflows' | 'funnels' | 'omni' | 'portal'>('crm');
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const homeJsonLd = [
    SCHEMA_ORGANIZATION,
    SCHEMA_WEBSITE,
    SCHEMA_SOFTWARE_APPLICATION,
    buildFaqSchema(HOME_FAQS),
  ];

  return (
    <>
      <SEO
        title="All-in-One Business Operating System & Multi-Tenant Agency CRM"
        description="Consolidate your agency software stack with Operza: unified CRM, 2D visual workflow automation, landing page funnels, omnichannel conversations, and white-label client portals."
        canonical="/"
        keywords={[
          'all-in-one business management software',
          'agency management software',
          'marketing agency CRM',
          'workflow automation software',
          'sales funnel builder',
          'white-label CRM software',
          'multi-tenant CRM',
        ]}
        jsonLd={homeJsonLd}
      />

      {/* ─── Hero Section ─── */}
      <section style={styles.heroSection}>
        <div style={styles.heroContainer}>
          <div style={styles.heroBadge}>
            <span style={styles.badgePulse} />
            <span>ENTERPRISE-GRADE MULTI-TENANT AGENCY OPERATING SYSTEM</span>
          </div>

          <h1 style={styles.heroH1}>
            The Unified Business Operating System <br />
            <span style={styles.heroGradient}>for Modern Digital Agencies</span>
          </h1>

          <p style={styles.heroSubhead}>
            Stop juggling 8 different subscriptions. Operza unifies your client CRM, 2D visual
            workflow automations, drag-and-drop funnels, omnichannel messaging, and white-label
            client portals into a single, lightning-fast platform.
          </p>

          <div style={styles.heroActions}>
            <Link
              to="/signup"
              style={styles.heroBtnPrimary}
              onClick={() => trackEvent('signup_start', { source: 'hero_primary' })}
            >
              Start 14-Day Free Trial →
            </Link>
            <Link
              to="/platform/automation"
              style={styles.heroBtnSecondary}
              onClick={() => trackEvent('cta_click', { cta: 'hero_explore_canvas' })}
            >
              Explore Visual Workflows
            </Link>
          </div>

          <div style={styles.trustRow}>
            <span>✓ Zero per-seat lock-in</span>
            <span>✓ Strict PostgreSQL RLS multi-tenancy</span>
            <span>✓ Durable BullMQ queue</span>
            <span>✓ White-label CNAME ready</span>
          </div>
        </div>
      </section>

      {/* ─── Interactive Capabilities Matrix ─── */}
      <section style={styles.section}>
        <div style={styles.container}>
          <div style={styles.sectionHead}>
            <span style={styles.sectionTag}>SYSTEM ARCHITECTURE</span>
            <h2 style={styles.sectionH2}>Everything Your Agency Needs to Scale Profitably</h2>
            <p style={styles.sectionSub}>
              Engineered from the ground up for high-velocity teams managing multiple client sub-accounts.
            </p>
          </div>

          {/* Interactive Feature Tabs */}
          <div style={styles.tabsBar}>
            <button
              type="button"
              style={{ ...styles.tabBtn, ...(activeTab === 'crm' ? styles.tabBtnActive : {}) }}
              onClick={() => setActiveTab('crm')}
            >
              <Icon name="users" size={15} /> Agency CRM
            </button>
            <button
              type="button"
              style={{ ...styles.tabBtn, ...(activeTab === 'workflows' ? styles.tabBtnActive : {}) }}
              onClick={() => setActiveTab('workflows')}
            >
              <Icon name="zap" size={15} /> Visual Workflows
            </button>
            <button
              type="button"
              style={{ ...styles.tabBtn, ...(activeTab === 'funnels' ? styles.tabBtnActive : {}) }}
              onClick={() => setActiveTab('funnels')}
            >
              <Icon name="funnel" size={15} /> Funnels &amp; Pages
            </button>
            <button
              type="button"
              style={{ ...styles.tabBtn, ...(activeTab === 'omni' ? styles.tabBtnActive : {}) }}
              onClick={() => setActiveTab('omni')}
            >
              <Icon name="message" size={15} /> Omnichannel Inbox
            </button>
            <button
              type="button"
              style={{ ...styles.tabBtn, ...(activeTab === 'portal' ? styles.tabBtnActive : {}) }}
              onClick={() => setActiveTab('portal')}
            >
              <Icon name="globe" size={15} /> White-Label Portal
            </button>
          </div>

          {/* Tab Content Display */}
          <div style={styles.tabDisplayBox}>
            {activeTab === 'crm' && (
              <div style={styles.tabGrid}>
                <div>
                  <span style={styles.featurePill}>PIPELINE &amp; CONTACT INTELLIGENCE</span>
                  <h3 style={styles.tabH3}>Multi-Client CRM with Strict Tenant Boundaries</h3>
                  <p style={styles.tabP}>
                    Organize contacts, opportunities, and activities with custom fields, automated tags,
                    and weighted pipeline value calculations. Replicate standard agency operating procedures
                    across sub-accounts using 1-click snapshot blueprints.
                  </p>
                  <ul style={styles.tabBulletList}>
                    <li>Multi-stage Kanban boards with drag-and-drop opportunity cards</li>
                    <li>Row-Level Security (RLS) guaranteeing 0% cross-tenant data leakage</li>
                    <li>Smart Lists with real-time filter segmentation and bulk actions</li>
                  </ul>
                  <Link to="/platform/crm" style={styles.tabLink}>
                    Explore CRM Architecture →
                  </Link>
                </div>
                <div style={styles.previewCard}>
                  <div style={styles.previewHeader}>
                    <strong>Acme Growth Pipeline</strong>
                    <span style={styles.badgeSuccess}>$142,500 Active Value</span>
                  </div>
                  <div style={styles.mockKanban}>
                    <div style={styles.mockCol}>
                      <div style={styles.mockColTitle}>Lead Qualified (18)</div>
                      <div style={styles.mockItem}>Apex Logistics · $4,500/mo</div>
                      <div style={styles.mockItem}>Vanguard Health · $8,000/mo</div>
                    </div>
                    <div style={styles.mockCol}>
                      <div style={styles.mockColTitle}>Strategy Call (6)</div>
                      <div style={styles.mockItem}>Nova Retail · $12,500/mo</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'workflows' && (
              <div style={styles.tabGrid}>
                <div>
                  <span style={styles.featurePill}>2D VISUAL GRAPH CANVAS</span>
                  <h3 style={styles.tabH3}>Event-Driven Automations with Cubic Bezier Wires</h3>
                  <p style={styles.tabP}>
                    Build complex client journeys with condition rules, exponential backoff retries,
                    human approval gates, and webhook dispatchers. Never lose an event thanks to persistent
                    Redis BullMQ queuing.
                  </p>
                  <ul style={styles.tabBulletList}>
                    <li>Zoom, pan, and connect nodes with cubic bezier curves</li>
                    <li>Conditional branching for YES / NO decision trees</li>
                    <li>Human approval checkpoints for mission-critical client notifications</li>
                  </ul>
                  <Link to="/platform/automation" style={styles.tabLink}>
                    Explore Workflow Engine →
                  </Link>
                </div>
                <div style={styles.previewCard}>
                  <div style={styles.previewHeader}>
                    <strong>Lead Nurture Flow</strong>
                    <span style={styles.badgeSuccess}>Durable BullMQ Active</span>
                  </div>
                  <div style={styles.canvasMock}>
                    <div style={styles.nodeBox}>⚡ Trigger: Inbound Lead Opt-In</div>
                    <div style={styles.connector}>↓</div>
                    <div style={styles.nodeBox}>🤖 Condition: Deal Value &gt; $5,000?</div>
                    <div style={styles.branchRow}>
                      <div style={styles.nodeSmall}>YES → Notify Senior Rep</div>
                      <div style={styles.nodeSmall}>NO → Email Onboarding Drip</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'funnels' && (
              <div style={styles.tabGrid}>
                <div>
                  <span style={styles.featurePill}>WYSIWYG PAGE BUILDER</span>
                  <h3 style={styles.tabH3}>High-Converting Landing Pages &amp; 1-Click Checkouts</h3>
                  <p style={styles.tabP}>
                    Design mobile-responsive acquisition funnels directly in the browser. Add live countdown
                    timers, testimonial sliders, responsive 2-column grids, and frictionless order bumps.
                  </p>
                  <ul style={styles.tabBulletList}>
                    <li>Real-time Desktop, Tablet, and Mobile viewport preview switching</li>
                    <li>Dynamic 1-click order bump calculations and customer promotions</li>
                    <li>Instant custom domain mapping with auto-renewing SSL</li>
                  </ul>
                  <Link to="/platform/funnels" style={styles.tabLink}>
                    Explore Funnel Builder →
                  </Link>
                </div>
                <div style={styles.previewCard}>
                  <div style={styles.previewHeader}>
                    <strong>High-Velocity Acquisition Funnel</strong>
                    <span style={styles.badgeSuccess}>4.8% Conversion</span>
                  </div>
                  <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, color: '#f8fafc', textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Scale Agency Growth in 14 Days</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>Limited VIP Masterclass Invitation</div>
                    <div style={{ background: '#1e293b', padding: 8, borderRadius: 6, fontSize: 12, border: '1px dashed #6366f1' }}>
                      ☑️ 1-Click Order Bump: Add VIP Snapshot Blueprints ($497)
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'omni' && (
              <div style={styles.tabGrid}>
                <div>
                  <span style={styles.featurePill}>UNIFIED OMNICHANNEL STREAM</span>
                  <h3 style={styles.tabH3}>SMS, WhatsApp, Email &amp; Messenger in One Inbox</h3>
                  <p style={styles.tabP}>
                    Empower your team to handle client interactions from Twilio SMS, WhatsApp Cloud API,
                    Meta Messenger, and transactional email in a single unified conversation stream.
                  </p>
                  <ul style={styles.tabBulletList}>
                    <li>Real-time WebSocket event streaming for instant inbound replies</li>
                    <li>Integrated Twilio voice dialing with call recording and IVR routing</li>
                    <li>AI Copilot assistance for instant suggested customer replies</li>
                  </ul>
                  <Link to="/platform/conversations" style={styles.tabLink}>
                    Explore Omnichannel Inbox →
                  </Link>
                </div>
                <div style={styles.previewCard}>
                  <div style={styles.previewHeader}>
                    <strong>Unified Conversation: Sarah Jenkins</strong>
                    <span style={styles.badgeSuccess}>WhatsApp Cloud API</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                    <div style={{ alignSelf: 'flex-start', background: '#f1f5f9', padding: '8px 12px', borderRadius: 8, maxWidth: '80%' }}>
                      Hi team, we're ready to proceed with the contract proposal!
                    </div>
                    <div style={{ alignSelf: 'flex-end', background: '#4f46e5', color: '#fff', padding: '8px 12px', borderRadius: 8, maxWidth: '80%' }}>
                      Fantastic Sarah! I have generated your digital agreement in the client portal.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'portal' && (
              <div style={styles.tabGrid}>
                <div>
                  <span style={styles.featurePill}>WHITE-LABEL CLIENT PORTAL</span>
                  <h3 style={styles.tabH3}>Custom-Branded Client Access with Digital Signatures</h3>
                  <p style={styles.tabP}>
                    Deliver a first-class experience for your agency clients. Let them view invoices,
                    sign digital contracts with canvas signatures, and access educational LMS courses.
                  </p>
                  <ul style={styles.tabBulletList}>
                    <li>Host under your custom domain (e.g. portal.youragency.com)</li>
                    <li>Digital contract e-signatures with cryptographic audit timestamps</li>
                    <li>Seamless invoice settlement via Stripe &amp; custom merchant gateways</li>
                  </ul>
                  <Link to="/platform/portal" style={styles.tabLink}>
                    Explore Client Portal →
                  </Link>
                </div>
                <div style={styles.previewCard}>
                  <div style={styles.previewHeader}>
                    <strong>Client Portal · Apex Media</strong>
                    <span style={styles.badgeSuccess}>Custom CNAME Active</span>
                  </div>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, fontWeight: 600 }}>
                      <span>Master Service Agreement v2</span>
                      <span style={{ color: '#10b981' }}>● Signed &amp; Verified</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      Invoice #INV-2026-88 paid via Stripe ($3,500.00 USD)
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ─── Architectural Proof & Trust Section ─── */}
      <section style={styles.sectionAlt}>
        <div style={styles.container}>
          <div style={styles.sectionHead}>
            <span style={styles.sectionTag}>ENTERPRISE RELIABILITY</span>
            <h2 style={styles.sectionH2}>Built for High-Stakes Production Workloads</h2>
            <p style={styles.sectionSub}>
              No superficial wrappers. Operza is constructed on battle-tested open-source foundations.
            </p>
          </div>

          <div style={styles.grid3}>
            <div style={styles.techCard}>
              <div style={styles.techIcon}><Icon name="database" size={20} /></div>
              <h3 style={styles.techTitle}>PostgreSQL Row-Level Security</h3>
              <p style={styles.techDesc}>
                Transaction-scoped RLS policies guarantee fail-closed multi-tenancy. Every query is
                strictly bounded to the authenticated agency context.
              </p>
            </div>

            <div style={styles.techCard}>
              <div style={styles.techIcon}><Icon name="zap" size={20} /></div>
              <h3 style={styles.techTitle}>Durable BullMQ Queueing</h3>
              <p style={styles.techDesc}>
                Redis-backed job orchestration with exponential backoff, jitter, dead-letter queues,
                and idempotency key deduplication.
              </p>
            </div>

            <div style={styles.techCard}>
              <div style={styles.techIcon}><Icon name="lock" size={20} /></div>
              <h3 style={styles.techTitle}>Full Data Sovereignty</h3>
              <p style={styles.techDesc}>
                Deploy on your cloud or on-premise infrastructure with Docker. Maintain 100% control
                over your proprietary client data.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Frequently Asked Questions (FAQ Section) ─── */}
      <section style={styles.section}>
        <div style={styles.container}>
          <div style={styles.sectionHead}>
            <span style={styles.sectionTag}>QUESTIONS &amp; ANSWERS</span>
            <h2 style={styles.sectionH2}>Frequently Asked Questions</h2>
            <p style={styles.sectionSub}>
              Everything you need to know about Operza’s capabilities, security, and migration.
            </p>
          </div>

          <div style={styles.faqList}>
            {HOME_FAQS.map((faq, index) => {
              const isOpen = openFaq === index;
              return (
                <div key={faq.question} style={styles.faqCard}>
                  <button
                    type="button"
                    style={styles.faqQuestionBtn}
                    onClick={() => setOpenFaq(isOpen ? null : index)}
                    aria-expanded={isOpen}
                  >
                    <span>{faq.question}</span>
                    <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} />
                  </button>
                  {isOpen && (
                    <div style={styles.faqAnswer}>
                      <p style={{ margin: 0, lineHeight: 1.6, color: '#475569', fontSize: 14 }}>
                        {faq.answer}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── Bottom CTA Banner ─── */}
      <section style={styles.ctaBanner}>
        <div style={styles.container}>
          <h2 style={{ fontSize: 32, fontWeight: 800, color: '#ffffff', margin: '0 0 12px' }}>
            Ready to Streamline Your Agency Operations?
          </h2>
          <p style={{ fontSize: 16, color: '#c7d2fe', maxWidth: 540, margin: '0 auto 24px', lineHeight: 1.5 }}>
            Join forward-thinking agencies eliminating software fragmentation with Operza.
            Start your full-featured 14-day trial today.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link
              to="/signup"
              style={styles.ctaBtnWhite}
              onClick={() => trackEvent('signup_start', { source: 'bottom_cta' })}
            >
              Get Started Free →
            </Link>
            <Link to="/pricing" style={styles.ctaBtnOutline}>
              View Pricing Tiers
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heroSection: {
    padding: '70px 20px 60px',
    background: 'radial-gradient(ellipse at top, #eef2ff 0%, #ffffff 70%)',
    borderBottom: '1px solid #e2e8f0',
    textAlign: 'center',
  },
  heroContainer: {
    maxWidth: 960,
    margin: '0 auto',
  },
  heroBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 12px',
    borderRadius: 99,
    background: '#e0e7ff',
    color: '#3730a3',
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: '0.04em',
    marginBottom: 20,
  },
  badgePulse: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#4f46e5',
  },
  heroH1: {
    fontSize: 48,
    fontWeight: 800,
    lineHeight: 1.15,
    letterSpacing: '-0.03em',
    color: '#0f172a',
    margin: '0 0 20px',
  },
  heroGradient: {
    background: 'linear-gradient(135deg, #4f46e5, #0ea5e9)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  heroSubhead: {
    fontSize: 18,
    lineHeight: 1.6,
    color: '#475569',
    maxWidth: 720,
    margin: '0 auto 32px',
  },
  heroActions: {
    display: 'flex',
    gap: 14,
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginBottom: 32,
  },
  heroBtnPrimary: {
    padding: '12px 26px',
    fontSize: 15,
    fontWeight: 650,
    color: '#ffffff',
    background: '#4f46e5',
    borderRadius: 9,
    textDecoration: 'none',
    boxShadow: '0 4px 14px rgba(79, 70, 229, 0.35)',
    transition: 'all 0.15s ease',
  },
  heroBtnSecondary: {
    padding: '12px 24px',
    fontSize: 15,
    fontWeight: 600,
    color: '#334155',
    background: '#ffffff',
    border: '1px solid #cbd5e1',
    borderRadius: 9,
    textDecoration: 'none',
    transition: 'all 0.15s ease',
  },
  trustRow: {
    display: 'flex',
    gap: 20,
    justifyContent: 'center',
    fontSize: 13,
    color: '#64748b',
    flexWrap: 'wrap',
  },
  section: {
    padding: '70px 20px',
  },
  sectionAlt: {
    padding: '70px 20px',
    background: '#f8fafc',
    borderTop: '1px solid #e2e8f0',
    borderBottom: '1px solid #e2e8f0',
  },
  container: {
    maxWidth: 1160,
    margin: '0 auto',
  },
  sectionHead: {
    textAlign: 'center',
    maxWidth: 680,
    margin: '0 auto 40px',
  },
  sectionTag: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: '#4f46e5',
    textTransform: 'uppercase',
  },
  sectionH2: {
    fontSize: 32,
    fontWeight: 800,
    color: '#0f172a',
    letterSpacing: '-0.02em',
    margin: '8px 0 12px',
  },
  sectionSub: {
    fontSize: 15,
    color: '#64748b',
    lineHeight: 1.6,
    margin: 0,
  },
  tabsBar: {
    display: 'flex',
    gap: 8,
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginBottom: 24,
  },
  tabBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 18px',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    background: '#ffffff',
    color: '#475569',
    fontSize: 13.5,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  tabBtnActive: {
    background: '#4f46e5',
    color: '#ffffff',
    borderColor: '#4338ca',
  },
  tabDisplayBox: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    padding: 32,
    boxShadow: '0 8px 30px rgba(15, 23, 42, 0.05)',
  },
  tabGrid: {
    display: 'grid',
    gridTemplateColumns: '1.2fr 1.3fr',
    gap: 40,
    alignItems: 'center',
  },
  featurePill: {
    fontSize: 11,
    fontWeight: 700,
    color: '#4f46e5',
    letterSpacing: '0.06em',
  },
  tabH3: {
    fontSize: 24,
    fontWeight: 800,
    color: '#0f172a',
    margin: '8px 0 12px',
  },
  tabP: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 1.6,
    margin: '0 0 16px',
  },
  tabBulletList: {
    paddingLeft: 18,
    fontSize: 13.5,
    color: '#334155',
    lineHeight: 1.7,
    marginBottom: 20,
  },
  tabLink: {
    fontSize: 14,
    fontWeight: 650,
    color: '#4f46e5',
    textDecoration: 'none',
  },
  previewCard: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: 18,
  },
  previewHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 13,
    marginBottom: 14,
  },
  badgeSuccess: {
    background: '#e6f7f1',
    color: '#0f9d6e',
    padding: '3px 8px',
    borderRadius: 99,
    fontSize: 11.5,
    fontWeight: 600,
  },
  mockKanban: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
  },
  mockCol: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 10,
  },
  mockColTitle: {
    fontSize: 11.5,
    fontWeight: 700,
    color: '#64748b',
    marginBottom: 8,
  },
  mockItem: {
    background: '#f8fafc',
    border: '1px solid #edf2f7',
    padding: '6px 8px',
    borderRadius: 6,
    fontSize: 11.5,
    color: '#1e293b',
    marginBottom: 6,
  },
  canvasMock: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
  },
  nodeBox: {
    background: '#ffffff',
    border: '1px solid #cbd5e1',
    padding: '8px 14px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    color: '#0f172a',
    width: '100%',
    textAlign: 'center',
  },
  connector: {
    color: '#94a3b8',
    fontSize: 16,
  },
  branchRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    width: '100%',
  },
  nodeSmall: {
    background: '#eef2ff',
    border: '1px solid #c7d2fe',
    color: '#3730a3',
    padding: '6px 10px',
    borderRadius: 6,
    fontSize: 11,
    textAlign: 'center',
  },
  grid3: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 24,
  },
  techCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 24,
  },
  techIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    background: '#eef0ff',
    color: '#4f46e5',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  techTitle: {
    fontSize: 17,
    fontWeight: 700,
    color: '#0f172a',
    margin: '0 0 8px',
  },
  techDesc: {
    fontSize: 13.5,
    color: '#64748b',
    lineHeight: 1.6,
    margin: 0,
  },
  faqList: {
    maxWidth: 780,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  faqCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  faqQuestionBtn: {
    width: '100%',
    textAlign: 'left',
    padding: '16px 20px',
    background: 'transparent',
    border: 'none',
    fontSize: 15,
    fontWeight: 650,
    color: '#0f172a',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  faqAnswer: {
    padding: '0 20px 18px',
    borderTop: '1px solid #f1f5f9',
    marginTop: 6,
    paddingTop: 12,
  },
  ctaBanner: {
    background: 'linear-gradient(135deg, #1e1b4b, #312e81 60%, #4338ca)',
    padding: '64px 20px',
    textAlign: 'center',
  },
  ctaBtnWhite: {
    padding: '12px 24px',
    borderRadius: 8,
    background: '#ffffff',
    color: '#4338ca',
    fontSize: 15,
    fontWeight: 700,
    textDecoration: 'none',
    boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
  },
  ctaBtnOutline: {
    padding: '12px 22px',
    borderRadius: 8,
    background: 'transparent',
    color: '#ffffff',
    border: '1px solid rgba(255,255,255,0.3)',
    fontSize: 15,
    fontWeight: 600,
    textDecoration: 'none',
  },
};
