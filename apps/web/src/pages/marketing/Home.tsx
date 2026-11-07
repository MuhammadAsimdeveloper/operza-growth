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
            <span>✓ Plans start at $35/mo</span>
            <span>✓ Zero per-seat user tax</span>
            <span>✓ Strict PostgreSQL RLS multi-tenancy</span>
            <span>✓ Durable BullMQ queue</span>
            <span>✓ White-label CNAME ready</span>
          </div>

          {/* ─── 3D Perspective Isometric Showcase & Holographic Telemetry ─── */}
          <div className="atlas-hero-3d-stage" style={styles.hero3dStage}>
            {/* Ambient Radial Lighting Glows */}
            <div style={styles.hero3dGlow1} />
            <div style={styles.hero3dGlow2} />

            {/* Isometric 3D Viewport */}
            <div className="atlas-3d-tilt-container" style={styles.tiltContainer}>
              {/* Central Main Console Mockup */}
              <div style={styles.consoleFrame}>
                {/* Top OS Window Header */}
                <div style={styles.consoleHeader}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444' }} />
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} />
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981' }} />
                  </div>
                  <div style={styles.consoleTitleBar}>
                    <span style={styles.consoleDotLive} />
                    <span>operza-atlas-command · cluster: us-east · rls: isolated · latency: 18ms</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>
                    v2.4.0-PROD
                  </div>
                </div>

                {/* Simulated 2D Visual Nodal Workflow & Live Telemetry Grid */}
                <div style={styles.consoleBody}>
                  {/* Left Mini Sidebar */}
                  <div style={styles.consoleSidebar}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                      <div style={{ width: 18, height: 18, borderRadius: 4, background: '#4f46e5', color: '#fff', fontSize: 10, fontWeight: 800, display: 'grid', placeItems: 'center' }}>OP</div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#f8fafc' }}>Atlas Command</span>
                    </div>
                    <div style={styles.consoleNavItemActive}>⚡ Visual Nodal Graph</div>
                    <div style={styles.consoleNavItem}>🤖 Copilot AI Swarm</div>
                    <div style={styles.consoleNavItem}>📞 WebRTC Softphone</div>
                    <div style={styles.consoleNavItem}>🔒 RLS Security Guard</div>
                    <div style={styles.consoleNavItem}>📊 MRR Velocity</div>
                  </div>

                  {/* Main Canvas Simulation */}
                  <div style={styles.consoleCanvas}>
                    {/* SVG Bezier Wires */}
                    <svg style={styles.consoleSvg}>
                      <defs>
                        <linearGradient id="neonWireGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#6366f1" />
                          <stop offset="100%" stopColor="#06b6d4" />
                        </linearGradient>
                      </defs>
                      <path
                        d="M 120 65 C 120 115, 230 95, 230 145"
                        fill="none"
                        stroke="url(#neonWireGrad)"
                        strokeWidth="2.5"
                        strokeDasharray="6 4"
                        className="pulse-wire"
                      />
                      <path
                        d="M 230 205 C 230 250, 130 240, 130 285"
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                      />
                      <path
                        d="M 230 205 C 230 250, 330 240, 330 285"
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                      />
                    </svg>

                    {/* Nodes in 3D canvas */}
                    <div style={{ ...styles.mockNode, top: 20, left: 35, borderColor: '#6366f1' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#818cf8', textTransform: 'uppercase' }}>
                        ⚡ Inbound Webhook
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 650, color: '#f8fafc' }}>
                        Stripe VIP Checkout $2,400
                      </div>
                    </div>

                    <div style={{ ...styles.mockNode, top: 130, left: 150, borderColor: '#06b6d4' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#22d3ee', textTransform: 'uppercase' }}>
                        🤖 Condition Evaluation
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 650, color: '#f8fafc' }}>
                        High-Ticket Client &gt; $1k?
                      </div>
                    </div>

                    <div style={{ ...styles.mockNodeSmall, top: 275, left: 50, borderColor: '#10b981' }}>
                      <span style={{ color: '#34d399', fontWeight: 700, fontSize: 10 }}>YES · 99.8%</span>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#f8fafc' }}>Dispatch Softphone Call</div>
                    </div>

                    <div style={{ ...styles.mockNodeSmall, top: 275, left: 250, borderColor: '#f43f5e' }}>
                      <span style={{ color: '#fb7185', fontWeight: 700, fontSize: 10 }}>NO · 0.2%</span>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#f8fafc' }}>Email Follow-up Sequence</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Floating Holographic Telemetry Card 1: Autonomous AI Swarm (Top Right) */}
              <div className="holo-float holo-card-1" style={styles.holoCard1}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', display: 'grid', placeItems: 'center' }}>
                    <Icon name="sparkles" size={13} />
                  </div>
                  <strong style={{ fontSize: 12, color: '#f8fafc' }}>Autonomous AI Swarm</strong>
                  <span style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981' }} />
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>10 specialized sub-agents online</div>
                <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: '#a5b4fc' }}>
                  99.4% Task Precision
                </div>
              </div>

              {/* Floating Holographic Telemetry Card 2: WebRTC Softphone (Bottom Left) */}
              <div className="holo-float holo-card-2" style={styles.holoCard2}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', display: 'grid', placeItems: 'center' }}>
                    <Icon name="phone" size={13} />
                  </div>
                  <strong style={{ fontSize: 12, color: '#f8fafc' }}>WebRTC Softphone</strong>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>SIP Trunking · 0.00% Packet Drop</div>
                <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: '#34d399' }}>
                  Audio Jitter 1.2ms
                </div>
              </div>

              {/* Floating Holographic Telemetry Card 3: PostgreSQL RLS Shield (Top Left) */}
              <div className="holo-float holo-card-3" style={styles.holoCard3}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(6, 182, 212, 0.2)', color: '#22d3ee', display: 'grid', placeItems: 'center' }}>
                    <Icon name="shield" size={13} />
                  </div>
                  <strong style={{ fontSize: 12, color: '#f8fafc' }}>PostgreSQL RLS Shield</strong>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Strict Tenant Boundaries Active</div>
                <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: '#38bdf8' }}>
                  100% Fail-Closed Isolation
                </div>
              </div>

              {/* Floating Holographic Telemetry Card 4: MRR Velocity (Bottom Right) */}
              <div className="holo-float holo-card-4" style={styles.holoCard4}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(236, 72, 153, 0.2)', color: '#f472b6', display: 'grid', placeItems: 'center' }}>
                    <Icon name="wallet" size={13} />
                  </div>
                  <strong style={{ fontSize: 12, color: '#f8fafc' }}>Agency MRR Velocity</strong>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Real-time subscription billing</div>
                <div style={{ marginTop: 6, fontSize: 14, fontWeight: 800, color: '#f43f5e' }}>
                  $184,200 <span style={{ fontSize: 11, color: '#34d399', fontWeight: 600 }}>+38.4% WoW</span>
                </div>
              </div>
            </div>

            {/* Injected 3D Animations CSS */}
            <style>{`
              @keyframes floatSlow {
                0%, 100% { transform: translateY(0px) rotate(0deg); }
                50% { transform: translateY(-10px) rotate(1deg); }
              }
              @keyframes floatReverse {
                0%, 100% { transform: translateY(0px) rotate(0deg); }
                50% { transform: translateY(10px) rotate(-1deg); }
              }
              @keyframes pulseWire {
                to { stroke-dashoffset: -20; }
              }
              .holo-card-1 { animation: floatSlow 5s ease-in-out infinite; }
              .holo-card-2 { animation: floatReverse 6s ease-in-out infinite 0.5s; }
              .holo-card-3 { animation: floatReverse 5.5s ease-in-out infinite 1s; }
              .holo-card-4 { animation: floatSlow 6.5s ease-in-out infinite 1.5s; }
              .pulse-wire { animation: pulseWire 1.2s linear infinite; }
              .atlas-3d-tilt-container {
                transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s ease;
              }
              .atlas-3d-tilt-container:hover {
                transform: rotateX(8deg) rotateY(-4deg) rotateZ(1deg) scale(1.02) !important;
              }
            `}</style>
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
            <div style={styles.techCard} className="card-3d-interactive">
              <div style={styles.techIcon}><Icon name="database" size={20} /></div>
              <h3 style={styles.techTitle}>PostgreSQL Row-Level Security</h3>
              <p style={styles.techDesc}>
                Transaction-scoped RLS policies guarantee fail-closed multi-tenancy. Every query is
                strictly bounded to the authenticated agency context.
              </p>
            </div>

            <div style={styles.techCard} className="card-3d-interactive">
              <div style={styles.techIcon}><Icon name="zap" size={20} /></div>
              <h3 style={styles.techTitle}>Durable BullMQ Queueing</h3>
              <p style={styles.techDesc}>
                Redis-backed job orchestration with exponential backoff, jitter, dead-letter queues,
                and idempotency key deduplication.
              </p>
            </div>

            <div style={styles.techCard} className="card-3d-interactive">
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

      {/* ─── Stack Sprawl vs Operza Pricing Breakdown ─── */}
      <section style={{ ...styles.section, background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)' }}>
        <div style={styles.container}>
          <div style={styles.sectionHead}>
            <span style={styles.sectionTag}>RADICAL SAVINGS</span>
            <h2 style={styles.sectionH2}>Stop Paying the $1,200/Month Fragmented Tool Tax</h2>
            <p style={styles.sectionSub}>
              Why pay 6 separate vendors with brittle webhook glue when Operza provides an integrated, unified system for just $35 to $79/month?
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 32, alignItems: 'center', margin: '40px 0 20px' }}>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '28px', boxShadow: '0 4px 16px rgba(15,23,42,0.05)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626' }} />
                The Fragmented Agency Software Tax ($1,216+/mo)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#fef2f2', borderRadius: 8, fontSize: 13.5 }}>
                  <span>Separate CRM &amp; Pipeline Seats (5 users)</span>
                  <strong style={{ color: '#991b1b' }}>$250/mo</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#fef2f2', borderRadius: 8, fontSize: 13.5 }}>
                  <span>iPaaS Visual Automation (Zapier Pro)</span>
                  <strong style={{ color: '#991b1b' }}>$129/mo</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#fef2f2', borderRadius: 8, fontSize: 13.5 }}>
                  <span>Funnel &amp; Landing Page Builder</span>
                  <strong style={{ color: '#991b1b' }}>$197/mo</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#fef2f2', borderRadius: 8, fontSize: 13.5 }}>
                  <span>Omnichannel Inbox &amp; SMS Platform</span>
                  <strong style={{ color: '#991b1b' }}>$150/mo</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#fef2f2', borderRadius: 8, fontSize: 13.5 }}>
                  <span>Contract E-Signatures &amp; Client Portal</span>
                  <strong style={{ color: '#991b1b' }}>$90/mo</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#fef2f2', borderRadius: 8, fontSize: 13.5 }}>
                  <span>Legacy Agency Sub-Account Fees</span>
                  <strong style={{ color: '#991b1b' }}>$400/mo</strong>
                </div>
              </div>
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #fee2e2', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: '#475569' }}>Total Monthly Bleed:</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: '#dc2626' }}>$1,216 / mo ($14,592/yr)</span>
              </div>
            </div>

            <div style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)', borderRadius: 16, padding: '32px 28px', color: '#ffffff', boxShadow: '0 12px 36px rgba(15,23,42,0.2)' }} className="card-3d-interactive">
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: '#38bdf8', textTransform: 'uppercase', marginBottom: 8 }}>
                THE OPERZA DIFFERENCE
              </div>
              <h3 style={{ fontSize: 26, fontWeight: 850, color: '#ffffff', margin: '0 0 10px' }}>
                All Included from $35/Month
              </h3>
              <p style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.5, margin: '0 0 20px' }}>
                Unlimited seats, visual workflows, multi-tenant database RLS, and client portals in one transactional engine.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24, fontSize: 13.5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#e2e8f0' }}>
                  <span style={{ color: '#34d399', fontWeight: 800 }}>✓</span> Starter: <strong>$35/mo</strong> (3 sub-accounts, unlimited seats)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#e2e8f0' }}>
                  <span style={{ color: '#34d399', fontWeight: 800 }}>✓</span> Growth: <strong>$79/mo</strong> (15 sub-accounts, white-label portal)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#e2e8f0' }}>
                  <span style={{ color: '#34d399', fontWeight: 800 }}>✓</span> Scale: <strong>$149/mo</strong> (unlimited sub-accounts, full API)
                </div>
              </div>
              <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 10, padding: '14px', textAlign: 'center', marginBottom: 20 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Annual Net Savings</span>
                <div style={{ fontSize: 28, fontWeight: 900, color: '#34d399', margin: '2px 0' }}>Over $13,600 / year</div>
              </div>
              <Link to="/pricing" style={{ display: 'block', textAlign: 'center', padding: '12px', background: '#4f46e5', color: '#ffffff', borderRadius: 8, fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>
                Compare All Plans &amp; Calculate Savings →
              </Link>
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
  hero3dStage: {
    position: 'relative' as const,
    marginTop: 48,
    perspective: 1200,
    width: '100%',
    maxWidth: 960,
    margin: '48px auto 0',
  },
  hero3dGlow1: {
    position: 'absolute' as const,
    width: 480,
    height: 300,
    top: '10%',
    left: '15%',
    background: 'radial-gradient(circle, rgba(99, 102, 241, 0.25) 0%, transparent 70%)',
    filter: 'blur(50px)',
    pointerEvents: 'none' as const,
    zIndex: 1,
  },
  hero3dGlow2: {
    position: 'absolute' as const,
    width: 440,
    height: 280,
    top: '30%',
    right: '15%',
    background: 'radial-gradient(circle, rgba(6, 182, 212, 0.2) 0%, transparent 70%)',
    filter: 'blur(50px)',
    pointerEvents: 'none' as const,
    zIndex: 1,
  },
  tiltContainer: {
    position: 'relative' as const,
    transform: 'rotateX(13deg) rotateY(-8deg) rotateZ(2deg)',
    transformStyle: 'preserve-3d' as const,
    zIndex: 2,
  },
  consoleFrame: {
    background: '#07090e',
    borderRadius: 14,
    border: '1px solid rgba(99, 102, 241, 0.35)',
    boxShadow: '0 25px 60px -12px rgba(0, 0, 0, 0.5), 0 0 40px rgba(99, 102, 241, 0.2)',
    overflow: 'hidden',
    height: 420,
    display: 'flex',
    flexDirection: 'column' as const,
  },
  consoleHeader: {
    padding: '10px 16px',
    background: '#0d111a',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  consoleTitleBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: '#94a3b8',
    fontFamily: 'monospace',
  },
  consoleDotLive: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#10b981',
    boxShadow: '0 0 6px #10b981',
  },
  consoleBody: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  consoleSidebar: {
    width: 170,
    background: '#0b0e15',
    borderRight: '1px solid rgba(255, 255, 255, 0.06)',
    padding: '14px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  consoleNavItem: {
    fontSize: 11,
    color: '#64748b',
    padding: '5px 8px',
    borderRadius: 6,
    cursor: 'pointer',
  },
  consoleNavItemActive: {
    fontSize: 11,
    color: '#f8fafc',
    background: 'rgba(99, 102, 241, 0.15)',
    padding: '5px 8px',
    borderRadius: 6,
    fontWeight: 700,
  },
  consoleCanvas: {
    flex: 1,
    position: 'relative' as const,
    background: '#07090e',
    backgroundImage: 'radial-gradient(circle, rgba(255, 255, 255, 0.1) 1px, transparent 1px)',
    backgroundSize: '20px 20px',
    overflow: 'hidden',
  },
  consoleSvg: {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none' as const,
  },
  mockNode: {
    position: 'absolute' as const,
    background: '#0f1422',
    border: '1.5px solid',
    borderRadius: 8,
    padding: '8px 12px',
    width: 190,
    boxShadow: '0 8px 18px rgba(0, 0, 0, 0.4)',
  },
  mockNodeSmall: {
    position: 'absolute' as const,
    background: '#0f1422',
    border: '1.5px solid',
    borderRadius: 8,
    padding: '6px 10px',
    width: 155,
    boxShadow: '0 6px 14px rgba(0, 0, 0, 0.4)',
  },
  holoCard1: {
    position: 'absolute' as const,
    top: -24,
    right: -24,
    width: 220,
    background: 'rgba(15, 20, 34, 0.88)',
    border: '1px solid rgba(99, 102, 241, 0.5)',
    boxShadow: '0 16px 32px rgba(0, 0, 0, 0.4), 0 0 20px rgba(99, 102, 241, 0.25)',
    borderRadius: 12,
    padding: '12px 14px',
    backdropFilter: 'blur(12px)',
    zIndex: 10,
  },
  holoCard2: {
    position: 'absolute' as const,
    bottom: -24,
    left: -24,
    width: 210,
    background: 'rgba(15, 20, 34, 0.88)',
    border: '1px solid rgba(16, 185, 129, 0.5)',
    boxShadow: '0 16px 32px rgba(0, 0, 0, 0.4), 0 0 20px rgba(16, 185, 129, 0.25)',
    borderRadius: 12,
    padding: '12px 14px',
    backdropFilter: 'blur(12px)',
    zIndex: 10,
  },
  holoCard3: {
    position: 'absolute' as const,
    top: 60,
    left: -32,
    width: 215,
    background: 'rgba(15, 20, 34, 0.88)',
    border: '1px solid rgba(6, 182, 212, 0.5)',
    boxShadow: '0 16px 32px rgba(0, 0, 0, 0.4), 0 0 20px rgba(6, 182, 212, 0.25)',
    borderRadius: 12,
    padding: '12px 14px',
    backdropFilter: 'blur(12px)',
    zIndex: 10,
  },
  holoCard4: {
    position: 'absolute' as const,
    bottom: 30,
    right: -28,
    width: 220,
    background: 'rgba(15, 20, 34, 0.88)',
    border: '1px solid rgba(236, 72, 153, 0.5)',
    boxShadow: '0 16px 32px rgba(0, 0, 0, 0.4), 0 0 20px rgba(236, 72, 153, 0.25)',
    borderRadius: 12,
    padding: '12px 14px',
    backdropFilter: 'blur(12px)',
    zIndex: 10,
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
