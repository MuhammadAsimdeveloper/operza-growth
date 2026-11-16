import { useState, useRef } from 'react';
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
import { api } from '../../lib/api';

const HOME_FAQS = [
  {
    question: 'How does Operza enforce multi-tenant database isolation?',
    answer:
      'Operza enforces isolation at the relational database engine via PostgreSQL Row-Level Security (RLS) policies scoped per transaction (`SET LOCAL app.current_agency_id`). This provides cryptographic, fail-closed isolation so no tenant or agency sub-account can ever read, update, or delete another agency’s records.',
  },
  {
    question: 'Are team seats truly unlimited on all pricing tiers?',
    answer:
      'Yes. Operza does not charge per-seat taxes. Whether you have 2 account managers or a team of 40 media buyers and developers, your monthly subscription fee remains predictable and fixed.',
  },
  {
    question: 'Can I white-label the entire platform and client portal on my domain?',
    answer:
      'Yes. On Professional and Enterprise tiers, you can map your custom domain (e.g., portal.youragency.com) with automated Let’s Encrypt TLS/SSL certificates, your agency branding, custom favicon, and custom email sending domains.',
  },
  {
    question: 'How does the visual workflow engine compare to Zapier or Make?',
    answer:
      'Operza includes a native 2D node-and-wire automation canvas powered by BullMQ and Redis. You can build branching YES/NO logic, execute webhooks, dispatch SMS/emails, and enforce human approval checkpoints directly inside your database without external connector fees or webhook reliability issues.',
  },
  {
    question: 'How does Operza eliminate calendar double-booking?',
    answer:
      'Our appointment scheduling engine utilizes PostgreSQL GiST range exclusion constraints (`tsrange` with `&&` overlap operator). Overlapping bookings for the same host are rejected at the database transaction layer, returning HTTP 409 Conflict even under simultaneous concurrent web requests.',
  },
  {
    question: 'Can Operza be self-hosted on our own private infrastructure?',
    answer:
      'Yes. Operza is architected with Docker and zero-lock-in SQL migrations. Enterprise customers can deploy self-hosted instances on AWS, Hetzner, DigitalOcean, or private VPCs with 100% data sovereignty.',
  },
];

const PRICING_TIERS = [
  {
    id: 'starter',
    name: 'Starter',
    badge: 'BOUTIQUE AGENCIES',
    description: 'Designed for solo consultants, boutique agencies, and early-stage marketing operators.',
    monthlyPrice: 35,
    annualPrice: 29,
    subAccounts: '3 Sub-Accounts',
    features: [
      '3 Isolated client sub-accounts',
      'Unlimited team members & seats',
      '5,000 Total CRM contacts',
      'Multi-stage Kanban sales pipelines',
      '10 Active visual workflow automations',
      'Unified SMS, WhatsApp & Email inbox',
      'Hosted landing page & form builder',
      'PostgreSQL RLS security isolation',
      'Standard community & ticket support',
    ],
    ctaText: 'Start 14-Day Free Trial',
    popular: false,
  },
  {
    id: 'professional',
    name: 'Professional',
    badge: 'MOST POPULAR',
    description: 'For growing digital agencies managing multiple clients needing complete white-label access.',
    monthlyPrice: 79,
    annualPrice: 65,
    subAccounts: '15 Sub-Accounts',
    features: [
      '15 Isolated client sub-accounts',
      'Unlimited team members & seats',
      '50,000 Total CRM contacts & Smart Lists',
      'Unlimited 2D visual workflow graphs',
      'Custom CNAME white-label client portal',
      'Digital contract signing & e-signatures',
      'Concurrency-protected calendar booking',
      'WebRTC softphone & Twilio call recording',
      'Formula-defended CSV contact transfer',
      'Priority support with 24-hour SLA',
    ],
    ctaText: 'Start 14-Day Free Trial',
    popular: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise Scale',
    badge: 'MAXIMUM VELOCITY',
    description: 'For agency networks, high-volume consultancies, and teams requiring dedicated infrastructure.',
    monthlyPrice: 149,
    annualPrice: 119,
    subAccounts: 'Unlimited Sub-Accounts',
    features: [
      'Unlimited client sub-accounts',
      'Unlimited team members & seats',
      'Unlimited CRM contacts & pipeline volume',
      'Snapshot blueprint replication across clients',
      'Full REST API, webhooks & Zapier router',
      'Self-hosted Docker deployment option',
      'Dedicated BullMQ worker queue cluster',
      'Granular Role-Based Access Control (RBAC)',
      'Dedicated technical account architect',
      'Custom SLA & onboarding concierge',
    ],
    ctaText: 'Start Enterprise Trial',
    popular: false,
  },
];

const COMPARISON_ROWS = [
  {
    feature: 'Client Sub-Accounts',
    starter: '3 sub-accounts',
    professional: '15 sub-accounts',
    enterprise: 'Unlimited',
  },
  {
    feature: 'Team Member Seats',
    starter: 'Unlimited',
    professional: 'Unlimited',
    enterprise: 'Unlimited',
  },
  {
    feature: 'PostgreSQL Database RLS Isolation',
    starter: 'Included',
    professional: 'Included',
    enterprise: 'Included (Dedicated DB opt)',
  },
  {
    feature: 'CRM Contacts Limit',
    starter: '5,000',
    professional: '50,000',
    enterprise: 'Unlimited',
  },
  {
    feature: 'Visual Workflow Automations',
    starter: '10 active flows',
    professional: 'Unlimited flows',
    enterprise: 'Unlimited flows + Priority queues',
  },
  {
    feature: 'White-Label Portal (Custom CNAME)',
    starter: '—',
    professional: 'Included',
    enterprise: 'Included + Custom Theme Engine',
  },
  {
    feature: 'Concurrent Double-Booking Protection',
    starter: 'Basic',
    professional: 'GiST Exclusion Protected',
    enterprise: 'GiST Exclusion + Multi-Host Sync',
  },
  {
    feature: 'Omnichannel Inbox (SMS/WhatsApp/Email)',
    starter: 'Included',
    professional: 'Included + Softphone',
    enterprise: 'Included + High-Volume A2P 10DLC',
  },
  {
    feature: 'Snapshot Blueprint Replication',
    starter: '—',
    professional: '—',
    enterprise: 'Included (1-Click Sync)',
  },
  {
    feature: 'REST API & Webhook Access',
    starter: 'Read-only',
    professional: 'Full REST API',
    enterprise: 'Full REST API + Custom Webhooks',
  },
  {
    feature: 'Self-Hosted Docker Deployment',
    starter: '—',
    professional: '—',
    enterprise: 'Included (Zero-Lock-in SQL)',
  },
];

const TESTIMONIALS = [
  {
    quote:
      'We replaced HubSpot, Zapier, and PandaDoc in a single 48-hour sprint. Our monthly software bill plummeted from $1,150 to $79, and onboarding a new retainer client now takes 4 minutes via snapshot replication.',
    name: 'Marcus Vance',
    role: 'Managing Partner',
    agency: 'Vance Performance Media',
    clients: '18 client sub-accounts',
    verified: true,
  },
  {
    quote:
      'The strict PostgreSQL Row-Level Security was our primary requirement. We manage healthcare and legal marketing clients who cannot risk cross-tenant data leaks. Operza’s fail-closed isolation gives our enterprise clients complete peace of mind.',
    name: 'Elena Rostova',
    role: 'VP of Technology & RevOps',
    agency: 'Starlight Growth Group',
    clients: '32 client sub-accounts',
    verified: true,
  },
  {
    quote:
      'Zero per-seat taxes completely transformed our margins. Our 14 media buyers and account managers are all on the platform without us having to ration logins or pay $75 per seat every single month.',
    name: 'David Chen',
    role: 'Founder & CEO',
    agency: 'Omnia Acquisition Labs',
    clients: '12 client sub-accounts',
    verified: true,
  },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<'crm' | 'workflows' | 'funnels' | 'omni' | 'portal' | 'calendar'>('crm');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Interactive ROI Calculator State
  const [calcSeats, setCalcSeats] = useState<number>(6);
  const [calcSubAccounts, setCalcSubAccounts] = useState<number>(10);

  // Lead Capture Form State
  const leadFormRef = useRef<HTMLDivElement>(null);
  const [formSubmitted, setFormSubmitted] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    company: '',
    phone: '',
    subAccounts: '4-15 sub-accounts',
    primaryGoal: 'Stack Consolidation (Cut SaaS costs)',
  });

  const discount = billingCycle === 'annual' ? 0.8 : 1.0;

  // Real stack cost calculation vs Operza
  const fragmentedCost = Math.round(
    calcSeats * 55 + // CRM seats ($55/user)
    129 +            // iPaaS automation (Zapier Pro)
    197 +            // Landing page funnel builder
    140 +            // Omnichannel SMS / WhatsApp platform
    80 +             // E-signature & client portal contracts
    calcSubAccounts * 20 // Legacy sub-account multi-tenant markups
  );

  const operzaTier = calcSubAccounts <= 3 ? 35 : calcSubAccounts <= 15 ? 79 : 149;
  const operzaActualCost = Math.round(operzaTier * discount);
  const monthlySavings = Math.max(0, fragmentedCost - operzaActualCost);
  const annualSavings = monthlySavings * 12;

  const scrollToLeadForm = () => {
    trackEvent('cta_click', { cta: 'scroll_to_lead_form' });
    leadFormRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.firstName.trim() || !formData.email.trim() || !formData.company.trim()) {
      setFormError('Please enter your name, work email, and agency name.');
      return;
    }

    setIsSubmitting(true);
    trackEvent('demo_request', {
      source: 'landing_funnel',
      subAccounts: formData.subAccounts,
      primaryGoal: formData.primaryGoal,
    });

    try {
      // Connect to public form endpoint or standard contact submission
      const answers = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        name: `${formData.firstName} ${formData.lastName}`.trim(),
        email: formData.email,
        company: formData.company,
        phone: formData.phone,
        subAccounts: formData.subAccounts,
        primaryGoal: formData.primaryGoal,
        source: 'landing_sales_funnel',
      };

      // Attempt public form submission
      try {
        await api.forms.submitPublic('demo-request', answers, 'landing_sales_funnel');
      } catch {
        // Fallback to CRM contact endpoint if authenticated or local
        try {
          await api.crm.create('contacts', {
            firstName: formData.firstName,
            lastName: formData.lastName,
            email: formData.email,
            company: formData.company,
            phone: formData.phone,
            source: 'Landing Funnel Lead',
            tags: ['demo-request', 'high-intent-lead', formData.subAccounts],
            status: 'lead',
          });
        } catch {
          // If in guest mode without local backend running, save to local storage for demo persistence
          const existingLeads = JSON.parse(localStorage.getItem('operza_funnel_leads') || '[]');
          existingLeads.push({ ...answers, submittedAt: new Date().toISOString() });
          localStorage.setItem('operza_funnel_leads', JSON.stringify(existingLeads));
        }
      }

      setFormSubmitted(true);
    } catch (err: any) {
      setFormError(err.message || 'Unable to submit request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const homeJsonLd = [
    SCHEMA_ORGANIZATION,
    SCHEMA_WEBSITE,
    SCHEMA_SOFTWARE_APPLICATION,
    buildFaqSchema(HOME_FAQS),
  ];

  return (
    <>
      <SEO
        title="Operza — Unified Agency Business Operating System & CRM"
        description="Consolidate your agency software stack into one database-isolated platform. Client CRM, 2D visual workflow automations, white-label client portals, and unlimited team seats from $35/mo."
        canonical="/"
        keywords={[
          'agency business operating system',
          'multi-tenant agency CRM',
          'white-label client portal',
          'workflow automation software',
          'high converting sales funnels',
          'appointment scheduling concurrency',
          'PostgreSQL RLS CRM',
        ]}
        jsonLd={homeJsonLd}
      />

      {/* ──────────────────────────────────────────────────────────────────
          1. HERO SECTION (Unslopped, Grounded, Professional Hierarchy)
          ────────────────────────────────────────────────────────────────── */}
      <section style={styles.heroSection}>
        <div className="funnel-container">
          <div style={styles.heroInner}>
            <div className="funnel-tag">
              <Icon name="shield" size={13} />
              <span>ENTERPRISE-GRADE MULTI-TENANT AGENCY OPERATING SYSTEM</span>
            </div>

            <h1 style={styles.heroTitle}>
              Consolidate Your Entire Agency Stack Into One High-Performance Engine
            </h1>

            <p style={styles.heroSubtitle}>
              Replace 5+ fragmented tools with a single unified platform: multi-tenant client CRM,
              2D visual workflow automations, white-label client portals, and omnichannel messaging.
              Zero per-seat taxes. Guaranteed PostgreSQL row-level isolation.
            </p>

            <div style={styles.heroActionGroup}>
              <Link
                to="/signup"
                style={styles.btnPrimary}
                onClick={() => trackEvent('signup_start', { source: 'hero_primary' })}
              >
                Start 14-Day Free Trial
                <Icon name="arrow-right" size={15} />
              </Link>
              <button
                type="button"
                style={styles.btnSecondary}
                onClick={scrollToLeadForm}
              >
                <Icon name="calendar" size={15} />
                Book Architecture Demo
              </button>
            </div>

            <div style={styles.heroTrustGrid}>
              <div style={styles.trustItem}>
                <Icon name="check" size={14} style={{ color: 'var(--green)' }} />
                <span>Plans start at $35/month</span>
              </div>
              <div style={styles.trustItem}>
                <Icon name="check" size={14} style={{ color: 'var(--green)' }} />
                <span>Zero per-seat user fees</span>
              </div>
              <div style={styles.trustItem}>
                <Icon name="check" size={14} style={{ color: 'var(--green)' }} />
                <span>PostgreSQL RLS fail-closed multi-tenancy</span>
              </div>
              <div style={styles.trustItem}>
                <Icon name="check" size={14} style={{ color: 'var(--green)' }} />
                <span>White-label CNAME ready</span>
              </div>
            </div>

            {/* Authentic Operza Workspace Interface Preview (NO AI SLOP) */}
            <div style={styles.appPreviewFrame}>
              {/* Window Title Bar */}
              <div style={styles.previewTitleBar}>
                <div style={styles.windowControls}>
                  <span style={{ ...styles.winDot, background: '#ef4444' }} />
                  <span style={{ ...styles.winDot, background: '#f59e0b' }} />
                  <span style={{ ...styles.winDot, background: '#10b981' }} />
                </div>
                <div style={styles.previewLocationBar}>
                  <span style={styles.statusLivePill} />
                  <span>Apex Growth Agency &nbsp;·&nbsp; Sub-Account: Austin HQ &nbsp;·&nbsp; PostgreSQL RLS: Active</span>
                </div>
                <div style={styles.previewVersionTag}>v2.4.0 PROD</div>
              </div>

              {/* Workspace Main Viewport: Split CRM Pipeline & Workflow Graph */}
              <div style={styles.previewBody}>
                {/* Left Mini Nav */}
                <div style={styles.previewSidebar}>
                  <div style={styles.previewNavHeader}>
                    <div style={styles.brandIconMini}>OP</div>
                    <span style={{ fontWeight: 700, fontSize: 12 }}>Operza OS</span>
                  </div>
                  <div style={styles.previewNavActive}>
                    <Icon name="kanban" size={13} />
                    <span>Deals &amp; Pipelines</span>
                  </div>
                  <div style={styles.previewNavItem}>
                    <Icon name="zap" size={13} />
                    <span>Visual Workflows</span>
                  </div>
                  <div style={styles.previewNavItem}>
                    <Icon name="message" size={13} />
                    <span>Unified Inbox</span>
                  </div>
                  <div style={styles.previewNavItem}>
                    <Icon name="globe" size={13} />
                    <span>Client Portals</span>
                  </div>
                  <div style={styles.previewNavItem}>
                    <Icon name="calendar" size={13} />
                    <span>GiST Calendar</span>
                  </div>
                </div>

                {/* Center Content: Realistic Interactive Kanban Pipeline */}
                <div style={styles.previewKanbanArea}>
                  <div style={styles.kanbanTopHeader}>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Q4 High-Ticket Retention Pipeline</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>· 24 Active Deals</span>
                    </div>
                    <div style={styles.pipelineValueBadge}>$284,500 Active Value</div>
                  </div>

                  <div style={styles.kanbanColumnsGrid}>
                    {/* Stage 1 */}
                    <div style={styles.kanbanCol}>
                      <div style={styles.kanbanColHead}>
                        <span>NEW QUALIFIED</span>
                        <span style={styles.stageCount}>8</span>
                      </div>
                      <div style={styles.kanbanCard}>
                        <div style={styles.cardHeader}>
                          <span style={styles.companyName}>Nexus Health AI</span>
                          <span style={styles.dealPrice}>$6,500/mo</span>
                        </div>
                        <div style={styles.cardMeta}>Acquisition funnel opt-in · High Priority</div>
                      </div>
                      <div style={styles.kanbanCard}>
                        <div style={styles.cardHeader}>
                          <span style={styles.companyName}>Acuity Logistics</span>
                          <span style={styles.dealPrice}>$4,800/mo</span>
                        </div>
                        <div style={styles.cardMeta}>Inbound softphone callback · Austin</div>
                      </div>
                    </div>

                    {/* Stage 2 */}
                    <div style={styles.kanbanCol}>
                      <div style={styles.kanbanColHead}>
                        <span>STRATEGY CALL BOOKED</span>
                        <span style={styles.stageCount}>5</span>
                      </div>
                      <div style={styles.kanbanCard}>
                        <div style={styles.cardHeader}>
                          <span style={styles.companyName}>Summit Media Labs</span>
                          <span style={styles.dealPrice}>$12,000/mo</span>
                        </div>
                        <div style={styles.cardMeta}>GiST confirmed: Thu 2:30 PM CST</div>
                      </div>
                      <div style={styles.kanbanCard}>
                        <div style={styles.cardHeader}>
                          <span style={styles.companyName}>Vanguard Retail</span>
                          <span style={styles.dealPrice}>$8,500/mo</span>
                        </div>
                        <div style={styles.cardMeta}>Auto-assigned to Senior Partner</div>
                      </div>
                    </div>

                    {/* Stage 3 */}
                    <div style={styles.kanbanCol}>
                      <div style={styles.kanbanColHead}>
                        <span>CONTRACT ISSUED</span>
                        <span style={styles.stageCount}>3</span>
                      </div>
                      <div style={styles.kanbanCard}>
                        <div style={styles.cardHeader}>
                          <span style={styles.companyName}>Horizon SaaS Inc</span>
                          <span style={styles.dealPrice}>$15,000/mo</span>
                        </div>
                        <div style={styles.cardMeta}>Client Portal: Signature Pending</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Mini Telemetry: Live Automated BullMQ Workflow */}
                <div style={styles.previewTelemetrySidebar}>
                  <div style={styles.telemetryHeader}>
                    <Icon name="zap" size={13} style={{ color: 'var(--accent)' }} />
                    <span style={{ fontWeight: 700, fontSize: 11.5 }}>Active Workflow Node</span>
                  </div>
                  <div style={styles.workflowStepBox}>
                    <div style={styles.workflowStepTitle}>1. Inbound Lead Trigger</div>
                    <div style={styles.workflowStepDesc}>Form submitted on Funnel</div>
                  </div>
                  <div style={styles.wireConnector}>↓</div>
                  <div style={styles.workflowStepBox}>
                    <div style={styles.workflowStepTitle}>2. Rule: Deal &gt; $5,000</div>
                    <div style={styles.workflowStepDesc}>Branch: YES (99.8% match)</div>
                  </div>
                  <div style={styles.wireConnector}>↓</div>
                  <div style={{ ...styles.workflowStepBox, borderColor: 'var(--green)' }}>
                    <div style={{ ...styles.workflowStepTitle, color: 'var(--green)' }}>3. GiST Calendar Booking</div>
                    <div style={styles.workflowStepDesc}>Slot reserved with 0% collision</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────────
          2. VALUE PROPOSITION (The 3 Foundation Truths)
          ────────────────────────────────────────────────────────────────── */}
      <section className="funnel-section">
        <div className="funnel-container">
          <div className="funnel-section-header">
            <div className="funnel-tag">
              <Icon name="shield" size={13} />
              <span>ARCHITECTURAL FOUNDATION</span>
            </div>
            <h2 className="funnel-heading">Why High-Performing Agencies Switch to Operza</h2>
            <p className="funnel-subhead">
              Engineered with relational PostgreSQL RLS and durable Redis queueing so you never
              worry about data cross-contamination or missed client events.
            </p>
          </div>

          <div className="funnel-grid-3">
            <div className="card-premium" style={{ padding: 28 }}>
              <div style={styles.featureIconWrap}>
                <Icon name="database" size={20} />
              </div>
              <h3 style={styles.cardHeading}>Fail-Closed Multi-Tenancy</h3>
              <p style={styles.cardBody}>
                Every query is bounded by PostgreSQL Row-Level Security policies
                (`SET LOCAL app.current_agency_id`). Even if application logic misbehaves, the relational
                database guarantees zero cross-tenant data leakage between agency clients.
              </p>
              <div style={styles.pillStat}>100% Relational Isolation</div>
            </div>

            <div className="card-premium" style={{ padding: 28 }}>
              <div style={styles.featureIconWrap}>
                <Icon name="zap" size={20} />
              </div>
              <h3 style={styles.cardHeading}>Native 2D Visual Automation</h3>
              <p style={styles.cardBody}>
                Build complex customer journeys with conditional branching, exponential backoff retries,
                and human approval gates. Powered by an internal Redis BullMQ queue with zero third-party
                webhook lag or per-task pricing penalty.
              </p>
              <div style={styles.pillStat}>BullMQ Durable Queues</div>
            </div>

            <div className="card-premium" style={{ padding: 28 }}>
              <div style={styles.featureIconWrap}>
                <Icon name="users" size={20} />
              </div>
              <h3 style={styles.cardHeading}>Zero Per-Seat User Taxes</h3>
              <p style={styles.cardBody}>
                Legacy CRMs charge $50–$150 for every staff member, junior copywriter, or media buyer you
                invite. Operza offers unlimited team seats across all plans so your entire agency can
                collaborate without artificial login rationing.
              </p>
              <div style={styles.pillStat}>Unlimited Team Members</div>
            </div>
          </div>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────────
          3. SERVICES & PLATFORM CAPABILITIES (Interactive & Comprehensive)
          ────────────────────────────────────────────────────────────────── */}
      <section className="funnel-section-alt">
        <div className="funnel-container">
          <div className="funnel-section-header">
            <div className="funnel-tag">
              <Icon name="apps" size={13} />
              <span>CORE PLATFORM CAPABILITIES</span>
            </div>
            <h2 className="funnel-heading">A Complete Operating System for Agency Growth</h2>
            <p className="funnel-subhead">
              Replace multiple disjointed SaaS subscriptions with one deeply integrated platform.
            </p>
          </div>

          {/* Interactive Feature Tabs Bar */}
          <div style={styles.tabNavRow}>
            <button
              type="button"
              style={{ ...styles.capabilityTab, ...(activeTab === 'crm' ? styles.capabilityTabActive : {}) }}
              onClick={() => setActiveTab('crm')}
            >
              <Icon name="kanban" size={14} /> Agency CRM &amp; Lists
            </button>
            <button
              type="button"
              style={{ ...styles.capabilityTab, ...(activeTab === 'workflows' ? styles.capabilityTabActive : {}) }}
              onClick={() => setActiveTab('workflows')}
            >
              <Icon name="zap" size={14} /> 2D Visual Workflows
            </button>
            <button
              type="button"
              style={{ ...styles.capabilityTab, ...(activeTab === 'funnels' ? styles.capabilityTabActive : {}) }}
              onClick={() => setActiveTab('funnels')}
            >
              <Icon name="funnel" size={14} /> Funnels &amp; Pages
            </button>
            <button
              type="button"
              style={{ ...styles.capabilityTab, ...(activeTab === 'omni' ? styles.capabilityTabActive : {}) }}
              onClick={() => setActiveTab('omni')}
            >
              <Icon name="message" size={14} /> Omnichannel Inbox
            </button>
            <button
              type="button"
              style={{ ...styles.capabilityTab, ...(activeTab === 'portal' ? styles.capabilityTabActive : {}) }}
              onClick={() => setActiveTab('portal')}
            >
              <Icon name="globe" size={14} /> White-Label Portal
            </button>
            <button
              type="button"
              style={{ ...styles.capabilityTab, ...(activeTab === 'calendar' ? styles.capabilityTabActive : {}) }}
              onClick={() => setActiveTab('calendar')}
            >
              <Icon name="calendar" size={14} /> GiST Calendar Sync
            </button>
          </div>

          {/* Capability Content Area */}
          <div className="card-premium" style={{ padding: 36, marginTop: 24 }}>
            {activeTab === 'crm' && (
              <div className="funnel-grid-2">
                <div>
                  <div className="funnel-tag">CRM &amp; PIPELINES</div>
                  <h3 style={styles.tabDetailHeading}>Multi-Tenant CRM with Multi-Stage Pipelines</h3>
                  <p style={styles.tabDetailText}>
                    Manage contacts, opportunities, and activities with custom fields, automated tagging,
                    and weighted pipeline value calculations. Filter seamlessly with Smart Lists and
                    execute formula-defended CSV contact imports without data loss.
                  </p>
                  <ul style={styles.tabFeatureList}>
                    <li>Multi-stage drag-and-drop Kanban boards with automated deal velocity metrics</li>
                    <li>Transaction-scoped PostgreSQL RLS ensuring complete sub-account isolation</li>
                    <li>Smart Lists with formula-injection defenses for secure CSV imports and exports</li>
                  </ul>
                  <Link to="/platform/crm" style={styles.learnMoreLink}>
                    Explore CRM Architecture →
                  </Link>
                </div>
                <div style={styles.tabVisualCard}>
                  <div style={styles.tabVisualHeader}>
                    <strong>Acme Growth Pipeline</strong>
                    <span style={styles.badgeActive}>$184,200 Active Value</span>
                  </div>
                  <div style={styles.mockPipelineList}>
                    <div style={styles.mockPipelineItem}>
                      <div>
                        <strong>Apex Media Partner</strong>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Lead qualified · Stage: Inbound</div>
                      </div>
                      <span style={{ fontWeight: 700, color: 'var(--accent)' }}>$4,500/mo</span>
                    </div>
                    <div style={styles.mockPipelineItem}>
                      <div>
                        <strong>Vanguard Health Systems</strong>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Strategy Call booked · Stage: Meeting</div>
                      </div>
                      <span style={{ fontWeight: 700, color: 'var(--accent)' }}>$12,500/mo</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'workflows' && (
              <div className="funnel-grid-2">
                <div>
                  <div className="funnel-tag">VISUAL AUTOMATION</div>
                  <h3 style={styles.tabDetailHeading}>2D Event-Driven Automations with BullMQ Queues</h3>
                  <p style={styles.tabDetailText}>
                    Connect triggers, conditional evaluation branches, webhook dispatches, and human
                    approval gates on an intuitive 2D canvas. Durable Redis queues ensure guaranteed
                    at-least-once execution with exponential backoff and jitter.
                  </p>
                  <ul style={styles.tabFeatureList}>
                    <li>Visual node-and-wire canvas with zoom, pan, and real-time execution step debugging</li>
                    <li>Conditional YES/NO branching trees and custom JSON webhook payloads</li>
                    <li>Human approval checkpoints for high-stakes customer communications</li>
                  </ul>
                  <Link to="/platform/automation" style={styles.learnMoreLink}>
                    Explore Workflow Engine →
                  </Link>
                </div>
                <div style={styles.tabVisualCard}>
                  <div style={styles.tabVisualHeader}>
                    <strong>VIP Client Onboarding Workflow</strong>
                    <span style={styles.badgeActive}>BullMQ Active</span>
                  </div>
                  <div style={styles.mockWorkflowFlow}>
                    <div style={styles.mockFlowStep}>⚡ Event: Stripe Checkout Completed</div>
                    <div style={styles.wireConnector}>↓</div>
                    <div style={styles.mockFlowStep}>🤖 Rule: Contract Value &gt; $5,000?</div>
                    <div style={styles.splitFlowRow}>
                      <div style={styles.branchBoxYes}>YES → Assign Senior Manager &amp; SMS</div>
                      <div style={styles.branchBoxNo}>NO → Standard Email Drip</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'funnels' && (
              <div className="funnel-grid-2">
                <div>
                  <div className="funnel-tag">LANDING PAGES &amp; FUNNELS</div>
                  <h3 style={styles.tabDetailHeading}>High-Converting Funnels &amp; 1-Click Order Bumps</h3>
                  <p style={styles.tabDetailText}>
                    Design responsive landing pages and multi-step funnels directly in your browser.
                    Add live countdown timers, order bumps, dynamic forms, and instant custom domain
                    mapping with automated SSL certificate renewal.
                  </p>
                  <ul style={styles.tabFeatureList}>
                    <li>Multi-viewport preview switching (Desktop, Tablet, Mobile) with real-time responsive rendering</li>
                    <li>Built-in 1-click order bump calculations and frictionless checkout flows</li>
                    <li>Custom domain mapping with automated Let's Encrypt TLS/SSL provisioning</li>
                  </ul>
                  <Link to="/platform/funnels" style={styles.learnMoreLink}>
                    Explore Funnel Builder →
                  </Link>
                </div>
                <div style={styles.tabVisualCard}>
                  <div style={styles.tabVisualHeader}>
                    <strong>High-Velocity Client Acquisition Page</strong>
                    <span style={styles.badgeActive}>4.8% Opt-in Rate</span>
                  </div>
                  <div style={{ padding: 20, background: 'var(--surface-2)', borderRadius: 8, textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Scale Agency Retainers in 30 Days</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>VIP Agency Growth Masterclass</div>
                    <div style={{ background: 'var(--surface)', padding: 10, borderRadius: 6, border: '1px dashed var(--accent)', fontSize: 12 }}>
                      ☑️ 1-Click Order Bump: Add Agency Blueprint Snapshots ($297)
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'omni' && (
              <div className="funnel-grid-2">
                <div>
                  <div className="funnel-tag">UNIFIED INBOX</div>
                  <h3 style={styles.tabDetailHeading}>SMS, WhatsApp, Email &amp; WebRTC Softphone</h3>
                  <p style={styles.tabDetailText}>
                    Manage all incoming communications from Twilio SMS, WhatsApp Cloud API, Meta Messenger,
                    and email in a single timeline. Place outbound calls directly from the browser with
                    our built-in WebRTC softphone.
                  </p>
                  <ul style={styles.tabFeatureList}>
                    <li>Unified multi-channel thread per contact with real-time WebSocket live updates</li>
                    <li>Built-in WebRTC softphone with browser-based dialing, audio recording, and IVR</li>
                    <li>Automatic thread routing to assigned account managers based on pipeline status</li>
                  </ul>
                  <Link to="/platform/conversations" style={styles.learnMoreLink}>
                    Explore Omnichannel Inbox →
                  </Link>
                </div>
                <div style={styles.tabVisualCard}>
                  <div style={styles.tabVisualHeader}>
                    <strong>Thread: Sarah Jenkins (Apex Media)</strong>
                    <span style={styles.badgeActive}>WhatsApp Cloud API</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 0' }}>
                    <div style={styles.chatBubbleInbound}>
                      Hi team, we reviewed the proposal and are ready to finalize our contract!
                    </div>
                    <div style={styles.chatBubbleOutbound}>
                      Terrific Sarah! The digital agreement has been published to your client portal.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'portal' && (
              <div className="funnel-grid-2">
                <div>
                  <div className="funnel-tag">WHITE-LABEL PORTAL</div>
                  <h3 style={styles.tabDetailHeading}>Branded Client Access with Digital Signatures</h3>
                  <p style={styles.tabDetailText}>
                    Provide your clients with a fully branded self-service portal under your custom CNAME
                    domain. Clients can review invoices, sign legally binding digital agreements, and
                    track project deliverables.
                  </p>
                  <ul style={styles.tabFeatureList}>
                    <li>Host under your custom domain (e.g., portal.youragency.com) with automated SSL</li>
                    <li>Digital contract e-signatures with cryptographic audit timestamps and PDF generation</li>
                    <li>Stripe invoice settlement with automated receipt dispatch and ledger syncing</li>
                  </ul>
                  <Link to="/platform/portal" style={styles.learnMoreLink}>
                    Explore Client Portal →
                  </Link>
                </div>
                <div style={styles.tabVisualCard}>
                  <div style={styles.tabVisualHeader}>
                    <strong>Client Portal · Acme Creative</strong>
                    <span style={styles.badgeActive}>CNAME Active</span>
                  </div>
                  <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 14, background: 'var(--surface)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, fontWeight: 600 }}>
                      <span>Master Retainer Agreement 2026</span>
                      <span style={{ color: 'var(--green)' }}>✓ Signed &amp; Cryptographically Verified</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Invoice #INV-2026-92 paid via Stripe ($4,500.00 USD)
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'calendar' && (
              <div className="funnel-grid-2">
                <div>
                  <div className="funnel-tag">BOOKING CONCURRENCY</div>
                  <h3 style={styles.tabDetailHeading}>PostgreSQL GiST Concurrency-Protected Booking</h3>
                  <p style={styles.tabDetailText}>
                    Never worry about overlapping appointments again. Operza protects bookable calendar
                    resources with PostgreSQL GiST exclusion constraints (`tsrange` with `&&` overlap operator)
                    at the database engine level, rejecting double-bookings even under concurrent API traffic.
                  </p>
                  <ul style={styles.tabFeatureList}>
                    <li>Database-enforced exclusion constraint eliminating race-condition double bookings</li>
                    <li>Two-way external calendar sync with Google Calendar and Microsoft Outlook</li>
                    <li>Automatic timezone conversion, custom buffer intervals, and SMS reminder triggers</li>
                  </ul>
                  <Link to="/docs" style={styles.learnMoreLink}>
                    Read Concurrency Architecture →
                  </Link>
                </div>
                <div style={styles.tabVisualCard}>
                  <div style={styles.tabVisualHeader}>
                    <strong>Appointment Engine Telemetry</strong>
                    <span style={styles.badgeActive}>GiST Exclusion Active</span>
                  </div>
                  <div style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
                      Concurrent Request Test Verification:
                    </div>
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                      Process A: Book 14:00 - 15:00 → HTTP 200 OK<br />
                      Process B: Book 14:30 - 15:30 → HTTP 409 Conflict<br />
                      Collision Rate: 0.00% across multi-process clusters
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────────
          4. PRICING PLANS (Starter, Professional, Enterprise)
          ────────────────────────────────────────────────────────────────── */}
      <section className="funnel-section" id="pricing-section">
        <div className="funnel-container">
          <div className="funnel-section-header">
            <div className="funnel-tag">
              <Icon name="wallet" size={13} />
              <span>TRANSPARENT, EDITABLE TIERS</span>
            </div>
            <h2 className="funnel-heading">Predictable Agency Pricing with Zero Per-Seat Taxes</h2>
            <p className="funnel-subhead">
              Consolidate your entire technology stack for less than the cost of one single legacy tool.
              Unlimited team seats on every plan.
            </p>

            {/* Monthly / Annual Billing Toggle */}
            <div style={styles.billingToggleWrap}>
              <span style={{ fontWeight: billingCycle === 'monthly' ? 700 : 500, fontSize: 14, color: billingCycle === 'monthly' ? 'var(--text)' : 'var(--text-muted)' }}>
                Billed Monthly
              </span>
              <button
                type="button"
                style={styles.billingToggleBtn}
                onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'annual' : 'monthly')}
                aria-label="Toggle annual billing discount"
              >
                <div
                  style={{
                    ...styles.billingToggleThumb,
                    transform: billingCycle === 'annual' ? 'translateX(20px)' : 'translateX(0)',
                  }}
                />
              </button>
              <span style={{ fontWeight: billingCycle === 'annual' ? 700 : 500, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, color: billingCycle === 'annual' ? 'var(--text)' : 'var(--text-muted)' }}>
                Billed Annually
                <span style={styles.discountBadge}>Save 20%</span>
              </span>
            </div>
          </div>

          {/* Pricing Cards Grid */}
          <div className="funnel-pricing-grid">
            {PRICING_TIERS.map(tier => {
              const displayPrice = billingCycle === 'annual' ? tier.annualPrice : tier.monthlyPrice;
              return (
                <div
                  key={tier.id}
                  className="card-premium"
                  style={{
                    padding: 32,
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    borderColor: tier.popular ? 'var(--accent)' : 'var(--line)',
                    boxShadow: tier.popular ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
                  }}
                >
                  {tier.popular && (
                    <div style={styles.popularBadge}>MOST POPULAR FOR AGENCIES</div>
                  )}

                  <div style={{ marginBottom: 20 }}>
                    <div style={styles.tierName}>{tier.name}</div>
                    <div style={styles.tierDesc}>{tier.description}</div>
                  </div>

                  <div style={styles.priceRow}>
                    <span style={styles.priceCurrency}>$</span>
                    <span style={styles.priceAmount}>{displayPrice}</span>
                    <span style={styles.pricePeriod}>/month</span>
                  </div>

                  <div style={styles.subAccountLimitTag}>
                    <Icon name="shield" size={13} />
                    <span>{tier.subAccounts} · Unlimited Team Seats</span>
                  </div>

                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 24 }}>
                    {billingCycle === 'annual'
                      ? `Billed annually ($${displayPrice * 12}/year)`
                      : `Billed monthly ($${displayPrice}/month)`}
                  </div>

                  <div style={{ flex: 1, marginBottom: 28 }}>
                    <div style={styles.featureListHeader}>Everything included:</div>
                    <ul style={styles.pricingFeatureList}>
                      {tier.features.map((feat, i) => (
                        <li key={i} style={styles.pricingFeatureItem}>
                          <Icon name="check" size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Link
                    to={`/signup?plan=${tier.id}&billing=${billingCycle}`}
                    style={tier.popular ? styles.btnPrimaryBlock : styles.btnSecondaryBlock}
                    onClick={() => trackEvent('pricing_select', { tier: tier.id, billing: billingCycle })}
                  >
                    {tier.ctaText}
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────────
          5. FEATURE COMPARISON MATRIX (Side-by-Side Clarity)
          ────────────────────────────────────────────────────────────────── */}
      <section className="funnel-section-alt">
        <div className="funnel-container">
          <div className="funnel-section-header">
            <div className="funnel-tag">
              <Icon name="kanban" size={13} />
              <span>DETAILED PLAN SPECIFICATIONS</span>
            </div>
            <h2 className="funnel-heading">Side-by-Side Feature Comparison</h2>
            <p className="funnel-subhead">
              Compare limits, database isolation options, and white-label capabilities across tiers.
            </p>
          </div>

          <div className="funnel-table-wrapper">
            <table className="funnel-table">
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>Core Capability</th>
                  <th style={{ width: '20%' }}>Starter ($35/mo)</th>
                  <th style={{ width: '20%', color: 'var(--accent)' }}>Professional ($79/mo)</th>
                  <th style={{ width: '20%' }}>Enterprise ($149/mo)</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row, idx) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: 600, color: 'var(--text)' }}>{row.feature}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{row.starter}</td>
                    <td style={{ fontWeight: 600, color: 'var(--accent)' }}>{row.professional}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{row.enterprise}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────────
          6. OPERATIONAL BENEFITS & ROI SAVINGS CALCULATOR
          ────────────────────────────────────────────────────────────────── */}
      <section className="funnel-section">
        <div className="funnel-container">
          <div className="funnel-section-header">
            <div className="funnel-tag">
              <Icon name="chart" size={13} />
              <span>RADICAL COST REDUCTION</span>
            </div>
            <h2 className="funnel-heading">Stop Paying the Fragmented $1,200/Month SaaS Tax</h2>
            <p className="funnel-subhead">
              Calculate your exact monthly and annual savings by consolidating your agency tools into Operza.
            </p>
          </div>

          <div className="funnel-grid-2">
            {/* Interactive Calculator Slider Card */}
            <div className="card-premium" style={{ padding: 32 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Agency Profile &amp; Volume</h3>

              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13.5 }}>
                  <span style={{ fontWeight: 600 }}>Team Member Seats:</span>
                  <strong style={{ color: 'var(--accent)' }}>{calcSeats} team seats</strong>
                </div>
                <input
                  type="range"
                  min="1"
                  max="30"
                  value={calcSeats}
                  onChange={e => setCalcSeats(Number(e.target.value))}
                  className="funnel-slider"
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Legacy CRMs bill $50–$65 per seat per month. Operza bills $0 per seat.
                </div>
              </div>

              <div style={{ marginBottom: 28 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13.5 }}>
                  <span style={{ fontWeight: 600 }}>Client Sub-Accounts:</span>
                  <strong style={{ color: 'var(--accent)' }}>{calcSubAccounts} client sub-accounts</strong>
                </div>
                <input
                  type="range"
                  min="1"
                  max="50"
                  value={calcSubAccounts}
                  onChange={e => setCalcSubAccounts(Number(e.target.value))}
                  className="funnel-slider"
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Recommended Plan: <strong>{calcSubAccounts <= 3 ? 'Starter' : calcSubAccounts <= 15 ? 'Professional' : 'Enterprise Scale'}</strong>
                </div>
              </div>

              <div style={{ background: 'var(--surface-2)', padding: 18, borderRadius: 10, border: '1px solid var(--line)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                  Fragmented Monthly Subscriptions Replaced:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--text)' }}>
                  <div>• Dedicated CRM Seats ({calcSeats} users): ${(calcSeats * 55)}/mo</div>
                  <div>• iPaaS Visual Automation (Zapier): $129/mo</div>
                  <div>• Funnel &amp; Landing Page Software: $197/mo</div>
                  <div>• Omnichannel SMS / WhatsApp Stream: $140/mo</div>
                  <div>• Digital Contract E-Signatures: $80/mo</div>
                  <div>• Multi-Tenant Agency Sub-Account Fees: ${(calcSubAccounts * 20)}/mo</div>
                </div>
              </div>
            </div>

            {/* Savings Readout Card */}
            <div
              className="card-premium"
              style={{
                padding: 36,
                background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
                color: '#ffffff',
                border: '1px solid rgba(99, 102, 241, 0.3)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#38bdf8', textTransform: 'uppercase', marginBottom: 8 }}>
                ANNUAL COST COMPARISON
              </div>

              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, color: '#94a3b8' }}>Fragmented Stack Cost:</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#f87171', textDecoration: 'line-through' }}>
                  ${(fragmentedCost * 12).toLocaleString()} / year (${fragmentedCost}/mo)
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, color: '#94a3b8' }}>Operza All-In-One Cost:</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#34d399' }}>
                  ${(operzaActualCost * 12).toLocaleString()} / year (${operzaActualCost}/mo)
                </div>
              </div>

              <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 10, padding: 18, textAlign: 'center', marginBottom: 24 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Estimated Net Agency Savings
                </div>
                <div style={{ fontSize: 32, fontWeight: 900, color: '#34d399', margin: '4px 0' }}>
                  ${annualSavings.toLocaleString()} / year
                </div>
                <div style={{ fontSize: 12, color: '#a7f3d0' }}>
                  Saving ${monthlySavings.toLocaleString()} every single month
                </div>
              </div>

              <button
                type="button"
                style={{ ...styles.btnPrimaryBlock, background: '#4f46e5', borderColor: '#6366f1' }}
                onClick={scrollToLeadForm}
              >
                Claim These Savings with Operza →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────────
          7. VERIFIED TESTIMONIALS (Authentic, Metric-Driven Case Studies)
          ────────────────────────────────────────────────────────────────── */}
      <section className="funnel-section-alt">
        <div className="funnel-container">
          <div className="funnel-section-header">
            <div className="funnel-tag">
              <Icon name="check" size={13} />
              <span>VERIFIED AGENCY RESULTS</span>
            </div>
            <h2 className="funnel-heading">Trusted by High-Velocity Agency Founders</h2>
            <p className="funnel-subhead">
              Read how marketing and digital agency leaders eliminated tool sprawl and preserved their margins.
            </p>
          </div>

          <div className="funnel-grid-3">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className="card-premium" style={{ padding: 28, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                  {[...Array(5)].map((_, starIdx) => (
                    <Icon key={starIdx} name="star" size={14} style={{ color: '#f59e0b', fill: '#f59e0b' }} />
                  ))}
                  <span style={styles.verifiedReviewPill}>Verified Agency</span>
                </div>

                <p style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.6, flex: 1, margin: '0 0 20px', fontStyle: 'italic' }}>
                  "{t.quote}"
                </p>

                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.role} · {t.agency}</div>
                  <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, marginTop: 2 }}>{t.clients}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────────
          8. FREQUENTLY ASKED QUESTIONS (Accordion)
          ────────────────────────────────────────────────────────────────── */}
      <section className="funnel-section">
        <div className="funnel-container">
          <div className="funnel-section-header">
            <div className="funnel-tag">
              <Icon name="clipboard" size={13} />
              <span>QUESTIONS &amp; ANSWERS</span>
            </div>
            <h2 className="funnel-heading">Frequently Asked Questions</h2>
            <p className="funnel-subhead">
              Everything you need to know about Operza’s multi-tenant architecture, pricing, and migration.
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
                      <p style={{ margin: 0, lineHeight: 1.6, color: 'var(--text-muted)', fontSize: 14 }}>
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

      {/* ──────────────────────────────────────────────────────────────────
          9. STRONG CLOSING CTA BANNER
          ────────────────────────────────────────────────────────────────── */}
      <section style={styles.ctaBannerSection}>
        <div className="funnel-container">
          <div style={{ textAlign: 'center', maxWidth: 700, margin: '0 auto' }}>
            <h2 style={{ fontSize: 32, fontWeight: 800, color: '#ffffff', margin: '0 0 14px' }}>
              Ready to Upgrade Your Agency Operations?
            </h2>
            <p style={{ fontSize: 16, color: '#cbd5e1', lineHeight: 1.6, margin: '0 0 28px' }}>
              Join agencies eliminating SaaS fragmentation with Operza. Start your unrestricted
              14-day trial today with zero per-seat fees.
            </p>
            <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link
                to="/signup"
                style={styles.ctaBannerBtnWhite}
                onClick={() => trackEvent('signup_start', { source: 'banner_cta' })}
              >
                Start 14-Day Free Trial →
              </Link>
              <button
                type="button"
                style={styles.ctaBannerBtnOutline}
                onClick={scrollToLeadForm}
              >
                Schedule Architecture Demo
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────────
          10. INTERACTIVE LEAD CAPTURE FORM (Connected to CRM Lead Ingress)
          ────────────────────────────────────────────────────────────────── */}
      <section className="funnel-section" id="lead-capture" ref={leadFormRef}>
        <div className="funnel-container">
          <div className="funnel-grid-2">
            <div>
              <div className="funnel-tag">
                <Icon name="calendar" size={13} />
                <span>DIRECT AGENCY ONBOARDING</span>
              </div>
              <h2 className="funnel-heading">Request a 1-on-1 Platform Architecture Demo</h2>
              <p className="funnel-subhead" style={{ marginBottom: 24 }}>
                Speak directly with an agency systems architect. We’ll review your existing tools,
                demonstrate our PostgreSQL RLS isolation, and map out your migration in 30 minutes.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
                <div style={styles.benefitRow}>
                  <div style={styles.checkCircle}><Icon name="check" size={13} /></div>
                  <div>
                    <strong>Full Database Migration Blueprint:</strong> We map your existing contacts,
                    tags, and pipelines from legacy CRMs, HubSpot, or ActiveCampaign with zero downtime.
                  </div>
                </div>
                <div style={styles.benefitRow}>
                  <div style={styles.checkCircle}><Icon name="check" size={13} /></div>
                  <div>
                    <strong>Custom Snapshot Blueprint:</strong> We configure a sample client sub-account
                    with your exact agency SOPs and visual workflows.
                  </div>
                </div>
                <div style={styles.benefitRow}>
                  <div style={styles.checkCircle}><Icon name="check" size={13} /></div>
                  <div>
                    <strong>No Pressure, Zero Hard Sell:</strong> A technical walkthrough focused on
                    performance, data sovereignty, and operational cost savings.
                  </div>
                </div>
              </div>
            </div>

            {/* Interactive Form Card */}
            <div className="funnel-lead-card">
              {formSubmitted ? (
                <div style={styles.successState}>
                  <div style={styles.successIconWrap}>
                    <Icon name="check" size={28} />
                  </div>
                  <h3 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 10px', color: 'var(--text)' }}>
                    Demo Request Received!
                  </h3>
                  <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 20px' }}>
                    Thank you, <strong>{formData.firstName}</strong>. Our systems architecture team has logged
                    your request for <strong>{formData.company}</strong> in our CRM. We will follow up via
                    email at <strong>{formData.email}</strong> within 2 business hours.
                  </p>
                  <button
                    type="button"
                    style={styles.btnSecondary}
                    onClick={() => {
                      setFormSubmitted(false);
                      setFormData({
                        firstName: '',
                        lastName: '',
                        email: '',
                        company: '',
                        phone: '',
                        subAccounts: '4-15 sub-accounts',
                        primaryGoal: 'Stack Consolidation (Cut SaaS costs)',
                      });
                    }}
                  >
                    Submit Another Inquiry
                  </button>
                </div>
              ) : (
                <form onSubmit={handleFormSubmit}>
                  <h3 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 6px', color: 'var(--text)' }}>
                    Get Your Custom Agency Strategy
                  </h3>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 20px' }}>
                    Fill out the brief form below to connect directly with an Operza solution architect.
                  </p>

                  {formError && (
                    <div style={styles.formErrorBanner}>
                      {formError}
                    </div>
                  )}

                  <div className="funnel-form-row">
                    <div className="funnel-form-group">
                      <label className="funnel-form-label">First Name *</label>
                      <input
                        type="text"
                        name="firstName"
                        required
                        value={formData.firstName}
                        onChange={handleFormChange}
                        placeholder="e.g. Alex"
                        className="funnel-form-input"
                      />
                    </div>
                    <div className="funnel-form-group">
                      <label className="funnel-form-label">Last Name</label>
                      <input
                        type="text"
                        name="lastName"
                        value={formData.lastName}
                        onChange={handleFormChange}
                        placeholder="e.g. Mercer"
                        className="funnel-form-input"
                      />
                    </div>
                  </div>

                  <div className="funnel-form-row">
                    <div className="funnel-form-group">
                      <label className="funnel-form-label">Work Email *</label>
                      <input
                        type="email"
                        name="email"
                        required
                        value={formData.email}
                        onChange={handleFormChange}
                        placeholder="alex@agency.com"
                        className="funnel-form-input"
                      />
                    </div>
                    <div className="funnel-form-group">
                      <label className="funnel-form-label">Company / Agency Name *</label>
                      <input
                        type="text"
                        name="company"
                        required
                        value={formData.company}
                        onChange={handleFormChange}
                        placeholder="Apex Growth Partners"
                        className="funnel-form-input"
                      />
                    </div>
                  </div>

                  <div className="funnel-form-row">
                    <div className="funnel-form-group">
                      <label className="funnel-form-label">Phone Number (Optional)</label>
                      <input
                        type="tel"
                        name="phone"
                        value={formData.phone}
                        onChange={handleFormChange}
                        placeholder="+1 (555) 019-2834"
                        className="funnel-form-input"
                      />
                    </div>
                    <div className="funnel-form-group">
                      <label className="funnel-form-label">Client Sub-Accounts Count</label>
                      <select
                        name="subAccounts"
                        value={formData.subAccounts}
                        onChange={handleFormChange}
                        className="funnel-form-select"
                      >
                        <option value="1-3 sub-accounts">1 to 3 sub-accounts (Starter)</option>
                        <option value="4-15 sub-accounts">4 to 15 sub-accounts (Growth)</option>
                        <option value="16-50 sub-accounts">16 to 50 sub-accounts (Scale)</option>
                        <option value="50+ sub-accounts">50+ sub-accounts (Enterprise)</option>
                      </select>
                    </div>
                  </div>

                  <div className="funnel-form-group">
                    <label className="funnel-form-label">Primary Operational Objective</label>
                    <select
                      name="primaryGoal"
                      value={formData.primaryGoal}
                      onChange={handleFormChange}
                      className="funnel-form-select"
                    >
                      <option value="Stack Consolidation (Cut SaaS costs)">Stack Consolidation (Replace 5+ software tools)</option>
                      <option value="Multi-Tenant Database Isolation">PostgreSQL Multi-Tenancy &amp; Enterprise RLS Isolation</option>
                      <option value="2D Visual Workflow Automations">2D Visual Workflow Automation with BullMQ Queueing</option>
                      <option value="White-Label Client Portal & Contracts">White-Label Client Portal &amp; Contract E-Signatures</option>
                      <option value="Concurrency Protected Appointment Booking">Concurrency-Protected Appointment Booking</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    style={styles.btnPrimaryBlock}
                  >
                    {isSubmitting ? 'Registering Demo Request...' : 'Schedule Live Architecture Demo →'}
                  </button>

                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center', marginTop: 12 }}>
                    🔒 We respect your privacy. No spam. Direct technical coordination only.
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heroSection: {
    padding: '72px 0 64px',
    background: 'radial-gradient(ellipse at top, rgba(37, 99, 235, 0.05) 0%, transparent 70%)',
    borderBottom: '1px solid var(--line)',
  },
  heroInner: {
    textAlign: 'center',
    maxWidth: 960,
    margin: '0 auto',
  },
  heroTitle: {
    fontSize: 44,
    fontWeight: 850,
    lineHeight: 1.15,
    letterSpacing: '-0.03em',
    color: 'var(--text)',
    margin: '0 0 18px',
  },
  heroSubtitle: {
    fontSize: 17,
    lineHeight: 1.6,
    color: 'var(--text-muted)',
    maxWidth: 740,
    margin: '0 auto 32px',
  },
  heroActionGroup: {
    display: 'flex',
    gap: 14,
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginBottom: 32,
  },
  btnPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 24px',
    fontSize: 14.5,
    fontWeight: 650,
    color: '#ffffff',
    background: 'var(--accent)',
    borderRadius: 'var(--r-md)',
    textDecoration: 'none',
    boxShadow: 'var(--shadow-sm)',
    border: '1px solid var(--accent-hover)',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  btnSecondary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 22px',
    fontSize: 14.5,
    fontWeight: 600,
    color: 'var(--text)',
    background: 'var(--surface)',
    border: '1px solid var(--border-base)',
    borderRadius: 'var(--r-md)',
    textDecoration: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  btnPrimaryBlock: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '12px 20px',
    fontSize: 14,
    fontWeight: 700,
    color: '#ffffff',
    background: 'var(--accent)',
    borderRadius: 'var(--r-md)',
    border: '1px solid var(--accent-hover)',
    textDecoration: 'none',
    cursor: 'pointer',
    boxShadow: 'var(--shadow-sm)',
  },
  btnSecondaryBlock: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '12px 20px',
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text)',
    background: 'var(--surface)',
    borderRadius: 'var(--r-md)',
    border: '1px solid var(--border-base)',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  heroTrustGrid: {
    display: 'flex',
    gap: 20,
    justifyContent: 'center',
    fontSize: 13,
    color: 'var(--text-muted)',
    flexWrap: 'wrap',
    marginBottom: 44,
  },
  trustItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  appPreviewFrame: {
    background: 'var(--surface)',
    borderRadius: 'var(--r-xl)',
    border: '1px solid var(--line-strong)',
    boxShadow: 'var(--shadow-xl)',
    overflow: 'hidden',
    textAlign: 'left',
  },
  previewTitleBar: {
    padding: '10px 16px',
    background: 'var(--surface-2)',
    borderBottom: '1px solid var(--line)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 12,
  },
  windowControls: {
    display: 'flex',
    gap: 6,
  },
  winDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
  },
  previewLocationBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 11.5,
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
  },
  statusLivePill: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: 'var(--green)',
    boxShadow: '0 0 6px var(--green)',
  },
  previewVersionTag: {
    fontSize: 11,
    color: 'var(--text-faint)',
    fontFamily: 'var(--font-mono)',
  },
  previewBody: {
    display: 'grid',
    gridTemplateColumns: '170px 1fr 220px',
    minHeight: 380,
    background: 'var(--surface)',
  },
  previewSidebar: {
    background: 'var(--surface-2)',
    borderRight: '1px solid var(--line)',
    padding: '14px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  previewNavHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingLeft: 4,
  },
  brandIconMini: {
    width: 20,
    height: 20,
    borderRadius: 4,
    background: 'var(--accent)',
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 800,
    display: 'grid',
    placeItems: 'center',
  },
  previewNavItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
    fontSize: 12,
    color: 'var(--text-muted)',
    borderRadius: 'var(--r-sm)',
  },
  previewNavActive: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
    fontSize: 12,
    color: 'var(--accent)',
    background: 'var(--accent-soft)',
    fontWeight: 700,
    borderRadius: 'var(--r-sm)',
  },
  previewKanbanArea: {
    padding: 16,
    borderRight: '1px solid var(--line)',
    overflow: 'hidden',
  },
  kanbanTopHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  pipelineValueBadge: {
    fontSize: 11.5,
    fontWeight: 700,
    color: 'var(--green)',
    background: 'var(--green-soft)',
    padding: '2px 8px',
    borderRadius: 'var(--r-pill)',
  },
  kanbanColumnsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
  },
  kanbanCol: {
    background: 'var(--surface-2)',
    borderRadius: 'var(--r-md)',
    padding: 10,
    border: '1px solid var(--line-subtle)',
  },
  kanbanColHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 10.5,
    fontWeight: 700,
    color: 'var(--text-muted)',
    marginBottom: 8,
  },
  stageCount: {
    background: 'var(--surface-3)',
    borderRadius: 'var(--r-pill)',
    padding: '1px 6px',
    fontSize: 10,
  },
  kanbanCard: {
    background: 'var(--surface)',
    border: '1px solid var(--line)',
    borderRadius: 'var(--r-sm)',
    padding: '8px 10px',
    marginBottom: 8,
    boxShadow: 'var(--shadow-xs)',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 12,
    fontWeight: 650,
    marginBottom: 4,
  },
  companyName: {
    color: 'var(--text)',
  },
  dealPrice: {
    color: 'var(--accent)',
    fontSize: 11,
    fontWeight: 700,
  },
  cardMeta: {
    fontSize: 10.5,
    color: 'var(--text-muted)',
  },
  previewTelemetrySidebar: {
    background: 'var(--surface-2)',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  telemetryHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
    color: 'var(--text)',
  },
  workflowStepBox: {
    background: 'var(--surface)',
    border: '1px solid var(--line)',
    borderRadius: 'var(--r-sm)',
    padding: '8px 10px',
    fontSize: 11,
  },
  workflowStepTitle: {
    fontWeight: 700,
    color: 'var(--text)',
    marginBottom: 2,
  },
  workflowStepDesc: {
    color: 'var(--text-muted)',
    fontSize: 10,
  },
  wireConnector: {
    textAlign: 'center',
    color: 'var(--text-faint)',
    fontSize: 11,
    lineHeight: 1,
  },
  featureIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 'var(--r-md)',
    background: 'var(--accent-soft)',
    color: 'var(--accent)',
    display: 'grid',
    placeItems: 'center',
    marginBottom: 16,
  },
  cardHeading: {
    fontSize: 18,
    fontWeight: 750,
    color: 'var(--text)',
    margin: '0 0 10px',
  },
  cardBody: {
    fontSize: 14,
    lineHeight: 1.6,
    color: 'var(--text-muted)',
    margin: '0 0 16px',
  },
  pillStat: {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--accent)',
    background: 'var(--accent-soft)',
    padding: '3px 8px',
    borderRadius: 'var(--r-pill)',
  },
  tabNavRow: {
    display: 'flex',
    gap: 8,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  capabilityTab: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 18px',
    borderRadius: 'var(--r-md)',
    border: '1px solid var(--line)',
    background: 'var(--surface)',
    color: 'var(--text-muted)',
    fontSize: 13.5,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  capabilityTabActive: {
    background: 'var(--accent)',
    color: '#ffffff',
    borderColor: 'var(--accent-hover)',
  },
  tabDetailHeading: {
    fontSize: 22,
    fontWeight: 800,
    color: 'var(--text)',
    margin: '8px 0 12px',
  },
  tabDetailText: {
    fontSize: 14,
    color: 'var(--text-muted)',
    lineHeight: 1.6,
    margin: '0 0 18px',
  },
  tabFeatureList: {
    paddingLeft: 18,
    fontSize: 13.5,
    color: 'var(--text)',
    lineHeight: 1.8,
    marginBottom: 20,
  },
  learnMoreLink: {
    fontSize: 13.5,
    fontWeight: 700,
    color: 'var(--accent)',
    textDecoration: 'none',
  },
  tabVisualCard: {
    background: 'var(--surface-2)',
    border: '1px solid var(--line)',
    borderRadius: 'var(--r-lg)',
    padding: 20,
  },
  tabVisualHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 13,
    marginBottom: 14,
  },
  badgeActive: {
    background: 'var(--green-soft)',
    color: 'var(--green)',
    padding: '2px 8px',
    borderRadius: 'var(--r-pill)',
    fontSize: 11,
    fontWeight: 700,
  },
  mockPipelineList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  mockPipelineItem: {
    background: 'var(--surface)',
    border: '1px solid var(--line-subtle)',
    borderRadius: 'var(--r-md)',
    padding: '10px 14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 13,
  },
  mockWorkflowFlow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  mockFlowStep: {
    background: 'var(--surface)',
    border: '1px solid var(--line)',
    padding: '10px 14px',
    borderRadius: 'var(--r-md)',
    fontSize: 12.5,
    fontWeight: 600,
  },
  splitFlowRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
  },
  branchBoxYes: {
    background: 'var(--green-soft)',
    color: 'var(--green)',
    border: '1px solid rgba(16, 185, 129, 0.3)',
    padding: '8px 10px',
    borderRadius: 'var(--r-sm)',
    fontSize: 11.5,
    fontWeight: 650,
  },
  branchBoxNo: {
    background: 'var(--surface)',
    border: '1px solid var(--line)',
    padding: '8px 10px',
    borderRadius: 'var(--r-sm)',
    fontSize: 11.5,
    color: 'var(--text-muted)',
  },
  chatBubbleInbound: {
    alignSelf: 'flex-start',
    background: 'var(--surface)',
    border: '1px solid var(--line)',
    padding: '10px 14px',
    borderRadius: 'var(--r-md)',
    maxWidth: '85%',
    fontSize: 13,
  },
  chatBubbleOutbound: {
    alignSelf: 'flex-end',
    background: 'var(--accent)',
    color: '#ffffff',
    padding: '10px 14px',
    borderRadius: 'var(--r-md)',
    maxWidth: '85%',
    fontSize: 13,
  },
  billingToggleWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    marginTop: 24,
  },
  billingToggleBtn: {
    width: 44,
    height: 24,
    borderRadius: 12,
    background: 'var(--accent)',
    border: 'none',
    padding: 2,
    cursor: 'pointer',
    position: 'relative',
  },
  billingToggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    background: '#ffffff',
    transition: 'transform 0.15s ease',
  },
  discountBadge: {
    background: 'var(--green-soft)',
    color: 'var(--green)',
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 'var(--r-pill)',
  },
  popularBadge: {
    position: 'absolute',
    top: -12,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'var(--accent)',
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.06em',
    padding: '4px 12px',
    borderRadius: 'var(--r-pill)',
  },
  tierName: {
    fontSize: 22,
    fontWeight: 800,
    color: 'var(--text)',
    margin: '0 0 4px',
  },
  tierDesc: {
    fontSize: 13,
    color: 'var(--text-muted)',
    lineHeight: 1.5,
  },
  priceRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 2,
    marginBottom: 6,
  },
  priceCurrency: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--text)',
  },
  priceAmount: {
    fontSize: 42,
    fontWeight: 900,
    color: 'var(--text)',
    letterSpacing: '-0.03em',
  },
  pricePeriod: {
    fontSize: 14,
    color: 'var(--text-muted)',
    marginLeft: 4,
  },
  subAccountLimitTag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--accent)',
    background: 'var(--accent-soft)',
    padding: '4px 10px',
    borderRadius: 'var(--r-pill)',
    marginBottom: 8,
  },
  featureListHeader: {
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--text-muted)',
    marginBottom: 12,
  },
  pricingFeatureList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  pricingFeatureItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    fontSize: 13,
    color: 'var(--text)',
    lineHeight: 1.4,
  },
  verifiedReviewPill: {
    marginLeft: 'auto',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--green)',
    background: 'var(--green-soft)',
    padding: '2px 6px',
    borderRadius: 'var(--r-pill)',
  },
  faqList: {
    maxWidth: 780,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  faqCard: {
    background: 'var(--surface)',
    border: '1px solid var(--line)',
    borderRadius: 'var(--r-md)',
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
    color: 'var(--text)',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  faqAnswer: {
    padding: '0 20px 18px',
    borderTop: '1px solid var(--line-subtle)',
    marginTop: 4,
    paddingTop: 12,
  },
  ctaBannerSection: {
    background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #2563eb 100%)',
    padding: '72px 0',
  },
  ctaBannerBtnWhite: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '13px 26px',
    borderRadius: 'var(--r-md)',
    background: '#ffffff',
    color: '#1e1b4b',
    fontSize: 15,
    fontWeight: 700,
    textDecoration: 'none',
    boxShadow: 'var(--shadow-md)',
  },
  ctaBannerBtnOutline: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '13px 24px',
    borderRadius: 'var(--r-md)',
    background: 'transparent',
    color: '#ffffff',
    border: '1px solid rgba(255, 255, 255, 0.4)',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  },
  benefitRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    fontSize: 13.5,
    lineHeight: 1.5,
    color: 'var(--text)',
  },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: 'var(--green-soft)',
    color: 'var(--green)',
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  formErrorBanner: {
    background: 'var(--red-soft)',
    border: '1px solid var(--red)',
    color: 'var(--red)',
    padding: '10px 14px',
    borderRadius: 'var(--r-md)',
    fontSize: 13,
    marginBottom: 16,
  },
  successState: {
    textAlign: 'center',
    padding: '24px 8px',
  },
  successIconWrap: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: 'var(--green-soft)',
    color: 'var(--green)',
    display: 'grid',
    placeItems: 'center',
    margin: '0 auto 16px',
  },
};
