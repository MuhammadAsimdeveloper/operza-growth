import { Link } from 'react-router-dom';
import { SEO } from '../../components/SEO';
import { buildBreadcrumbSchema, SCHEMA_SOFTWARE_APPLICATION } from '../../lib/schema';
import { trackEvent } from '../../lib/analytics';

export default function PlatformFunnels() {
  const jsonLd = [
    SCHEMA_SOFTWARE_APPLICATION,
    buildBreadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'Platform', url: '/platform/crm' },
      { name: 'Funnels & Landing Pages', url: '/platform/funnels' },
    ]),
  ];

  return (
    <>
      <SEO
        title="Sales Funnel Builder & Drag-and-Drop Landing Page Creator"
        description="Craft high-converting sales funnels, lead opt-in pages, and checkout flows with Operza. Drag-and-drop WYSIWYG builder, 1-click order bumps, and custom domain routing."
        canonical="/platform/funnels"
        keywords={[
          'funnel builder software',
          'landing page builder',
          'marketing funnel automation',
          'lead management software',
          'sales funnel builder',
        ]}
        jsonLd={jsonLd}
      />

      <div style={styles.pageHeader}>
        <div style={styles.container}>
          <div style={styles.breadcrumbs}>
            <Link to="/" style={styles.breadLink}>Home</Link>
            <span>/</span>
            <span style={{ color: '#4f46e5' }}>Funnels &amp; Landing Pages</span>
          </div>

          <h1 style={styles.h1}>
            High-Converting Funnel Builder &amp; Landing Page Creator
          </h1>
          <p style={styles.lead}>
            Design conversion-optimized marketing funnels and lead capture landing pages in minutes.
            Features responsive device previews, dynamic 1-click order bumps, and instant custom CNAME domain publishing.
          </p>

          <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
            <Link
              to="/signup"
              style={styles.btnPrimary}
              onClick={() => trackEvent('signup_start', { source: 'funnels_page' })}
            >
              Start Building Funnels →
            </Link>
            <Link to="/pricing" style={styles.btnSecondary}>
              Explore Funnel Pricing
            </Link>
          </div>
        </div>
      </div>

      <section style={styles.section}>
        <div style={styles.container}>
          <div style={styles.grid2}>
            <div>
              <span style={styles.featureBadge}>WYSIWYG CANVAS</span>
              <h2 style={styles.h2}>Element-Level In-Browser Page Editor</h2>
              <p style={styles.paragraph}>
                Build high-velocity marketing pages with modular building blocks: bold hero headlines,
                responsive two-column feature layouts, ticking urgency timers, and customer testimonials.
              </p>
              <ul style={styles.list}>
                <li>Instant device preview simulation across Desktop (100%), Tablet (768px), and Mobile (375px)</li>
                <li>Live countdown timer elements to drive urgency and immediate visitor conversions</li>
                <li>Direct integration with Operza CRM contacts and automated onboarding pipelines</li>
              </ul>
            </div>
            <div style={styles.cardBox}>
              <div style={styles.cardHeader}>
                <strong>Funnel Preview Engine</strong>
                <span style={styles.tagGreen}>Live Rendering</span>
              </div>
              <div style={{ background: '#0f172a', borderRadius: 8, padding: 20, color: '#f8fafc', textAlign: 'center' }}>
                <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#818cf8', marginBottom: 6 }}>
                  High-Converting Agency Offer
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, margin: '0 0 10px' }}>
                  Unlock 3x Pipeline Qualified Leads
                </div>
                <div style={{ display: 'inline-block', background: '#312e81', padding: '6px 14px', borderRadius: 6, fontSize: 13, marginBottom: 14 }}>
                  ⏳ Offer Expires In: 14:59
                </div>
                <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px dashed #6366f1', padding: 12, borderRadius: 6, textAlign: 'left', fontSize: 12 }}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" defaultChecked />
                    <span><strong>1-Click Order Bump:</strong> Add Agency SOP Blueprint Collection ($297)</span>
                  </label>
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
                <strong>Custom CNAME &amp; Edge Network</strong>
                <span style={styles.tagIndigo}>SSL Auto-Provisioned</span>
              </div>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                    <th style={{ padding: '6px 0' }}>Type</th>
                    <th>Host</th>
                    <th>Value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 0', fontFamily: 'var(--font-mono)' }}>CNAME</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>go</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>cname.operza.io</td>
                    <td style={{ color: '#0f9d6e', fontWeight: 600 }}>● Active</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 0', fontFamily: 'var(--font-mono)' }}>A</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>@</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>76.76.21.21</td>
                    <td style={{ color: '#0f9d6e', fontWeight: 600 }}>● Active</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <span style={styles.featureBadge}>CUSTOM DOMAINS &amp; SEO</span>
              <h2 style={styles.h2}>Deploy on Your Vanity Hostnames with SSL</h2>
              <p style={styles.paragraph}>
                Every funnel and site page can be published directly to custom domains with automated Let's Encrypt
                TLS/SSL certificates. Configure maintenance modes, header/footer tracking pixels, and SEO metadata with ease.
              </p>
              <ul style={styles.list}>
                <li>Global tracking code injection: Google Tag Manager, Meta Pixel, custom CSS</li>
                <li>Custom maintenance splash screens with explanatory visitor messages</li>
                <li>Social sharing Open Graph previews and Google SERP snippet previews</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section style={styles.ctaBox}>
        <div style={styles.container}>
          <h2 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 10px', color: '#0f172a' }}>
            Launch High-Converting Client Funnels Today
          </h2>
          <p style={{ fontSize: 15, color: '#475569', maxWidth: 520, margin: '0 auto 20px', lineHeight: 1.6 }}>
            Capture leads, process order bumps, and automate customer follow-ups on a unified system.
          </p>
          <Link
            to="/signup"
            style={styles.btnPrimary}
            onClick={() => trackEvent('signup_start', { source: 'funnels_bottom_cta' })}
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
    background: 'radial-gradient(ellipse at top, #f0fdf4 0%, #ffffff 80%)',
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
