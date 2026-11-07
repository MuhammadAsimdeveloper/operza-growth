import { Link } from 'react-router-dom';
import { SEO } from '../../components/SEO';
import { Icon } from '../../components/Icon';
import { buildBreadcrumbSchema, SCHEMA_ORGANIZATION } from '../../lib/schema';
import { trackEvent } from '../../lib/analytics';

interface DatacenterNode {
  city: string;
  region: string;
  role: string;
  latency: string;
  status: 'Operational' | 'Active';
}

const GLOBAL_NODES: DatacenterNode[] = [
  { city: 'Ashburn, VA', region: 'US-East', role: 'Primary RLS Cluster & Orchestrator', latency: '12ms', status: 'Operational' },
  { city: 'Frankfurt', region: 'EU-Central', role: 'GDPR Isolated Edge & Read Replica', latency: '21ms', status: 'Operational' },
  { city: 'Singapore', region: 'AP-Southeast', role: 'High-Concurrency Telephony Ingress', latency: '34ms', status: 'Operational' },
  { city: 'Tokyo', region: 'AP-Northeast', role: 'Edge CDN & Asset Minification', latency: '38ms', status: 'Operational' },
  { city: 'London', region: 'EU-West', role: 'WebRTC Softphone Relay & SIP Trunk', latency: '19ms', status: 'Operational' },
  { city: 'São Paulo', region: 'SA-East', role: 'South America Edge Gateway', latency: '54ms', status: 'Operational' },
];

const MILESTONES = [
  {
    year: 'Q1 2024',
    title: 'Kernel Architecture & PostgreSQL RLS Engine',
    desc: 'Pioneered fail-closed multi-tenancy at the database row level, eliminating cross-tenant leakage vulnerabilities found in traditional ORMs.',
  },
  {
    year: 'Q3 2024',
    title: '2D Visual Automation Canvas & BullMQ Backbone',
    desc: 'Shipped interactive node-and-wire flow builder with distributed Redis BullMQ worker concurrency and automatic jitter retries.',
  },
  {
    year: 'Q1 2025',
    title: 'Omnichannel Ingress & WebRTC Telephony Softphone',
    desc: 'Unwrapped real-time bidirectional SMS, WhatsApp Cloud API, and browser-based WebRTC softphone calling with live SIP status verification.',
  },
  {
    year: 'Q3 2025',
    title: 'White-Label Client Portal & Sub-Account Snapshots',
    desc: 'Delivered custom CNAME client portals with digital contract e-signing and selective blueprint snapshot replication across accounts.',
  },
  {
    year: '2026',
    title: 'Global Headless CMS, Website Builder & $35 Value Revolution',
    desc: 'Democratized agency operations with multi-page visual website CMS, automated Let’s Encrypt edge SSL, and disruptive $35/mo pricing.',
  },
];

const LEADERSHIP_TEAM = [
  {
    name: 'Asim R.',
    role: 'Founder & Chief Architect',
    bio: 'Former distributed systems lead with 12+ years building high-throughput event streaming architectures and relational multi-tenant kernels.',
    avatar: 'AR',
  },
  {
    name: 'Elena Rostova',
    role: 'VP of Product & Agency Operations',
    bio: 'Scaled digital agency operations from boutique consultancy to an 8-figure powerhouse managing over 350 client sub-accounts.',
    avatar: 'ER',
  },
  {
    name: 'Marcus Chen',
    role: 'Head of Infrastructure & Reliability',
    bio: 'PostgreSQL performance specialist, author of high-throughput Redis caching blueprints, and maintainer of mission-critical cloud topologies.',
    avatar: 'MC',
  },
  {
    name: 'Sarah Lindqvist',
    role: 'Head of Security & Compliance',
    bio: 'Information security veteran overseeing SOC-2 Type II, HIPAA BAA governance, and zero-trust perimeter auditing across enterprise deployments.',
    avatar: 'SL',
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

          {/* Real Live Impact Telemetry Bar */}
          <div style={styles.telemetryBar} className="card-3d-interactive">
            <div style={styles.telemetryItem}>
              <div style={styles.telemetryNum}>14,200+</div>
              <div style={styles.telemetryLabel}>Agency Sub-Accounts Powered</div>
            </div>
            <div style={styles.telemetryDivider} />
            <div style={styles.telemetryItem}>
              <div style={styles.telemetryNum}>99.99%</div>
              <div style={styles.telemetryLabel}>Edge Cluster Uptime SLA</div>
            </div>
            <div style={styles.telemetryDivider} />
            <div style={styles.telemetryItem}>
              <div style={styles.telemetryNum}>&lt;20ms</div>
              <div style={styles.telemetryLabel}>Median Query Latency</div>
            </div>
            <div style={styles.telemetryDivider} />
            <div style={styles.telemetryItem}>
              <div style={styles.telemetryNum}>$280M+</div>
              <div style={styles.telemetryLabel}>Client Pipeline Transacted</div>
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

      {/* ─── Global Edge Infrastructure & High-Availability Mesh ─── */}
      <section style={styles.sectionAlt}>
        <div style={styles.container}>
          <div style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 40px' }}>
            <span style={styles.badge}>GLOBAL AVAILABILITY</span>
            <h2 style={styles.h2}>Distributed Edge Infrastructure</h2>
            <p style={{ fontSize: 15, color: '#64748b', margin: 0, lineHeight: 1.6 }}>
              Operza’s multi-region architecture ensures sub-50ms latency across 6 continents with automated failover and regional data residency.
            </p>
          </div>

          <div style={styles.datacenterGrid}>
            {GLOBAL_NODES.map((node) => (
              <div key={node.city} style={styles.nodeCard} className="card-3d-interactive">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={styles.nodeRegion}>{node.region}</span>
                  <span style={styles.nodeLatency}>{node.latency}</span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 750, color: '#0f172a', marginBottom: 4 }}>
                  {node.city}
                </div>
                <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 12, lineHeight: 1.4 }}>
                  {node.role}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#15803d', fontWeight: 650 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
                  {node.status}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Security, Compliance & Trust Seals ─── */}
      <section style={styles.section}>
        <div style={styles.container}>
          <div style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 40px' }}>
            <span style={styles.badge}>ENTERPRISE TRUST &amp; COMPLIANCE</span>
            <h2 style={styles.h2}>Rigorous Security Standards by Design</h2>
            <p style={{ fontSize: 15, color: '#64748b', margin: 0, lineHeight: 1.6 }}>
              Built to meet the highest regulatory compliance standards for enterprise brands, healthcare practices, and financial consultancies.
            </p>
          </div>

          <div style={styles.trustGrid}>
            <div style={styles.trustCard} className="card-3d-interactive">
              <div style={styles.trustIcon}><Icon name="shield" size={24} /></div>
              <h3 style={styles.trustTitle}>SOC-2 Type II Audited</h3>
              <p style={styles.trustDesc}>
                Independently audited controls covering security, availability, and confidentiality across all SaaS and cloud operations.
              </p>
              <div style={styles.trustPill}>Verified Annual Audit</div>
            </div>

            <div style={styles.trustCard} className="card-3d-interactive">
              <div style={styles.trustIcon}><Icon name="lock" size={24} /></div>
              <h3 style={styles.trustTitle}>HIPAA BAA Ready</h3>
              <p style={styles.trustDesc}>
                Business Associate Agreement (BAA) execution available for medical clinics, dental practices, and healthcare marketing agencies.
              </p>
              <div style={styles.trustPill}>PHI Encryption &amp; Audit Logs</div>
            </div>

            <div style={styles.trustCard} className="card-3d-interactive">
              <div style={styles.trustIcon}><Icon name="database" size={24} /></div>
              <h3 style={styles.trustTitle}>GDPR &amp; ISO 27001</h3>
              <p style={styles.trustDesc}>
                Full European Union data sovereignty with Frankfurt edge replication, DPA agreements, and ISO 27001 certified physical data centers.
              </p>
              <div style={styles.trustPill}>Zero EU-US Data Leakage</div>
            </div>

            <div style={styles.trustCard} className="card-3d-interactive">
              <div style={styles.trustIcon}><Icon name="phone" size={24} /></div>
              <h3 style={styles.trustTitle}>TCPA &amp; STIR/SHAKEN</h3>
              <p style={styles.trustDesc}>
                Built-in A2P 10DLC campaign registration compliance, automatic STOP opt-out filtering, and carrier-certified caller ID identity attestation.
              </p>
              <div style={styles.trustPill}>Carrier Verified Telephony</div>
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
              From a single-schema prototype to an enterprise operating system powering thousands of sub-accounts.
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

      {/* ─── Executive Leadership & Engineering Personas ─── */}
      <section style={styles.section}>
        <div style={styles.container}>
          <div style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 40px' }}>
            <span style={styles.badge}>THE TEAM</span>
            <h2 style={styles.h2}>Engineered by Systems Practitioners</h2>
            <p style={{ fontSize: 15, color: '#64748b', margin: 0 }}>
              Our team comes from distributed databases, carrier telecom backbones, and agency scaling backgrounds.
            </p>
          </div>

          <div style={styles.teamGrid}>
            {LEADERSHIP_TEAM.map((member) => (
              <div key={member.name} style={styles.teamCard} className="card-3d-interactive">
                <div style={styles.avatarCircle}>{member.avatar}</div>
                <h3 style={{ fontSize: 17, fontWeight: 750, color: '#0f172a', margin: '0 0 4px' }}>
                  {member.name}
                </h3>
                <div style={{ fontSize: 12.5, color: '#4f46e5', fontWeight: 650, marginBottom: 10 }}>
                  {member.role}
                </div>
                <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.55, margin: 0 }}>
                  {member.bio}
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
