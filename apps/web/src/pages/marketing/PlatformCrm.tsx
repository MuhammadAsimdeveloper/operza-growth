import { Link } from 'react-router-dom';
import { SEO } from '../../components/SEO';
import { buildBreadcrumbSchema, SCHEMA_SOFTWARE_APPLICATION } from '../../lib/schema';
import { trackEvent } from '../../lib/analytics';

export default function PlatformCrm() {
  const jsonLd = [
    SCHEMA_SOFTWARE_APPLICATION,
    buildBreadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'Platform', url: '/platform/crm' },
      { name: 'Agency CRM', url: '/platform/crm' },
    ]),
  ];

  return (
    <>
      <SEO
        title="Agency CRM Software & Sales Pipeline Management"
        description="Streamline agency sales and client operations with Operza's multi-tenant CRM. Manage contacts, multi-stage pipelines, smart lists, and custom fields with strict data isolation."
        canonical="/platform/crm"
        keywords={[
          'marketing agency CRM',
          'sales pipeline management software',
          'all-in-one CRM software',
          'lead management software',
          'CRM for digital marketing agencies',
        ]}
        jsonLd={jsonLd}
      />

      <div style={styles.pageHeader}>
        <div style={styles.container}>
          <div style={styles.breadcrumbs}>
            <Link to="/" style={styles.breadLink}>Home</Link>
            <span>/</span>
            <span style={{ color: '#4f46e5' }}>Agency CRM</span>
          </div>

          <h1 style={styles.h1}>
            Multi-Tenant Agency CRM &amp; Pipeline Management
          </h1>
          <p style={styles.lead}>
            Built specifically for digital agencies handling dozens of clients. Manage leads, track deals
            across visual Kanban pipelines, and maintain 100% strict tenant database isolation.
          </p>

          <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
            <Link
              to="/signup"
              style={styles.btnPrimary}
              onClick={() => trackEvent('signup_start', { source: 'crm_page' })}
            >
              Start 14-Day Free Trial →
            </Link>
            <Link to="/pricing" style={styles.btnSecondary}>
              Compare CRM Plans
            </Link>
          </div>
        </div>
      </div>

      <section style={styles.section}>
        <div style={styles.container}>
          <div style={styles.grid2}>
            <div>
              <span style={styles.featureBadge}>PIPELINE TRACKING</span>
              <h2 style={styles.h2}>Drag-and-Drop Opportunity Boards</h2>
              <p style={styles.paragraph}>
                Never let another qualified deal slip through the cracks. Operza delivers interactive,
                multi-stage visual Kanban boards with real-time value aggregations and weighted forecast calculations.
              </p>
              <ul style={styles.list}>
                <li>Customizable sales stages: Prospect, Discovery, Proposal Sent, Negotiation, Closed Won</li>
                <li>Instant drag-and-drop opportunity cards with deal value and primary contact tags</li>
                <li>Automatic deal creation triggered by public forms, funnels, or inbound phone calls</li>
              </ul>
            </div>
            <div style={styles.cardBox}>
              <div style={styles.cardHeader}>
                <strong>Q4 Agency Enterprise Deals</strong>
                <span style={styles.tagGreen}>Live Pipeline</span>
              </div>
              <div style={styles.mockPipeline}>
                <div style={styles.mockCard}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Zenith Retail Scaling</div>
                  <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>Stage: Proposal Sent · $14,000/mo</div>
                </div>
                <div style={styles.mockCard}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Horizon FinTech Campaign</div>
                  <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>Stage: Strategy Call · $7,500/mo</div>
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
                <strong>PostgreSQL Multi-Tenancy Architecture</strong>
                <span style={styles.tagBlue}>Row-Level Security</span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: '#0f172a', color: '#f8fafc', padding: 16, borderRadius: 8 }}>
                <span style={{ color: '#94a3b8' }}>-- Enforce agency boundary at transaction inception</span><br />
                <span style={{ color: '#818cf8' }}>BEGIN</span>;<br />
                <span style={{ color: '#38bdf8' }}>SET LOCAL</span> app.current_agency_id = <span style={{ color: '#a7f3d0' }}>'ag_8912'</span>;<br />
                <span style={{ color: '#818cf8' }}>SELECT</span> * <span style={{ color: '#818cf8' }}>FROM</span> contacts <span style={{ color: '#818cf8' }}>WHERE</span> status = <span style={{ color: '#a7f3d0' }}>'lead'</span>;<br />
                <span style={{ color: '#818cf8' }}>COMMIT</span>;
              </div>
            </div>
            <div>
              <span style={styles.featureBadge}>ENTERPRISE SECURITY</span>
              <h2 style={styles.h2}>Zero Cross-Tenant Leakage with PostgreSQL RLS</h2>
              <p style={styles.paragraph}>
                In multi-client agencies, data security is paramount. Operza eliminates shared-state bugs
                by binding tenant identity directly to database transactions using native PostgreSQL Row-Level Security.
              </p>
              <ul style={styles.list}>
                <li>Fail-closed database policies: queries fail immediately if tenant context is omitted</li>
                <li>Zero exposure of one client's contacts, leads, or invoices to another sub-account</li>
                <li>Independent custom fields and activity logs per agency workspace</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section style={styles.ctaBox}>
        <div style={styles.container}>
          <h2 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 10px', color: '#0f172a' }}>
            Empower Your Sales Team with Operza CRM
          </h2>
          <p style={{ fontSize: 15, color: '#475569', maxWidth: 520, margin: '0 auto 20px', lineHeight: 1.6 }}>
            Ready to experience an agency CRM that’s fast, reliable, and free of per-seat software taxes?
          </p>
          <Link
            to="/signup"
            style={styles.btnPrimary}
            onClick={() => trackEvent('signup_start', { source: 'crm_bottom_cta' })}
          >
            Start Your Free Trial →
          </Link>
        </div>
      </section>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageHeader: {
    padding: '60px 20px 48px',
    background: 'radial-gradient(ellipse at top, #f8faff 0%, #ffffff 80%)',
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
  tagGreen: {
    background: '#e6f7f1',
    color: '#0f9d6e',
    padding: '3px 8px',
    borderRadius: 99,
    fontSize: 11,
    fontWeight: 600,
  },
  tagBlue: {
    background: '#e8f1fd',
    color: '#1d6ce0',
    padding: '3px 8px',
    borderRadius: 99,
    fontSize: 11,
    fontWeight: 600,
  },
  mockPipeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  mockCard: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 12,
  },
  ctaBox: {
    padding: '60px 20px',
    textAlign: 'center',
    background: '#f1f5f9',
    borderTop: '1px solid #e2e8f0',
  },
};
