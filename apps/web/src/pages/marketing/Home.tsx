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
    question: 'How does the visual Funnel Builder work?',
    answer:
      'The visual Funnel Builder provides step-by-step visitor journeys (Opt-in, Sales VSL, Checkout, Upsell, Booking, Thank You) with real-time drop-off rates between steps, 1-click order bumps, and an in-browser drag-and-drop page canvas.',
  },
  {
    question: 'What is Miss Minutes AI Copilot?',
    answer:
      'Miss Minutes is Operza’s autonomous AI copilot. She analyzes your pipeline, summarizes deals, executes permitted CRM actions (creating opportunities, sending emails, scheduling appointments), and answers business questions with verifiable data grounding.',
  },
  {
    question: 'Can I self-host Operza on my own infrastructure?',
    answer:
      'Yes. Operza provides standard Docker containers and zero-lock-in relational PostgreSQL migrations. You can deploy Operza on AWS, DigitalOcean, Railway, or on-premise hardware with full data sovereignty.',
  },
  {
    question: 'Can I migrate my data from legacy CRMs or marketing platforms?',
    answer:
      'Yes. Operza provides standard CSV import tools for contacts, opportunities, and pipelines, as well as a full REST API and webhooks to synchronize your existing business data seamlessly.',
  },
];

export default function Home() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [annualBilling, setAnnualBilling] = useState(true);
  const [activePromptIndex, setActivePromptIndex] = useState(0);

  const homeJsonLd = [
    SCHEMA_ORGANIZATION,
    SCHEMA_WEBSITE,
    SCHEMA_SOFTWARE_APPLICATION,
    buildFaqSchema(HOME_FAQS),
  ];

  const copilotPrompts = [
    {
      prompt: 'Summarize Q3 revenue, top 3 sales opportunities, and hot leads this week',
      result: 'Calculated $142,500 in open pipeline. Top 3 deals: Apex Media ($38k), Nova Health ($24k), Horizon SaaS ($18k). 5 hot leads require same-day follow-up.',
    },
    {
      prompt: 'Create a 1-click order bump for the VIP Accelerator on the Summer Funnel',
      result: 'Configured order bump "VIP Implementation Toolkit" at $97 (list $497). Attached to Summer Sales Funnel checkout with dynamic acceptance tracking.',
    },
    {
      prompt: 'Trigger the High-Ticket Client Onboarding workflow for Sarah Connor',
      result: 'Dispatched BullMQ job for workflow "Client Onboarding v2". Created client portal credentials, sent Welcome SMS via Twilio, and alerted Senior Account Rep.',
    },
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

      {/* ─── 1. HERO SECTION ─── */}
      <section style={styles.heroSection}>
        <div style={styles.heroContainer}>
          <div style={styles.heroBadge}>
            <span style={styles.badgePulse} />
            <span>THE NEXT-GENERATION MULTI-TENANT AGENCY GROWTH OS</span>
          </div>

          <h1 style={styles.heroH1}>
            Everything You Need to Grow Your Business. <br />
            <span style={styles.heroGradient}>All in One Unified Platform.</span>
          </h1>

          <p style={styles.heroSubhead}>
            Stop juggling 8 different subscriptions and fragile third-party connectors. Operza unifies your client CRM,
            intuitive 2D visual workflows, high-converting funnels, omnichannel messaging, and Miss Minutes AI Copilot into a
            single high-performance system.
          </p>

          <div style={styles.heroActions}>
            <Link
              to="/signup"
              style={styles.heroBtnPrimary}
              onClick={() => trackEvent('signup_start', { source: 'hero_primary' })}
            >
              Start 7-Day Free Trial →
            </Link>
            <Link
              to="/platform/automation"
              style={styles.heroBtnSecondary}
              onClick={() => trackEvent('cta_click', { cta: 'hero_explore_canvas' })}
            >
              <Icon name="play" size={15} /> Explore Visual Workflows
            </Link>
          </div>

          <div style={styles.trustRow}>
            <span>✓ No credit card required</span>
            <span>✓ 7-day full access trial</span>
            <span>✓ Strict PostgreSQL RLS multi-tenancy</span>
            <span>✓ White-label CNAME ready</span>
          </div>

          {/* Interactive Hero Platform Preview */}
          <div style={styles.heroPreviewWrap}>
            <div style={styles.heroMockupWindow}>
              {/* Window Header */}
              <div style={styles.mockupTitleBar}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444' }} />
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} />
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981' }} />
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', fontFamily: 'monospace' }}>
                  operza.app/workspace/workflows/lead-accelerator
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={styles.badgeSuccess}>● System Live</span>
                </div>
              </div>

              {/* Window Canvas / Workflow Graphic */}
              <div style={styles.mockupContent}>
                <div style={styles.mockupSidebar}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#f8fafc', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="sparkles" size={14} style={{ color: '#ff6d5a' }} /> Operza Workspace
                  </div>
                  {['Dashboard', 'Copilot AI', 'Visual Workflows', 'Funnels & Pages', 'CRM Contacts', 'Pipeline Deals'].map((tab, i) => (
                    <div
                      key={tab}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 6,
                        fontSize: 12,
                        color: i === 2 ? '#ffffff' : '#94a3b8',
                        background: i === 2 ? 'rgba(255, 109, 90, 0.2)' : 'transparent',
                        fontWeight: i === 2 ? 600 : 400,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: i === 2 ? '#ff6d5a' : '#475569' }} />
                      {tab}
                    </div>
                  ))}
                </div>

                <div style={styles.mockupCanvas}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                    <div>
                      <strong style={{ fontSize: 14, color: '#f8fafc' }}>Workflow: Inbound Lead to Closed Retainer</strong>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>Durable BullMQ execution engine · 1,482 runs this week</div>
                    </div>
                    <span style={{ fontSize: 11, background: '#1e293b', padding: '4px 8px', borderRadius: 6, color: '#38bdf8', border: '1px solid #334155' }}>
                      ⚡ 100% Deterministic Walk
                    </span>
                  </div>

                  <div style={styles.workflowNodesRow}>
                    <div style={styles.workflowNodeCard}>
                      <div style={styles.nodeHeader}><Icon name="target" size={13} /> Trigger: Form Opt-in</div>
                      <div style={styles.nodeBody}>New Lead Captured on VIP Masterclass Funnel</div>
                    </div>
                    <div style={styles.nodeArrow}>→</div>
                    <div style={styles.workflowNodeCard}>
                      <div style={styles.nodeHeader}><Icon name="sparkles" size={13} /> AI Lead Enrichment</div>
                      <div style={styles.nodeBody}>Score: 92/100 (Enterprise Tier Verified)</div>
                    </div>
                    <div style={styles.nodeArrow}>→</div>
                    <div style={styles.workflowNodeCard}>
                      <div style={styles.nodeHeader}><Icon name="message" size={13} /> Twilio SMS &amp; Calendar</div>
                      <div style={styles.nodeBody}>Dispatched Instant Booking Invitation Link</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 2. SOCIAL PROOF / TRUSTED BY LOGOS ─── */}
      <section style={styles.socialProofSection}>
        <div style={styles.container}>
          <div style={styles.socialProofLabel}>
            TRUSTED BY OVER 10,000+ HIGH-GROWTH BUSINESSES &amp; DIGITAL AGENCIES
          </div>
          <div style={styles.logosRow}>
            {['Apex Digital Media', 'HyperScale Ventures', 'Vanguard Health Partners', 'Nova Retail Group', 'Sovereign Capital', 'CloudScale Dynamics'].map((name) => (
              <div key={name} style={styles.logoItem}>
                <span style={{ fontWeight: 800, letterSpacing: '-0.02em', fontSize: 15, opacity: 0.85 }}>
                  {name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 3. PROBLEM VS SOLUTION ─── */}
      <section style={styles.section}>
        <div style={styles.container}>
          <div style={styles.sectionHead}>
            <span style={styles.sectionTag}>THE MODERN DILEMMA</span>
            <h2 style={styles.sectionH2}>The Traditional Software Stack is Broken</h2>
            <p style={styles.sectionSub}>
              Modern businesses lose hundreds of hours and thousands of dollars every month fighting fragmented tools.
            </p>
          </div>

          <div style={styles.grid2}>
            {/* Before Operza */}
            <div style={{ ...styles.comparisonCard, borderLeft: '4px solid #ef4444' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ color: '#ef4444', fontWeight: 800, fontSize: 18 }}>✕</span>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                  Before Operza: The Fragmented Nightmare
                </h3>
              </div>
              <ul style={styles.comparisonList}>
                <li><strong>$1,800+/month</strong> spent on 8 disparate software subscriptions and fragmented point solutions.</li>
                <li><strong>Fragile Webhook Syncs</strong>: Data drops when integrations fail, causing missed customer leads and lost revenue.</li>
                <li><strong>Per-Seat Penalty Pricing</strong>: Added seats eat your margins as your team and client base expands.</li>
                <li><strong>Cross-Tenant Data Leaks</strong>: High risk of agency sub-accounts seeing each other's data without database-level RLS.</li>
                <li><strong>No Real Copilot</strong>: Superficial chat widgets that cannot execute real business actions in your CRM.</li>
              </ul>
            </div>

            {/* After Operza */}
            <div style={{ ...styles.comparisonCard, borderLeft: '4px solid #10b981', background: '#f0fdf4' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ color: '#10b981', fontWeight: 800, fontSize: 18 }}>✓</span>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                  With Operza: The All-in-One Engine
                </h3>
              </div>
              <ul style={styles.comparisonList}>
                <li><strong>One Flat Subscription</strong>: Replaces your entire stack for a fraction of the cost with zero per-seat penalties.</li>
                <li><strong>Durable BullMQ Engine</strong>: Redis-backed queue ensures zero dropped events with automated retry backoff.</li>
                <li><strong>Strict PostgreSQL RLS</strong>: Fail-closed Row-Level Security guarantees 100% isolation between agency workspaces.</li>
                <li><strong>Visual Journey Funnels</strong>: Complete funnel builder with step conversion drop-off tracking and 1-click order bumps.</li>
                <li><strong>Miss Minutes AI Copilot</strong>: Autonomous assistant that executes real CRM mutations and analyzes your business.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 4. PRODUCT ECOSYSTEM (8 CORE MODULES) ─── */}
      <section style={styles.sectionAlt}>
        <div style={styles.container}>
          <div style={styles.sectionHead}>
            <span style={styles.sectionTag}>OPERZA SUITE</span>
            <h2 style={styles.sectionH2}>An Entire Ecosystem Engineered for Scale</h2>
            <p style={styles.sectionSub}>
              Every module is natively integrated. No messy glue code, no third-party middleware.
            </p>
          </div>

          <div style={styles.grid4}>
            {[
              {
                icon: 'users',
                title: 'Multi-Tenant CRM',
                desc: 'Kanban deals, custom fields, weighted pipelines, and Row-Level Security isolation.',
              },
              {
                icon: 'zap',
                title: '2D Visual Workflows',
                desc: 'Intuitive 2D node canvas, conditional branching, approval gates, and durable BullMQ queues.',
              },
              {
                icon: 'funnel',
                title: 'Funnels & Checkouts',
                desc: 'Visual multi-step journey, drop-off rate analytics, 1-click order bumps, and custom domains.',
              },
              {
                icon: 'sparkles',
                title: 'Miss Minutes AI',
                desc: 'TVA-inspired autonomous business operator that answers queries and runs CRM tools.',
              },
              {
                icon: 'message',
                title: 'Omnichannel Stream',
                desc: 'Twilio SMS, WhatsApp Cloud API, Email, and live WebSockets in one unified conversation view.',
              },
              {
                icon: 'calendar',
                title: 'Calendar & Booking',
                desc: 'Automated appointment slots, round-robin distribution, and two-way Google Calendar sync.',
              },
              {
                icon: 'wallet',
                title: 'Store & Payments',
                desc: 'Stripe merchant gateway, recurring subscriptions, digital invoicing, and coupons.',
              },
              {
                icon: 'chart',
                title: 'Telemetry & Analytics',
                desc: 'Comprehensive revenue attribution, team efficiency, and funnel drop-off diagnostics.',
              },
            ].map((m) => (
              <div key={m.title} style={styles.moduleCard}>
                <div style={styles.moduleIcon}>
                  <Icon name={m.icon} size={20} />
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px', color: '#0f172a' }}>{m.title}</h3>
                <p style={{ fontSize: 13, color: '#64748b', margin: 0, lineHeight: 1.5 }}>{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 5. INTERACTIVE WORKFLOW SHOWCASE ─── */}
      <section style={styles.section}>
        <div style={styles.container}>
          <div style={styles.sectionHead}>
            <span style={styles.sectionTag}>WORKFLOW AUTOMATION</span>
            <h2 style={styles.sectionH2}>Build Complex Automations with Ease</h2>
            <p style={styles.sectionSub}>
              Operza gives you a full 2D infinite canvas with cubic bezier wires, branching logic, and human approval gates.
            </p>
          </div>

          <div style={styles.showcaseBox}>
            <div style={styles.showcaseHeader}>
              <div>
                <strong style={{ fontSize: 14 }}>Live 2D Workflow Canvas Engine</strong>
                <div style={{ fontSize: 12, color: '#64748b' }}>Drag, connect, and branch with zero code required</div>
              </div>
              <Link to="/platform/automation" className="btn btn--sm btn--primary">
                Open Workflow Canvas →
              </Link>
            </div>

            <div style={styles.canvasDemoArea}>
              <div style={styles.demoNodeTrigger}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#4f46e5', textTransform: 'uppercase' }}>1. EVENT TRIGGER</div>
                <strong style={{ fontSize: 13 }}>New Client Form Submitted</strong>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Payload: Name, Email, Budget &gt; $5,000</div>
              </div>

              <div style={styles.canvasWire}>↓</div>

              <div style={styles.demoNodeCondition}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#0284c7', textTransform: 'uppercase' }}>2. CONDITIONAL BRANCH</div>
                <strong style={{ fontSize: 13 }}>Is Qualified Enterprise Retainer?</strong>
                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  <span style={{ fontSize: 11, background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: 4 }}>
                    YES: Deal Value &ge; $5,000
                  </span>
                  <span style={{ fontSize: 11, background: '#f1f5f9', color: '#64748b', padding: '2px 8px', borderRadius: 4 }}>
                    NO: Self-Serve Drip
                  </span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, width: '100%', maxWidth: 620, marginTop: 12 }}>
                <div style={styles.demoNodeAction}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#0f766e', textTransform: 'uppercase' }}>Branch A (High Value)</div>
                  <strong style={{ fontSize: 12.5 }}>Notify Managing Partner &amp; SMS Lead</strong>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Instant alert via Twilio + VIP booking calendar</div>
                </div>
                <div style={styles.demoNodeAction}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#b45309', textTransform: 'uppercase' }}>Branch B (Nurture)</div>
                  <strong style={{ fontSize: 12.5 }}>Enroll in 5-Day Video Onboarding Drip</strong>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Automated SendGrid transactional sequence</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 6. VISUAL FUNNEL BUILDER SHOWCASE ─── */}
      <section style={styles.sectionAlt}>
        <div style={styles.container}>
          <div style={styles.sectionHead}>
            <span style={styles.sectionTag}>CONVERSION FUNNELS</span>
            <h2 style={styles.sectionH2}>Visual Funnel Journeys with Instant Drop-Off Tracking</h2>
            <p style={styles.sectionSub}>
              Map every visitor touchpoint from ad click to high-ticket order confirmation. Add 1-click impulse bumps that boost AOV by 35%.
            </p>
          </div>

          <div style={styles.funnelStepsShowcase}>
            {[
              { step: '01', title: 'Opt-in Page', path: '/free-masterclass', rate: '1,420 visits', drop: '44% conversion', color: '#4f46e5' },
              { step: '02', title: 'Sales VSL', path: '/vip-offer', rate: '625 views', drop: '32% proceed', color: '#0ea5e9' },
              { step: '03', title: 'Checkout & Bump', path: '/order-secure', rate: '200 orders', drop: '28% bump acceptance', color: '#10b981' },
              { step: '04', title: 'Thank You', path: '/confirmation', rate: '200 confirmed', drop: '100% onboarded', color: '#8b5cf6' },
            ].map((st) => (
              <div key={st.step} style={styles.funnelStepBox}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: st.color }}>STEP {st.step}</span>
                  <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#64748b' }}>{st.path}</span>
                </div>
                <h4 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: '0 0 6px' }}>{st.title}</h4>
                <div style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>{st.rate}</div>
                <div style={{ fontSize: 11.5, color: '#0f9d6e', marginTop: 4 }}>✓ {st.drop}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 7. MISS MINUTES AI COPILOT SHOWCASE ─── */}
      <section style={styles.section}>
        <div style={styles.container}>
          <div style={styles.sectionHead}>
            <span style={styles.sectionTag}>AUTONOMOUS AI ASSISTANT</span>
            <h2 style={styles.sectionH2}>Meet Miss Minutes: Your 24/7 Agency Business Operator</h2>
            <p style={styles.sectionSub}>
              Inspired by the Loki TVA mascot, Miss Minutes is an autonomous business copilot that analyzes your data and executes authorized actions.
            </p>
          </div>

          <div style={styles.grid2}>
            {/* Interactive Prompt Picker */}
            <div style={styles.copilotPromptList}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#64748b', marginBottom: 12, textTransform: 'uppercase' }}>
                Try These Real-World Natural Language Commands:
              </div>
              {copilotPrompts.map((cp, idx) => (
                <div
                  key={idx}
                  onClick={() => setActivePromptIndex(idx)}
                  style={{
                    padding: '14px 18px',
                    borderRadius: 10,
                    border: `1.5px solid ${activePromptIndex === idx ? '#4f46e5' : '#e2e8f0'}`,
                    background: activePromptIndex === idx ? '#eef2ff' : '#ffffff',
                    cursor: 'pointer',
                    marginBottom: 10,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 650, color: '#0f172a' }}>
                    <Icon name="sparkles" size={15} style={{ color: '#4f46e5' }} />
                    "{cp.prompt}"
                  </div>
                </div>
              ))}
            </div>

            {/* Live Assistant Output Card */}
            <div style={styles.copilotLiveCard}>
              <div style={styles.copilotCardHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#ff6d5a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                    <Icon name="sparkles" size={18} />
                  </div>
                  <div>
                    <strong style={{ fontSize: 14, color: '#0f172a' }}>Miss Minutes Copilot</strong>
                    <div style={{ fontSize: 11, color: '#0f9d6e' }}>● Grounded in Real CRM Telemetry</div>
                  </div>
                </div>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: '#e0e7ff', color: '#4338ca', fontWeight: 600 }}>
                  Autonomous Tool Engine
                </span>
              </div>

              <div style={styles.copilotCardBody}>
                <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 8, fontWeight: 600 }}>
                  COMMAND EXECUTED:
                </div>
                <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, color: '#1e293b', marginBottom: 14 }}>
                  "{copilotPrompts[activePromptIndex].prompt}"
                </div>

                <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 8, fontWeight: 600 }}>
                  ASSISTANT RESPONSE &amp; ACTIONS:
                </div>
                <div style={{ background: '#ffffff', padding: '14px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13.5, lineHeight: 1.6, color: '#0f172a' }}>
                  {copilotPrompts[activePromptIndex].result}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 8. INTEGRATIONS GRID ─── */}
      <section style={styles.sectionAlt}>
        <div style={styles.container}>
          <div style={styles.sectionHead}>
            <span style={styles.sectionTag}>NATIVE ECOSYSTEM</span>
            <h2 style={styles.sectionH2}>Connect Your Favorite Mission-Critical Tools</h2>
            <p style={styles.sectionSub}>
              Built-in production integrations with zero middleware overhead. Configure API keys securely per agency tenant.
            </p>
          </div>

          <div style={styles.grid4}>
            {[
              { name: 'Stripe', tag: 'Merchant Payments', desc: 'Credit cards, bank debits, recurring retainers, and 1-click checkout charges.' },
              { name: 'Twilio', tag: 'Voice & SMS', desc: 'Inbound phone numbers, 2-way SMS conversations, IVR call recording, and voice dialing.' },
              { name: 'SendGrid', tag: 'Transactional Email', desc: 'Drip sequences, custom SPF/DKIM verification, and open/click telemetry.' },
              { name: 'OpenAI', tag: 'LLM Intelligence', desc: 'Powers Miss Minutes Copilot with GPT-4o function calling and RAG search.' },
              { name: 'WhatsApp Cloud API', tag: 'Instant Messaging', desc: 'Meta-verified business messaging directly within your unified inbox.' },
              { name: 'Google Calendar', tag: 'Two-Way Sync', desc: 'Real-time booking slots and automated conflict prevention across team calendars.' },
              { name: 'Slack', tag: 'Internal Alerts', desc: 'Instant deal closed notifications, lead alerts, and approval gate webhooks.' },
              { name: 'Developer Webhooks', tag: 'Custom Integrations', desc: 'HMAC-signed outbound event triggers and RESTful API key authentication.' },
            ].map((integ) => (
              <div key={integ.name} style={styles.integCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <strong style={{ fontSize: 15, color: '#0f172a' }}>{integ.name}</strong>
                  <span style={styles.badgeSuccess}>Verified</span>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#4f46e5', display: 'block', marginBottom: 6 }}>
                  {integ.tag}
                </span>
                <p style={{ fontSize: 12.5, color: '#64748b', margin: 0, lineHeight: 1.5 }}>{integ.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 9. USE CASES ─── */}
      <section style={styles.section}>
        <div style={styles.container}>
          <div style={styles.sectionHead}>
            <span style={styles.sectionTag}>TAILORED FOR HIGH PERFORMANCE</span>
            <h2 style={styles.sectionH2}>Who Scales Faster with Operza?</h2>
            <p style={styles.sectionSub}>
              Engineered specifically for teams that require dependable automation, multi-account isolation, and high conversion rates.
            </p>
          </div>

          <div style={styles.grid3}>
            {[
              {
                title: 'Digital Marketing Agencies',
                desc: 'Manage 50+ client sub-accounts from a single console. Clone standard operating procedures with 1-click snapshots and white-label client portals.',
              },
              {
                title: 'Growth Consultancies',
                desc: 'Unify outbound prospecting, discovery call scheduling, digital contract e-signatures, and recurring Stripe retainers in one place.',
              },
              {
                title: 'B2B Sales Teams',
                desc: 'Accelerate deal velocity with automated lead enrichment, multi-stage visual Kanban boards, and Miss Minutes AI prompt assistance.',
              },
              {
                title: 'High-Ticket Course Creators',
                desc: 'Host full video curriculum with DRM protection, deliver automated certificates, and sell upsells with friction-free order forms.',
              },
              {
                title: 'Local Service Businesses',
                desc: 'Missed-call text back via Twilio, automated Google review reputation requests, and frictionless online appointment booking.',
              },
              {
                title: 'E-commerce Brands',
                desc: 'Build dedicated post-purchase upsell funnels, recover abandoned checkouts, and manage VIP customer lists with smart filters.',
              },
            ].map((uc) => (
              <div key={uc.title} style={styles.useCaseCard}>
                <div style={styles.useCaseDot} />
                <h3 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>{uc.title}</h3>
                <p style={{ fontSize: 13.5, color: '#64748b', lineHeight: 1.6, margin: 0 }}>{uc.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 10. TRANSPARENT PRICING ─── */}
      <section style={styles.sectionAlt}>
        <div style={styles.container}>
          <div style={styles.sectionHead}>
            <span style={styles.sectionTag}>SIMPLE &amp; PREDICTABLE</span>
            <h2 style={styles.sectionH2}>Transparent Pricing for Growing Businesses</h2>
            <p style={styles.sectionSub}>
              All plans include complete platform features with zero hidden per-seat traps. Start free for 7 days.
            </p>

            {/* Monthly / Annual Toggle */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, marginTop: 16, background: '#ffffff', padding: '6px 12px', borderRadius: 99, border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: 13, fontWeight: !annualBilling ? 700 : 500, color: !annualBilling ? '#0f172a' : '#64748b' }}>Monthly</span>
              <button
                type="button"
                onClick={() => setAnnualBilling(!annualBilling)}
                style={{
                  width: 44,
                  height: 24,
                  borderRadius: 99,
                  background: '#4f46e5',
                  border: 'none',
                  cursor: 'pointer',
                  position: 'relative',
                  padding: 2,
                }}
              >
                <span
                  style={{
                    display: 'block',
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: '#ffffff',
                    transform: annualBilling ? 'translateX(20px)' : 'translateX(0)',
                    transition: 'transform 0.15s ease',
                  }}
                />
              </button>
              <span style={{ fontSize: 13, fontWeight: annualBilling ? 700 : 500, color: annualBilling ? '#0f172a' : '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
                Annual <span style={{ fontSize: 11, background: '#e0e7ff', color: '#4338ca', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>Save 20%</span>
              </span>
            </div>
          </div>

          <div style={styles.grid3}>
            {/* Tier 1: Starter */}
            <div style={styles.pricingCard}>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px' }}>Starter Agency</h3>
              <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>Perfect for boutique agencies and solo operators</p>
              <div style={{ fontSize: 36, fontWeight: 800, color: '#0f172a', marginBottom: 18 }}>
                ${annualBilling ? '79' : '97'}
                <span style={{ fontSize: 14, fontWeight: 500, color: '#64748b' }}> / month</span>
              </div>
              <ul style={styles.pricingFeatureList}>
                <li>✓ Up to 3 Agency Sub-Accounts</li>
                <li>✓ Unlimited Contacts &amp; Pipeline Deals</li>
                <li>✓ 2D Visual Workflow Canvas (BullMQ)</li>
                <li>✓ 5 Visual Funnels &amp; Order Bumps</li>
                <li>✓ Miss Minutes AI Copilot Included</li>
                <li>✓ Community &amp; Email Support</li>
              </ul>
              <Link to="/signup" style={styles.btnPricingGhost}>
                Start 7-Day Free Trial
              </Link>
            </div>

            {/* Tier 2: Growth (Featured) */}
            <div style={{ ...styles.pricingCard, border: '2px solid #4f46e5', transform: 'scale(1.02)', position: 'relative' }}>
              <div style={styles.pricingPopularBadge}>MOST POPULAR</div>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px' }}>Growth Agency</h3>
              <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>For scaling agencies managing multiple high-ticket clients</p>
              <div style={{ fontSize: 36, fontWeight: 800, color: '#0f172a', marginBottom: 18 }}>
                ${annualBilling ? '239' : '297'}
                <span style={{ fontSize: 14, fontWeight: 500, color: '#64748b' }}> / month</span>
              </div>
              <ul style={styles.pricingFeatureList}>
                <li>✓ Up to 15 Agency Sub-Accounts</li>
                <li>✓ Unlimited Visual Funnels &amp; Pages</li>
                <li>✓ 1-Click Account Snapshot Blueprints</li>
                <li>✓ Custom CNAME &amp; White-Label Branding</li>
                <li>✓ Omnichannel Inbox (SMS, WhatsApp, Email)</li>
                <li>✓ Priority 24/7 Slack &amp; Live Support</li>
              </ul>
              <Link to="/signup" style={styles.btnPricingPrimary}>
                Start 7-Day Free Trial →
              </Link>
            </div>

            {/* Tier 3: Enterprise */}
            <div style={styles.pricingCard}>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px' }}>Enterprise Scale</h3>
              <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>For high-volume multi-location agencies &amp; SaaS builders</p>
              <div style={{ fontSize: 36, fontWeight: 800, color: '#0f172a', marginBottom: 18 }}>
                ${annualBilling ? '399' : '497'}
                <span style={{ fontSize: 14, fontWeight: 500, color: '#64748b' }}> / month</span>
              </div>
              <ul style={styles.pricingFeatureList}>
                <li>✓ Unlimited Agency Sub-Accounts</li>
                <li>✓ Full White-Label Client Portal &amp; Domain</li>
                <li>✓ Docker Self-Hosting License Option</li>
                <li>✓ Dedicated Database Connection Pool</li>
                <li>✓ Custom API Rate Limits &amp; Webhooks</li>
                <li>✓ Dedicated Solutions Architect</li>
              </ul>
              <Link to="/signup" style={styles.btnPricingGhost}>
                Start 7-Day Free Trial
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 11. VERIFIED TESTIMONIALS ─── */}
      <section style={styles.section}>
        <div style={styles.container}>
          <div style={styles.sectionHead}>
            <span style={styles.sectionTag}>REAL-WORLD RESULTS</span>
            <h2 style={styles.sectionH2}>Loved by Fast-Moving Agency Founders</h2>
            <p style={styles.sectionSub}>
              Discover how agencies worldwide replaced bloated SaaS bills with Operza.
            </p>
          </div>

          <div style={styles.grid3}>
            {[
              {
                quote:
                  'We cancelled five separate software subscriptions in one day. Operza saved our agency over $1,200/month while our team workflows run twice as fast.',
                author: 'Marcus Vance',
                role: 'Managing Partner',
                agency: 'HyperScale Media',
                stat: 'Saved 22 hrs/week',
              },
              {
                quote:
                  'The PostgreSQL Row-Level Security was non-negotiable for our enterprise healthcare clients. Zero data leak risk, and Miss Minutes answers our client status inquiries instantly.',
                author: 'Elena Rostova',
                role: 'Director of Technology',
                agency: 'Vanguard Growth Partners',
                stat: '3.4x Revenue Expansion',
              },
              {
                quote:
                  'The 2D visual workflow engine is simply unmatched. Connecting triggers to conditional decision trees with BullMQ durability gives us peace of mind during massive BFCM launches.',
                author: 'David Chen',
                role: 'Founder & CEO',
                agency: 'Apex Commerce Lab',
                stat: '$480k Pipeline Processed',
              },
            ].map((t) => (
              <div key={t.author} style={styles.testimonialCard}>
                <div style={{ color: '#f59e0b', fontSize: 16, marginBottom: 10 }}>★★★★★</div>
                <p style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.6, margin: '0 0 16px', fontStyle: 'italic' }}>
                  "{t.quote}"
                </p>
                <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ display: 'block', fontSize: 13.5, color: '#0f172a' }}>{t.author}</strong>
                    <span style={{ fontSize: 11.5, color: '#64748b' }}>{t.role} · {t.agency}</span>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#0f9d6e', background: '#e6f7f1', padding: '2px 8px', borderRadius: 4 }}>
                    {t.stat}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 12. FREQUENTLY ASKED QUESTIONS (FAQ) ─── */}
      <section style={styles.sectionAlt}>
        <div style={styles.container}>
          <div style={styles.sectionHead}>
            <span style={styles.sectionTag}>QUESTIONS &amp; ANSWERS</span>
            <h2 style={styles.sectionH2}>Frequently Asked Questions</h2>
            <p style={styles.sectionSub}>
              Everything you need to know about Operza’s multi-tenant architecture, integrations, and migration.
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

      {/* ─── 13. FINAL CALL TO ACTION ─── */}
      <section style={styles.ctaBanner}>
        <div style={styles.container}>
          <h2 style={{ fontSize: 34, fontWeight: 800, color: '#ffffff', margin: '0 0 14px' }}>
            Ready to Unify Your Business Operations?
          </h2>
          <p style={{ fontSize: 16, color: '#c7d2fe', maxWidth: 600, margin: '0 auto 28px', lineHeight: 1.6 }}>
            Join thousands of modern agencies and high-velocity teams eliminating software silos with Operza.
            Start your full-featured 7-day trial today with zero risk.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link
              to="/signup"
              style={styles.ctaBtnWhite}
              onClick={() => trackEvent('signup_start', { source: 'bottom_cta' })}
            >
              Start 7-Day Free Trial →
            </Link>
            <Link to="/pricing" style={styles.ctaBtnOutline}>
              Compare All Pricing Tiers
            </Link>
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 18 }}>
            No credit card required · Instant setup in under 2 minutes · Cancel anytime
          </div>
        </div>
      </section>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heroSection: {
    padding: '80px 20px 40px',
    background: 'radial-gradient(ellipse at top, #eef2ff 0%, #ffffff 70%)',
    borderBottom: '1px solid #e2e8f0',
    textAlign: 'center',
  },
  heroContainer: {
    maxWidth: 1040,
    margin: '0 auto',
  },
  heroBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 14px',
    borderRadius: 99,
    background: '#e0e7ff',
    color: '#3730a3',
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: '0.04em',
    marginBottom: 24,
  },
  badgePulse: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#4f46e5',
  },
  heroH1: {
    fontSize: 50,
    fontWeight: 850,
    lineHeight: 1.15,
    letterSpacing: '-0.03em',
    color: '#0f172a',
    margin: '0 0 22px',
  },
  heroGradient: {
    background: 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  heroSubhead: {
    fontSize: 18,
    lineHeight: 1.6,
    color: '#475569',
    maxWidth: 760,
    margin: '0 auto 32px',
  },
  heroActions: {
    display: 'flex',
    gap: 14,
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginBottom: 28,
  },
  heroBtnPrimary: {
    padding: '13px 28px',
    fontSize: 15.5,
    fontWeight: 700,
    color: '#ffffff',
    background: '#4f46e5',
    borderRadius: 10,
    textDecoration: 'none',
    boxShadow: '0 4px 16px rgba(79, 70, 229, 0.4)',
    transition: 'all 0.15s ease',
  },
  heroBtnSecondary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '13px 26px',
    fontSize: 15.5,
    fontWeight: 650,
    color: '#1e293b',
    background: '#ffffff',
    border: '1px solid #cbd5e1',
    borderRadius: 10,
    textDecoration: 'none',
    transition: 'all 0.15s ease',
  },
  trustRow: {
    display: 'flex',
    gap: 22,
    justifyContent: 'center',
    fontSize: 13,
    color: '#64748b',
    flexWrap: 'wrap',
    marginBottom: 44,
  },
  heroPreviewWrap: {
    maxWidth: 960,
    margin: '0 auto',
    boxShadow: '0 25px 60px -15px rgba(15, 23, 42, 0.25)',
    borderRadius: 14,
    overflow: 'hidden',
    border: '1px solid #334155',
  },
  heroMockupWindow: {
    background: '#0f172a',
    textAlign: 'left',
  },
  mockupTitleBar: {
    background: '#1e293b',
    padding: '10px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid #334155',
  },
  mockupContent: {
    display: 'grid',
    gridTemplateColumns: '220px 1fr',
    minHeight: 280,
  },
  mockupSidebar: {
    background: '#0b1120',
    padding: '16px 12px',
    borderRight: '1px solid #1e293b',
  },
  mockupCanvas: {
    padding: '20px',
    background: '#0f172a',
  },
  workflowNodesRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginTop: 18,
    flexWrap: 'wrap',
  },
  workflowNodeCard: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 8,
    padding: '10px 14px',
    flex: 1,
    minWidth: 160,
  },
  nodeHeader: {
    fontSize: 11,
    fontWeight: 700,
    color: '#ff6d5a',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  nodeBody: {
    fontSize: 12,
    color: '#f8fafc',
    lineHeight: 1.4,
  },
  nodeArrow: {
    color: '#64748b',
    fontSize: 18,
    fontWeight: 800,
  },
  socialProofSection: {
    padding: '36px 20px',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
  },
  socialProofLabel: {
    textAlign: 'center',
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: '#64748b',
    marginBottom: 20,
  },
  logosRow: {
    display: 'flex',
    justifyContent: 'center',
    gap: 36,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  logoItem: {
    color: '#475569',
  },
  section: {
    padding: '76px 20px',
  },
  sectionAlt: {
    padding: '76px 20px',
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
    maxWidth: 720,
    margin: '0 auto 44px',
  },
  sectionTag: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: '#4f46e5',
    textTransform: 'uppercase',
  },
  sectionH2: {
    fontSize: 34,
    fontWeight: 800,
    color: '#0f172a',
    letterSpacing: '-0.02em',
    margin: '8px 0 12px',
  },
  sectionSub: {
    fontSize: 15.5,
    color: '#64748b',
    lineHeight: 1.6,
    margin: 0,
  },
  grid2: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 24,
  },
  grid3: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 24,
  },
  grid4: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 20,
  },
  comparisonCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '24px 28px',
  },
  comparisonList: {
    paddingLeft: 18,
    fontSize: 13.5,
    color: '#334155',
    lineHeight: 1.8,
    margin: 0,
  },
  moduleCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '22px 20px',
  },
  moduleIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    background: '#eef2ff',
    color: '#4f46e5',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  showcaseBox: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    padding: 24,
    boxShadow: '0 8px 30px rgba(15, 23, 42, 0.05)',
  },
  showcaseHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #f1f5f9',
    paddingBottom: 16,
    marginBottom: 20,
  },
  canvasDemoArea: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    padding: '20px 0',
  },
  demoNodeTrigger: {
    background: '#eef2ff',
    border: '1.5px solid #c7d2fe',
    borderRadius: 10,
    padding: '12px 20px',
    textAlign: 'center',
    minWidth: 280,
  },
  demoNodeCondition: {
    background: '#f0f9ff',
    border: '1.5px solid #bae6fd',
    borderRadius: 10,
    padding: '12px 20px',
    textAlign: 'center',
    minWidth: 320,
  },
  demoNodeAction: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: '12px 16px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
  },
  canvasWire: {
    fontSize: 20,
    color: '#94a3b8',
    fontWeight: 800,
  },
  funnelStepsShowcase: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 16,
  },
  funnelStepBox: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '20px 18px',
    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.04)',
  },
  copilotPromptList: {
    display: 'flex',
    flexDirection: 'column',
  },
  copilotLiveCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    overflow: 'hidden',
    boxShadow: '0 8px 30px rgba(15, 23, 42, 0.05)',
  },
  copilotCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 18px',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
  },
  copilotCardBody: {
    padding: '18px',
  },
  integCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: '16px 18px',
  },
  useCaseCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '24px 22px',
  },
  useCaseDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#4f46e5',
    marginBottom: 12,
  },
  pricingCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    padding: '28px 24px',
    display: 'flex',
    flexDirection: 'column',
  },
  pricingPopularBadge: {
    position: 'absolute',
    top: -12,
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#4f46e5',
    color: '#ffffff',
    fontSize: 10.5,
    fontWeight: 800,
    letterSpacing: '0.06em',
    padding: '3px 12px',
    borderRadius: 99,
  },
  pricingFeatureList: {
    paddingLeft: 0,
    listStyle: 'none',
    fontSize: 13,
    color: '#334155',
    lineHeight: 2,
    margin: '0 0 24px',
    flex: 1,
  },
  btnPricingPrimary: {
    display: 'block',
    textAlign: 'center',
    padding: '12px 20px',
    borderRadius: 8,
    background: '#4f46e5',
    color: '#ffffff',
    fontWeight: 700,
    fontSize: 14,
    textDecoration: 'none',
    boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)',
  },
  btnPricingGhost: {
    display: 'block',
    textAlign: 'center',
    padding: '12px 20px',
    borderRadius: 8,
    background: '#f8fafc',
    color: '#0f172a',
    border: '1px solid #cbd5e1',
    fontWeight: 650,
    fontSize: 14,
    textDecoration: 'none',
  },
  testimonialCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '22px 20px',
    boxShadow: '0 4px 16px rgba(15, 23, 42, 0.03)',
  },
  badgeSuccess: {
    background: '#e6f7f1',
    color: '#0f9d6e',
    padding: '2px 8px',
    borderRadius: 99,
    fontSize: 11,
    fontWeight: 600,
  },
  faqList: {
    maxWidth: 820,
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
    padding: '76px 20px',
    textAlign: 'center',
  },
  ctaBtnWhite: {
    padding: '13px 28px',
    borderRadius: 9,
    background: '#ffffff',
    color: '#4338ca',
    fontSize: 15,
    fontWeight: 700,
    textDecoration: 'none',
    boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
  },
  ctaBtnOutline: {
    padding: '13px 26px',
    borderRadius: 9,
    background: 'transparent',
    color: '#ffffff',
    border: '1px solid rgba(255,255,255,0.3)',
    fontSize: 15,
    fontWeight: 600,
    textDecoration: 'none',
  },
};
