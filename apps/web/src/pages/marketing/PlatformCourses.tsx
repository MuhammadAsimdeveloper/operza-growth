import { Link } from 'react-router-dom';
import { SEO } from '../../components/SEO';
import { buildBreadcrumbSchema, SCHEMA_SOFTWARE_APPLICATION } from '../../lib/schema';
import { trackEvent } from '../../lib/analytics';

export default function PlatformCourses() {
  const jsonLd = [
    SCHEMA_SOFTWARE_APPLICATION,
    buildBreadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'Platform', url: '/platform/crm' },
      { name: 'LMS Courses', url: '/platform/courses' },
    ]),
  ];

  return (
    <>
      <SEO
        title="LMS & Course Platform for Agencies and Client Training"
        description="Deliver video masterclasses, client onboarding modules, and training certifications with Operza's native LMS and membership course platform."
        canonical="/platform/courses"
        keywords={[
          'LMS software',
          'online course and client portal platform',
          'client onboarding software',
          'agency training platform',
        ]}
        jsonLd={jsonLd}
      />

      <div style={styles.pageHeader}>
        <div style={styles.container}>
          <div style={styles.breadcrumbs}>
            <Link to="/" style={styles.breadLink}>Home</Link>
            <span>/</span>
            <span style={{ color: '#4f46e5' }}>LMS &amp; Memberships</span>
          </div>

          <h1 style={styles.h1}>
            Integrated LMS, Video Training &amp; Client Education
          </h1>
          <p style={styles.lead}>
            Monetize your proprietary agency frameworks or educate incoming clients with native
            course hosting. Includes multi-lesson progression tracking, video streaming, and automated milestone completion.
          </p>

          <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
            <Link
              to="/signup"
              style={styles.btnPrimary}
              onClick={() => trackEvent('signup_start', { source: 'courses_page' })}
            >
              Start Free Trial →
            </Link>
            <Link to="/pricing" style={styles.btnSecondary}>
              Explore Pricing
            </Link>
          </div>
        </div>
      </div>

      <section style={styles.section}>
        <div style={styles.container}>
          <div style={styles.grid2}>
            <div>
              <span style={styles.featureBadge}>NATIVE CURRICULUM</span>
              <h2 style={styles.h2}>Deliver Seamless Onboarding &amp; Training</h2>
              <p style={styles.paragraph}>
                Stop paying extra for third-party course tools like Teachable or Kajabi.
                Operza embeds video courses and client training curricula directly into your agency workspace and client portal.
              </p>
              <ul style={styles.list}>
                <li>Modular lesson structuring with video embeds, rich text summaries, and downloadable assets</li>
                <li>Real-time client progress percentage tracking and milestone events</li>
                <li>Automatic access provisioning triggered immediately upon funnel checkout or contract signature</li>
              </ul>
            </div>
            <div style={styles.cardBox}>
              <div style={styles.cardHeader}>
                <strong>Client Training Curriculum</strong>
                <span style={styles.tagGreen}>85% Progress</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={styles.lessonItem}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#0f9d6e' }}>✓</span>
                    <strong>Module 1: Agency Kickoff &amp; Asset Handoff</strong>
                  </div>
                  <span style={{ fontSize: 11.5, color: '#64748b' }}>Completed</span>
                </div>
                <div style={styles.lessonItem}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#0f9d6e' }}>✓</span>
                    <strong>Module 2: Funnel Architecture Review</strong>
                  </div>
                  <span style={{ fontSize: 11.5, color: '#64748b' }}>Completed</span>
                </div>
                <div style={{ ...styles.lessonItem, borderLeft: '3px solid #4f46e5' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#4f46e5' }}>▶</span>
                    <strong>Module 3: Inbound Lead Qualification Rules</strong>
                  </div>
                  <span style={{ fontSize: 11.5, color: '#4f46e5', fontWeight: 600 }}>In Progress</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section style={styles.ctaBox}>
        <div style={styles.container}>
          <h2 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 10px', color: '#0f172a' }}>
            Transform Client Onboarding with Operza LMS
          </h2>
          <p style={{ fontSize: 15, color: '#475569', maxWidth: 520, margin: '0 auto 20px', lineHeight: 1.6 }}>
            Consolidate your client education and training courses into your agency operating system.
          </p>
          <Link
            to="/signup"
            style={styles.btnPrimary}
            onClick={() => trackEvent('signup_start', { source: 'courses_bottom_cta' })}
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
    background: 'radial-gradient(ellipse at top, #faf5ff 0%, #ffffff 80%)',
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
  lessonItem: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    padding: '10px 14px',
    borderRadius: 8,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 13,
  },
  ctaBox: {
    padding: '60px 20px',
    textAlign: 'center',
    background: '#f1f5f9',
    borderTop: '1px solid #e2e8f0',
  },
};
