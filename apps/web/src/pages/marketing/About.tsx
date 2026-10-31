import { Link } from 'react-router-dom';
import { SEO } from '../../components/SEO';
import { Icon } from '../../components/Icon';
import { buildBreadcrumbSchema, SCHEMA_ORGANIZATION } from '../../lib/schema';
import { trackEvent } from '../../lib/analytics';

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
        title="About Operza — Architecture, Vision & Engineering Philosophy"
        description="Learn why we built Operza: an open-architecture, high-performance agency operating system eliminating per-seat taxes and fragmented software stacks."
        canonical="/about"
        keywords={[
          'Operza business platform',
          'open-source alternative to agency CRM platforms',
          'business operating system for digital agencies',
          'agency management software',
        ]}
        jsonLd={jsonLd}
      />

      <div style={styles.pageHeader}>
        <div style={styles.container}>
          <div style={styles.breadcrumbs}>
            <Link to="/" style={styles.breadLink}>Home</Link>
            <span>/</span>
            <span style={{ color: '#4f46e5' }}>About Operza</span>
          </div>

          <h1 style={styles.h1}>
            Engineered to Solve the Agency Software Dilemma
          </h1>
          <p style={styles.lead}>
            Digital agencies and high-growth consultancies have long suffered under disjointed multi-subscription
            stacks and punitive per-user software taxes. We engineered Operza as a unified, open-architecture operating system.
          </p>
        </div>
      </div>

      <section style={styles.section}>
        <div style={styles.container}>
          <div style={styles.grid2}>
            <div>
              <span style={styles.badge}>OUR MANIFESTO</span>
              <h2 style={styles.h2}>Why Software Fragmentation Costs Agencies Millions</h2>
              <p style={styles.paragraph}>
                In modern client servicing, data lives in silos. Contacts live in one tool, emails in another,
                contracts in a third, and marketing funnels in a fourth. Zapier and Make bridges constantly break,
                generating silent failures and angry clients.
              </p>
              <p style={styles.paragraph}>
                Operza replaces that fragile web with a single coherent system. When a lead enters a funnel,
                their record is created in the PostgreSQL database, their journey is tracked on the 2D workflow canvas,
                their conversation appears in the unified inbox, and their contract is generated in the client portal.
              </p>
            </div>
            <div style={styles.cardBox}>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px', color: '#0f172a' }}>
                The Operza Core Principles
              </h3>
              <div style={styles.principleItem}>
                <strong>1. Zero Per-Seat Software Tax</strong>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
                  Agencies should never be penalized for hiring team members or bringing clients into their workspace.
                </p>
              </div>
              <div style={styles.principleItem}>
                <strong>2. Native PostgreSQL Row-Level Security</strong>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
                  Multi-tenancy belongs at the database layer, not in fragile application logic.
                </p>
              </div>
              <div style={styles.principleItem}>
                <strong>3. Absolute Data Sovereignty</strong>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
                  Self-hostable via Docker with standard relational migrations. Your client data is always yours.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section style={styles.sectionAlt}>
        <div style={styles.container}>
          <div style={{ textAlign: 'center', maxWidth: 640, margin: '0 auto 36px' }}>
            <span style={styles.badge}>INFRASTRUCTURE</span>
            <h2 style={styles.h2}>Modern Engineering Foundations</h2>
            <p style={{ fontSize: 14.5, color: '#64748b', margin: 0 }}>
              Operza is built with battle-tested technologies trusted by high-throughput systems worldwide.
            </p>
          </div>

          <div style={styles.grid3}>
            <div style={styles.techCard}>
              <div style={styles.techIcon}><Icon name="database" size={18} /></div>
              <h3 style={styles.techTitle}>PostgreSQL 16+</h3>
              <p style={styles.techDesc}>
                Relational schema integrity, foreign key cascading, and transaction-scoped RLS policies.
              </p>
            </div>
            <div style={styles.techCard}>
              <div style={styles.techIcon}><Icon name="zap" size={18} /></div>
              <h3 style={styles.techTitle}>Redis &amp; BullMQ</h3>
              <p style={styles.techDesc}>
                High-throughput distributed job scheduling with exponential retry jitter and DLQ isolation.
              </p>
            </div>
            <div style={styles.techCard}>
              <div style={styles.techIcon}><Icon name="code" size={18} /></div>
              <h3 style={styles.techTitle}>React 19 &amp; Vite</h3>
              <p style={styles.techDesc}>
                Concurrent React rendering, strict TypeScript typings, and route-based code splitting.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section style={styles.ctaBox}>
        <div style={styles.container}>
          <h2 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 10px', color: '#0f172a' }}>
            Join the Modern Agency Operating Era
          </h2>
          <p style={{ fontSize: 15, color: '#475569', maxWidth: 520, margin: '0 auto 20px', lineHeight: 1.6 }}>
            Experience the difference of a cohesive, beautifully engineered business operating system.
          </p>
          <Link
            to="/signup"
            style={styles.btnPrimary}
            onClick={() => trackEvent('signup_start', { source: 'about_bottom_cta' })}
          >
            Start Free 14-Day Trial →
          </Link>
        </div>
      </section>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageHeader: {
    padding: '60px 20px 48px',
    background: 'radial-gradient(ellipse at top, #f8fafc 0%, #ffffff 80%)',
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
  badge: {
    fontSize: 11,
    fontWeight: 700,
    color: '#4f46e5',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
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
    gridTemplateColumns: '1.2fr 1fr',
    gap: 48,
    alignItems: 'start',
  },
  h2: {
    fontSize: 28,
    fontWeight: 800,
    color: '#0f172a',
    margin: '8px 0 14px',
  },
  paragraph: {
    fontSize: 14.5,
    lineHeight: 1.65,
    color: '#475569',
    margin: '0 0 16px',
  },
  cardBox: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 24,
    boxShadow: '0 4px 16px rgba(15, 23, 42, 0.05)',
  },
  principleItem: {
    borderTop: '1px solid #f1f5f9',
    paddingTop: 12,
    marginTop: 12,
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
    width: 36,
    height: 36,
    borderRadius: 8,
    background: '#eef0ff',
    color: '#4f46e5',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  techTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: '#0f172a',
    margin: '0 0 6px',
  },
  techDesc: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 1.5,
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
  ctaBox: {
    padding: '60px 20px',
    textAlign: 'center',
    background: '#f1f5f9',
    borderTop: '1px solid #e2e8f0',
  },
};
