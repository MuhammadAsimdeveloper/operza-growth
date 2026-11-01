import { Link } from 'react-router-dom';
import { SEO } from '../../components/SEO';
import { buildBreadcrumbSchema, SCHEMA_SOFTWARE_APPLICATION } from '../../lib/schema';
import { trackEvent } from '../../lib/analytics';

export default function PlatformPortal() {
  const jsonLd = [
    SCHEMA_SOFTWARE_APPLICATION,
    buildBreadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'Platform', url: '/platform/crm' },
      { name: 'Client Portal', url: '/platform/portal' },
    ]),
  ];

  return (
    <>
      <SEO
        title="White-Label Client Portal & Digital Contract E-Signatures"
        description="Deliver a custom-branded client portal under your agency domain. Features digital contract signing with canvas signature capture, invoice settlement, and course curriculum."
        canonical="/platform/portal"
        keywords={[
          'white-label CRM software',
          'client portal software',
          'white-label marketing platform',
          'client onboarding software',
          'best white-label CRM for agencies',
        ]}
        jsonLd={jsonLd}
      />

      <div style={styles.pageHeader}>
        <div style={styles.container}>
          <div style={styles.breadcrumbs}>
            <Link to="/" style={styles.breadLink}>Home</Link>
            <span>/</span>
            <span style={{ color: '#4f46e5' }}>White-Label Client Portal</span>
          </div>

          <h1 style={styles.h1}>
            White-Label Client Portal &amp; Contract E-Signatures
          </h1>
          <p style={styles.lead}>
            Present a polished, high-trust experience to your agency clients. Let them sign legal proposals
            with smooth canvas signatures, pay invoices securely, and track onboarding milestones under your own custom domain.
          </p>

          <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
            <Link
              to="/signup"
              style={styles.btnPrimary}
              onClick={() => trackEvent('signup_start', { source: 'portal_page' })}
            >
              Start 7-Day Free Trial →
            </Link>
            <Link to="/pricing" style={styles.btnSecondary}>
              See White-Label Pricing
            </Link>
          </div>
        </div>
      </div>

      <section style={styles.section}>
        <div style={styles.container}>
          <div style={styles.grid2}>
            <div>
              <span style={styles.featureBadge}>BRANDING &amp; CNAME</span>
              <h2 style={styles.h2}>100% Your Brand. Zero Vendor Mentions.</h2>
              <p style={styles.paragraph}>
                Elevate your agency’s prestige. Point your custom domain (e.g. portal.youragency.com)
                directly to Operza. Automatic TLS/SSL certificates are provisioned with zero renewal friction.
              </p>
              <ul style={styles.list}>
                <li>Custom logo, favicon, and brand color palette injection</li>
                <li>Unbranded email delivery for invoice notifications and contract signing requests</li>
                <li>Role-based access control ensuring clients only see their own company records</li>
              </ul>
            </div>
            <div style={styles.cardBox}>
              <div style={styles.cardHeader}>
                <strong>Branded Portal Preview</strong>
                <span style={styles.tagGreen}>portal.apexagency.io</span>
              </div>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 18, background: '#ffffff' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: '#0f172a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                    AA
                  </div>
                  <strong>Apex Agency Client Center</strong>
                </div>
                <div style={{ background: '#f8fafc', padding: 10, borderRadius: 6, fontSize: 12, color: '#334155', marginBottom: 8 }}>
                  📄 <strong>Growth Retainer Agreement:</strong> Awaiting your signature
                </div>
                <div style={{ background: '#f8fafc', padding: 10, borderRadius: 6, fontSize: 12, color: '#334155' }}>
                  💳 <strong>Invoice #INV-2026-92:</strong> $2,500.00 USD (Pay Online)
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
                <strong>Cryptographic Signature Audit</strong>
                <span style={styles.tagIndigo}>Legally Binding</span>
              </div>
              <div style={{ background: '#0f172a', color: '#f8fafc', padding: 16, borderRadius: 8, fontSize: 12, lineHeight: 1.6 }}>
                <div>Signer: Sophia Miller (CEO, Apex Logistics)</div>
                <div>Timestamp: 2026-10-31T18:42:10Z</div>
                <div>IP Address: 198.51.100.44</div>
                <div style={{ color: '#34d399', marginTop: 4 }}>✓ Cryptographic SHA-256 Checksum Verified</div>
              </div>
            </div>
            <div>
              <span style={styles.featureBadge}>E-SIGNATURES &amp; INVOICING</span>
              <h2 style={styles.h2}>Legally Binding Digital Agreements &amp; Billing</h2>
              <p style={styles.paragraph}>
                Close retainer deals faster with frictionless in-browser contract signing. Clients draw their
                signature on touch-ready canvas elements and receive instant PDF execution receipts.
              </p>
              <ul style={styles.list}>
                <li>Interactive HTML contract preview with customizable merge tags</li>
                <li>Digital canvas signature capture on mobile, tablet, and desktop</li>
                <li>Integrated payment processing via Stripe with automatic customer status promotion</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section style={styles.ctaBox}>
        <div style={styles.container}>
          <h2 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 10px', color: '#0f172a' }}>
            Elevate Your Client Experience Today
          </h2>
          <p style={{ fontSize: 15, color: '#475569', maxWidth: 520, margin: '0 auto 20px', lineHeight: 1.6 }}>
            Launch a polished, white-label client portal that builds lasting trust with your accounts.
          </p>
          <Link
            to="/signup"
            style={styles.btnPrimary}
            onClick={() => trackEvent('signup_start', { source: 'portal_bottom_cta' })}
          >
            Start Free 7-Day Trial →
          </Link>
        </div>
      </section>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageHeader: {
    padding: '60px 20px 48px',
    background: 'radial-gradient(ellipse at top, #eef2ff 0%, #ffffff 80%)',
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
