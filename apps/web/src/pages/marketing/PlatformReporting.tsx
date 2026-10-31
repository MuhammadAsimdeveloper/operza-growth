import { Link } from 'react-router-dom';
import { SEO } from '../../components/SEO';
import { buildBreadcrumbSchema, SCHEMA_SOFTWARE_APPLICATION } from '../../lib/schema';
import { trackEvent } from '../../lib/analytics';

export default function PlatformReporting() {
  const jsonLd = [
    SCHEMA_SOFTWARE_APPLICATION,
    buildBreadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'Platform', url: '/platform/crm' },
      { name: 'Agency Reporting', url: '/platform/reporting' },
    ]),
  ];

  return (
    <>
      <SEO
        title="Agency Reporting Software & Marketing Attribution Analytics"
        description="Deliver automated client reports, track multi-touch campaign attribution, and monitor pipeline velocity with Operza's real-time agency reporting suite."
        canonical="/platform/reporting"
        keywords={[
          'agency reporting software',
          'sales pipeline management software',
          'marketing agency CRM',
          'marketing attribution analytics',
          'agency performance dashboards',
        ]}
        jsonLd={jsonLd}
      />

      <div style={styles.pageHeader}>
        <div style={styles.container}>
          <div style={styles.breadcrumbs}>
            <Link to="/" style={styles.breadLink}>Home</Link>
            <span>/</span>
            <span style={{ color: '#4f46e5' }}>Agency Reporting &amp; Analytics</span>
          </div>

          <h1 style={styles.h1}>
            Real-Time Agency Reporting &amp; Attribution Analytics
          </h1>
          <p style={styles.lead}>
            Prove client return on investment without tedious manual spreadsheets. Track conversion rates,
            monitor pipeline velocity, and schedule automated white-label performance reports.
          </p>

          <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
            <Link
              to="/signup"
              style={styles.btnPrimary}
              onClick={() => trackEvent('signup_start', { source: 'reporting_page' })}
            >
              Start Free 14-Day Trial →
            </Link>
            <Link to="/pricing" style={styles.btnSecondary}>
              Explore Reporting Features
            </Link>
          </div>
        </div>
      </div>

      <section style={styles.section}>
        <div style={styles.container}>
          <div style={styles.grid2}>
            <div>
              <span style={styles.featureBadge}>PIPELINE VELOCITY</span>
              <h2 style={styles.h2}>Automated Performance Dashboards</h2>
              <p style={styles.paragraph}>
                Operza computes revenue and conversion metrics across all your client accounts.
                Instantly visualize deals won, average deal cycle time, and campaign attribution in one place.
              </p>
              <ul style={styles.list}>
                <li>Automated weekly and monthly PDF reports dispatched directly to client stakeholders</li>
                <li>Multi-touch channel attribution connecting inbound ad clicks to closed CRM revenue</li>
                <li>Customizable widgets: revenue forecasts, team response velocity, and funnel drop-off rates</li>
              </ul>
            </div>
            <div style={styles.cardBox}>
              <div style={styles.cardHeader}>
                <strong>Agency Growth Metrics</strong>
                <span style={styles.tagGreen}>Live Telemetry</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase' }}>Won Deals (MTD)</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>$84,200</div>
                  <div style={{ fontSize: 11.5, color: '#0f9d6e', marginTop: 2 }}>+28% vs last month</div>
                </div>
                <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase' }}>Avg Close Time</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>11 Days</div>
                  <div style={{ fontSize: 11.5, color: '#0f9d6e', marginTop: 2 }}>-4 days faster</div>
                </div>
              </div>
              <div style={{ background: '#f1f5f9', padding: 10, borderRadius: 6, fontSize: 12, color: '#475569', textAlign: 'center' }}>
                📊 Monthly Automated Client Summary scheduled for delivery on Monday 9:00 AM
              </div>
            </div>
          </div>
        </div>
      </section>

      <section style={styles.ctaBox}>
        <div style={styles.container}>
          <h2 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 10px', color: '#0f172a' }}>
            Elevate Your Agency Analytics Today
          </h2>
          <p style={{ fontSize: 15, color: '#475569', maxWidth: 520, margin: '0 auto 20px', lineHeight: 1.6 }}>
            Deliver clear, undeniable proof of performance to your retainer clients.
          </p>
          <Link
            to="/signup"
            style={styles.btnPrimary}
            onClick={() => trackEvent('signup_start', { source: 'reporting_bottom_cta' })}
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
    background: 'radial-gradient(ellipse at top, #f0f9ff 0%, #ffffff 80%)',
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
  ctaBox: {
    padding: '60px 20px',
    textAlign: 'center',
    background: '#f1f5f9',
    borderTop: '1px solid #e2e8f0',
  },
};
