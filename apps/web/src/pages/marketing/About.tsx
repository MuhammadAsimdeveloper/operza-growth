import { Link } from 'react-router-dom';
import { SEO } from '../../components/SEO';
import { Icon } from '../../components/Icon';
import { buildBreadcrumbSchema, SCHEMA_ORGANIZATION } from '../../lib/schema';
import { trackEvent } from '../../lib/analytics';

interface ArchitectureComponent {
  layer: string;
  technology: string;
  role: string;
  guarantee: string;
  status: 'Verified' | 'Active';
}

const ARCHITECTURE_COMPONENTS: ArchitectureComponent[] = [
  { layer: 'Database Kernel', technology: 'PostgreSQL 16+', role: 'Row-Level Security (RLS) Multi-Tenant Policies', guarantee: 'Fail-Closed Isolation', status: 'Verified' },
  { layer: 'Durable Queue', technology: 'Transactional Outbox', role: 'PostgreSQL-backed Event Bus & Idempotency Receipts', guarantee: 'Zero Action Duplication', status: 'Verified' },
  { layer: 'Workflow Engine', technology: 'Async Worker Mesh', role: '2D Visual Flow Execution, Wait Delays & Resumptions', guarantee: 'Deterministic Recovery', status: 'Verified' },
  { layer: 'API Gateway', technology: 'Node.js & Fastify', role: 'Type-Safe Ingress, Rate-Limiting & RBAC Authorization', guarantee: 'Strict Schema Validation', status: 'Verified' },
  { layer: 'Deployment', technology: 'Docker & Compose', role: 'Self-Hosted or Cloud-Hosted Portable Containers', guarantee: '100% Data Sovereignty', status: 'Verified' },
  { layer: 'Web Application', technology: 'Vite & React 18', role: 'Responsive Agency Workspace & Client Portal Interface', guarantee: 'Zero Per-Seat Tax', status: 'Verified' },
];

const MILESTONES = [
  {
    year: 'Q1 2024',
    title: 'Kernel Architecture & PostgreSQL RLS Engine',
    desc: 'Implemented fail-closed multi-tenancy at the database row level, eliminating cross-tenant leakage risks at the relational engine.',
  },
  {
    year: 'Q3 2024',
    title: '2D Visual Automation Canvas & Outbox Backbone',
    desc: 'Shipped interactive node-and-wire flow builder with transactional outbox event logging, leases, and deterministic error handling.',
  },
  {
    year: 'Q1 2025',
    title: 'Omnichannel Ingress & Communication Consent',
    desc: 'Delivered bidirectional SMS, WhatsApp Cloud API, and verified email communications with explicit recipient consent ledgers.',
  },
  {
    year: 'Q3 2025',
    title: 'White-Label Client Portal & Sub-Account Snapshots',
    desc: 'Shipped custom CNAME client portals with digital contract e-signing and template snapshot replication across agency client sub-accounts.',
  },
  {
    year: '2026',
    title: 'Action Idempotency, Fencing & $35 Value Architecture',
    desc: 'Hardened durable execution with provider-level idempotency receipts, separation of duties, and disruptive $35/mo agency pricing.',
  },
];

const CORE_PILLARS = [
  {
    name: 'Relational Multi-Tenancy',
    role: 'Database Kernel & Data Isolation',
    bio: 'Fail-closed PostgreSQL Row-Level Security ensuring absolute tenant separation at the query layer with zero risk of ORM cross-tenant leakage.',
    avatar: 'DB',
  },
  {
    name: 'Transactional Outbox & Workers',
    role: 'Reliability & Idempotency Mesh',
    bio: 'Robust asynchronous execution preventing duplicate email/SMS dispatch and ensuring full recovery during network or worker interruptions.',
    avatar: 'WQ',
  },
  {
    name: 'Separation of Duties & Approvals',
    role: 'Action Governance & Audit Trails',
    bio: 'Explicit approval gates, anti-tampering checksums, and strict segregation between action requesters and authorizers.',
    avatar: 'AG',
  },
  {
    name: 'Agency Economics First',
    role: 'Open-Architecture Pricing Model',
    bio: 'Transparent fixed-tier subscriptions eliminating punitive per-seat licensing to enable agency team growth with predictable margins.',
    avatar: 'OP',
  },
];

export default function About() {
  const jsonLd = [
    SCHEMA_ORGANIZATION,
    buildBreadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'About Operza', url: '/about' },
    ]),
  ];

  return (
    <>
      <SEO
        title="About Operza — Architecture, Enterprise Trust & Company Vision"
        description="Learn why we engineered Operza: the open-architecture, high-performance agency operating system eliminating software fragmentation and per-seat taxes."
        canonical="/about"
        keywords={[
          'Operza business platform',
          'open-source alternative to agency CRM platforms',
          'business operating system for digital agencies',
          'agency management software',
          'PostgreSQL RLS multi-tenancy',
          'self-hosted CRM',
        ]}
        jsonLd={jsonLd}
      />

      {/* ─── Hero Section with 3D Trust Telemetry ─── */}
      <div style={styles.pageHeader}>
        <div style={styles.container}>
          <div style={styles.breadcrumbs}>
            <Link to="/" style={styles.breadLink}>Home</Link>
            <span>/</span>
            <span style={{ color: '#4f46e5' }}>About Operza</span>
          </div>

          <div style={styles.badgeRow}>
            <span style={styles.badge}>THE OPERZA MANIFESTO &amp; INFRASTRUCTURE</span>
          </div>

          <h1 style={styles.h1}>
            Engineered to Solve the Agency <br />
            <span style={styles.h1Gradient}>Software Dilemma</span>
          </h1>

          <p style={styles.lead}>
            Digital agencies and high-growth teams have long suffered under disjointed multi-subscription
            sprawl ($1,800+/user/year), brittle webhook middleware, and punitive per-seat user taxes.
            We built Operza as a unified, open-architecture operating system with zero per-seat tax.
          </p>

          {/* Factual Architectural Specifications */}
          <div style={styles.telemetryBar} className="card-3d-interactive">
            <div style={styles.telemetryItem}>
              <div style={styles.telemetryNum}>PostgreSQL RLS</div>
              <div style={styles.telemetryLabel}>Fail-Closed Multi-Tenancy</div>
            </div>
            <div style={styles.telemetryDivider} />
            <div style={styles.telemetryItem}>
              <div style={styles.telemetryNum}>32 Migrations</div>
              <div style={styles.telemetryLabel}>Versioned Relational Schema</div>
            </div>
            <div style={styles.telemetryDivider} />
            <div style={styles.telemetryItem}>
              <div style={styles.telemetryNum}>Durable Outbox</div>
              <div style={styles.telemetryLabel}>Recoverable Job Execution</div>
            </div>
            <div style={styles.telemetryDivider} />
            <div style={styles.telemetryItem}>
              <div style={styles.telemetryNum}>$0 Seat Tax</div>
              <div style={styles.telemetryLabel}>Unlimited Team Members</div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── The Problem vs Solution (Why We Built Operza) ─── */}
      <section style={styles.section}>
        <div style={styles.container}>
          <div style={styles.grid2}>
            <div>
              <span style={styles.badge}>ORIGIN &amp; PURPOSE</span>
              <h2 style={styles.h2}>The 8-Tool Fragmentation Trap</h2>
              <p style={styles.paragraph}>
                In modern agency operations, data is scattered across incompatible silos. Contacts live in one tool,
                pipeline deals in another, marketing funnels in a third, emails in a fourth, contracts in a fifth,
                and invoicing in a sixth.
              </p>
              <p style={styles.paragraph}>
                Agencies connect these silos with fragile webhook bridges and iPaaS triggers. When a single webhook
                fails silently or a schema field changes, sales leads vanish, deals stall, and clients become frustrated.
                On top of that, legacy SaaS vendors charge punitive per-seat taxes that punish agencies for growing their team.
              </p>
              <p style={styles.paragraph}>
                Operza replaces that fragile web with a <strong>single coherent transactional kernel</strong>. When a lead
                enters a funnel or submits a form, their contact record is immediately written to the PostgreSQL database,
                their workflow begins on the visual canvas, their conversation appears in the unified inbox, and their contract
                is generated in the white-label client portal—without a single third-party webhook.
              </p>
            </div>

            <div style={styles.cardBox} className="card-3d-interactive">
              <h3 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 16px', color: '#0f172a' }}>
                The Operza Core Tenets
              </h3>
              <div style={styles.principleItem}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={styles.tenetNum}>01</span>
                  <strong style={{ fontSize: 14.5, color: '#0f172a' }}>Zero Per-Seat Software Tax</strong>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                  Agencies should never be penalized for hiring staff, interns, or account managers. Unlimited seats on every plan.
                </p>
              </div>

              <div style={styles.principleItem}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={styles.tenetNum}>02</span>
                  <strong style={{ fontSize: 14.5, color: '#0f172a' }}>Database-Native Row-Level Security</strong>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                  Multi-tenant isolation belongs in PostgreSQL policies (<code style={{ fontSize: 11.5 }}>SET LOCAL app.current_agency_id</code>), not in leaky application-layer code.
                </p>
              </div>

              <div style={styles.principleItem}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={styles.tenetNum}>03</span>
                  <strong style={{ fontSize: 14.5, color: '#0f172a' }}>Absolute Data Sovereignty &amp; Self-Hosting</strong>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                  Deploy on your own AWS, DigitalOcean, or Hetzner server via Docker with standard SQL migrations. Zero vendor lock-in.
                </p>
              </div>

              <div style={styles.principleItem}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={styles.tenetNum}>04</span>
                  <strong style={{ fontSize: 14.5, color: '#0f172a' }}>Honest Engineering &amp; Telemetry</strong>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                  We never display fake connections, simulated successes, or unverified telephony states. Everything is verified against real infrastructure.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Modular System Architecture & Infrastructure Mesh ─── */}
      <section style={styles.sectionAlt}>
        <div style={styles.container}>
          <div style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 40px' }}>
            <span style={styles.badge}>SYSTEM ARCHITECTURE</span>
            <h2 style={styles.h2}>Containerized &amp; Production-Proven Stack</h2>
            <p style={{ fontSize: 15, color: '#64748b', margin: 0, lineHeight: 1.6 }}>
              Operza is engineered with modular, battle-tested open-source primitives for self-hosted sovereignty or cloud-managed deployment.
            </p>
          </div>

          <div style={styles.datacenterGrid}>
            {ARCHITECTURE_COMPONENTS.map((comp) => (
              <div key={comp.layer} style={styles.nodeCard} className="card-3d-interactive">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={styles.nodeRegion}>{comp.layer}</span>
                  <span style={styles.nodeLatency}>{comp.technology}</span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 750, color: '#0f172a', marginBottom: 4 }}>
                  {comp.guarantee}
                </div>
                <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 12, lineHeight: 1.4 }}>
                  {comp.role}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#15803d', fontWeight: 650 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
                  {comp.status}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Security, Governance & Verifiable Architecture Controls ─── */}
      <section style={styles.section}>
        <div style={styles.container}>
          <div style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 40px' }}>
            <span style={styles.badge}>ENGINEERING INTEGRITY &amp; GOVERNANCE</span>
            <h2 style={styles.h2}>Verifiable Security Architecture by Design</h2>
            <p style={{ fontSize: 15, color: '#64748b', margin: 0, lineHeight: 1.6 }}>
              Built with fail-closed security guarantees, deterministic idempotency fencing, and immutable audit trails.
            </p>
          </div>

          <div style={styles.trustGrid}>
            <div style={styles.trustCard} className="card-3d-interactive">
              <div style={styles.trustIcon}><Icon name="shield" size={24} /></div>
              <h3 style={styles.trustTitle}>PostgreSQL Row-Level Security</h3>
              <p style={styles.trustDesc}>
                Cryptographic tenant isolation enforced directly in SQL engine transactions. Leaks are impossible even with application bugs.
              </p>
              <div style={styles.trustPill}>Fail-Closed DB Policies</div>
            </div>

            <div style={styles.trustCard} className="card-3d-interactive">
              <div style={styles.trustIcon}><Icon name="lock" size={24} /></div>
              <h3 style={styles.trustTitle}>Durable Action Idempotency</h3>
              <p style={styles.trustDesc}>
                PostgreSQL action receipts, provider lease fencing, and SHA-256 action hashing protect against duplicate external side effects.
              </p>
              <div style={styles.trustPill}>Receipt &amp; Lease Fencing</div>
            </div>

            <div style={styles.trustCard} className="card-3d-interactive">
              <div style={styles.trustIcon}><Icon name="database" size={24} /></div>
              <h3 style={styles.trustTitle}>Data Sovereignty &amp; SQL Migrations</h3>
              <p style={styles.trustDesc}>
                Zero proprietary database extensions. Standard PostgreSQL migrations ensure complete self-hosting freedom and portable data.
              </p>
              <div style={styles.trustPill}>Zero Vendor Lock-In</div>
            </div>

            <div style={styles.trustCard} className="card-3d-interactive">
              <div style={styles.trustIcon}><Icon name="clipboard" size={24} /></div>
              <h3 style={styles.trustTitle}>Separation of Duties &amp; Consent</h3>
              <p style={styles.trustDesc}>
                Four-eyes approval enforcement, anti-tampering evidence checksums, and explicit communication consent registers.
              </p>
              <div style={styles.trustPill}>Multi-Party Governance</div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Company Journey & Milestones Roadmap ─── */}
      <section style={styles.sectionAlt}>
        <div style={styles.container}>
          <div style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 40px' }}>
            <span style={styles.badge}>CHRONOLOGY</span>
            <h2 style={styles.h2}>The Operza Journey</h2>
            <p style={{ fontSize: 15, color: '#64748b', margin: 0 }}>
              From a single-schema prototype to an enterprise operating system powering reliable agency operations.
            </p>
          </div>

          <div style={styles.timeline}>
            {MILESTONES.map((m) => (
              <div key={m.year} style={styles.timelineItem}>
                <div style={styles.timelineDot} />
                <div style={styles.timelineYear}>{m.year}</div>
                <div style={styles.timelineContent}>
                  <h3 style={{ fontSize: 16, fontWeight: 750, color: '#0f172a', margin: '0 0 6px' }}>
                    {m.title}
                  </h3>
                  <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.5, margin: 0 }}>
                    {m.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Core Architecture & Engineering Pillars ─── */}
      <section style={styles.section}>
        <div style={styles.container}>
          <div style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 40px' }}>
            <span style={styles.badge}>FOUNDATIONS</span>
            <h2 style={styles.h2}>Engineered by Systems Practitioners</h2>
            <p style={{ fontSize: 15, color: '#64748b', margin: 0 }}>
              Built from distributed systems, relational kernels, and transparent agency economics.
            </p>
          </div>

          <div style={styles.teamGrid}>
            {CORE_PILLARS.map((pillar) => (
              <div key={pillar.name} style={styles.teamCard} className="card-3d-interactive">
                <div style={styles.avatarCircle}>{pillar.avatar}</div>
                <h3 style={{ fontSize: 17, fontWeight: 750, color: '#0f172a', margin: '0 0 4px' }}>
                  {pillar.name}
                </h3>
                <div style={{ fontSize: 12.5, color: '#4f46e5', fontWeight: 650, marginBottom: 10 }}>
                  {pillar.role}
                </div>
                <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.55, margin: 0 }}>
                  {pillar.bio}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Bottom CTA Box ─── */}
      <section style={styles.ctaBox}>
        <div style={styles.container}>
          <h2 style={{ fontSize: 32, fontWeight: 850, margin: '0 0 12px', color: '#0f172a' }}>
            Experience the Cohesive Operating System
          </h2>
          <p style={{ fontSize: 16, color: '#475569', maxWidth: 540, margin: '0 auto 24px', lineHeight: 1.6 }}>
            Eliminate software sprawl, reclaim thousands in monthly tool spend, and provide your team with an integrated platform.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link
              to="/signup"
              style={styles.btnPrimary}
              onClick={() => trackEvent('signup_start', { source: 'about_bottom_cta' })}
            >
              Start Free 14-Day Trial →
            </Link>
            <Link to="/pricing" style={styles.btnSecondary}>
              View $35 Starter &amp; Growth Plans
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageHeader: {
    padding: '64px 20px 48px',
    background: 'radial-gradient(ellipse at top, #eef2ff 0%, #ffffff 80%)',
    borderBottom: '1px solid #e2e8f0',
  },
  container: {
    maxWidth: 1140,
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
  badgeRow: {
    marginBottom: 12,
  },
  badge: {
    fontSize: 11,
    fontWeight: 700,
    color: '#4f46e5',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    background: 'rgba(79, 70, 229, 0.08)',
    padding: '4px 12px',
    borderRadius: 99,
  },
  h1: {
    fontSize: 44,
    fontWeight: 850,
    letterSpacing: '-0.03em',
    color: '#0f172a',
    margin: '0 0 16px',
    lineHeight: 1.15,
  },
  h1Gradient: {
    background: 'linear-gradient(135deg, #4f46e5, #0ea5e9)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  lead: {
    fontSize: 17,
    color: '#475569',
    maxWidth: 720,
    lineHeight: 1.6,
    margin: '0 0 32px',
  },
  telemetryBar: {
    background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
    borderRadius: 14,
    padding: '22px 28px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    alignItems: 'center',
    gap: 16,
    boxShadow: '0 12px 36px rgba(15, 23, 42, 0.2)',
  },
  telemetryItem: {
    textAlign: 'center',
  },
  telemetryNum: {
    fontSize: 28,
    fontWeight: 850,
    color: '#38bdf8',
    letterSpacing: '-0.02em',
  },
  telemetryLabel: {
    fontSize: 11.5,
    color: '#cbd5e1',
    marginTop: 4,
  },
  telemetryDivider: {
    display: 'none',
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
  grid2: {
    display: 'grid',
    gridTemplateColumns: '1.2fr 1fr',
    gap: 48,
    alignItems: 'start',
  },
  h2: {
    fontSize: 32,
    fontWeight: 850,
    color: '#0f172a',
    margin: '8px 0 14px',
    letterSpacing: '-0.02em',
  },
  paragraph: {
    fontSize: 15,
    lineHeight: 1.7,
    color: '#475569',
    margin: '0 0 18px',
  },
  cardBox: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 16,
    padding: '28px',
    boxShadow: '0 6px 20px rgba(15, 23, 42, 0.04)',
  },
  principleItem: {
    borderTop: '1px solid #f1f5f9',
    paddingTop: 14,
    marginTop: 14,
  },
  tenetNum: {
    width: 26,
    height: 26,
    borderRadius: 6,
    background: '#eef2ff',
    color: '#4f46e5',
    fontSize: 12,
    fontWeight: 800,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  datacenterGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 20,
  },
  nodeCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '20px',
    boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)',
  },
  nodeRegion: {
    fontSize: 11,
    fontWeight: 750,
    color: '#64748b',
    background: '#f1f5f9',
    padding: '2px 8px',
    borderRadius: 4,
    letterSpacing: '0.04em',
  },
  nodeLatency: {
    fontSize: 12,
    fontWeight: 750,
    color: '#10b981',
    background: 'rgba(16, 185, 129, 0.1)',
    padding: '2px 8px',
    borderRadius: 4,
  },
  trustGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 22,
  },
  trustCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    padding: '24px 20px',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 4px 14px rgba(15, 23, 42, 0.03)',
  },
  trustIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    background: '#eef2ff',
    color: '#4f46e5',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  trustTitle: {
    fontSize: 17,
    fontWeight: 750,
    color: '#0f172a',
    margin: '0 0 8px',
  },
  trustDesc: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 1.55,
    margin: '0 0 16px',
    flex: 1,
  },
  trustPill: {
    fontSize: 11,
    fontWeight: 700,
    color: '#059669',
    background: '#dcfce7',
    padding: '3px 8px',
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  timeline: {
    maxWidth: 720,
    margin: '0 auto',
    position: 'relative',
    paddingLeft: 32,
    borderLeft: '2px solid #e2e8f0',
  },
  timelineItem: {
    position: 'relative',
    marginBottom: 32,
  },
  timelineDot: {
    position: 'absolute',
    left: -38,
    top: 4,
    width: 14,
    height: 14,
    borderRadius: '50%',
    background: '#4f46e5',
    border: '3px solid #ffffff',
    boxShadow: '0 0 0 2px #4f46e5',
  },
  timelineYear: {
    fontSize: 12,
    fontWeight: 800,
    color: '#4f46e5',
    letterSpacing: '0.06em',
    marginBottom: 4,
  },
  timelineContent: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: '16px 20px',
    boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)',
  },
  teamGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 22,
  },
  teamCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    padding: '24px 20px',
    textAlign: 'center',
    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.03)',
  },
  avatarCircle: {
    width: 54,
    height: 54,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #4f46e5, #0ea5e9)',
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 800,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 14px',
    boxShadow: '0 4px 12px rgba(79, 70, 229, 0.25)',
  },
  btnPrimary: {
    display: 'inline-block',
    padding: '12px 24px',
    background: '#4f46e5',
    color: '#ffffff',
    borderRadius: 9,
    fontWeight: 650,
    fontSize: 14.5,
    textDecoration: 'none',
    boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)',
  },
  btnSecondary: {
    display: 'inline-block',
    padding: '12px 24px',
    background: '#ffffff',
    border: '1px solid #cbd5e1',
    color: '#1e293b',
    borderRadius: 9,
    fontWeight: 650,
    fontSize: 14.5,
    textDecoration: 'none',
  },
  ctaBox: {
    padding: '70px 20px',
    textAlign: 'center',
    background: '#f1f5f9',
    borderTop: '1px solid #e2e8f0',
  },
};
