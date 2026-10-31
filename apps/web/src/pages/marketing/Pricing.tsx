import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SEO } from '../../components/SEO';
import { Icon } from '../../components/Icon';
import { buildBreadcrumbSchema, buildFaqSchema, SCHEMA_SOFTWARE_APPLICATION } from '../../lib/schema';
import { trackEvent } from '../../lib/analytics';

const PRICING_FAQS = [
  {
    question: 'Are there any per-seat or per-user fees?',
    answer:
      'No. Operza charges zero per-seat fees on all agency plans. You can add your entire agency team and all staff members without paying extra user penalties.',
  },
  {
    question: 'How do sub-accounts work?',
    answer:
      'The Starter plan includes 3 client sub-accounts. The Growth plan provides 15 client sub-accounts, and the Scale plan delivers unlimited sub-accounts with full snapshot replication.',
  },
  {
    question: 'What is included in the 14-day free trial?',
    answer:
      'The 14-day trial provides full unrestricted access to all platform features: visual workflows, funnel builder, CRM pipelines, omnichannel inbox, and the white-label client portal.',
  },
  {
    question: 'Can I self-host Operza on my own servers?',
    answer:
      'Yes. Operza offers an Open Core self-hosted edition. You can deploy via Docker on your own cloud (AWS, DigitalOcean, Hetzner) with relational PostgreSQL and BullMQ Redis.',
  },
  {
    question: 'Can I cancel or change my plan anytime?',
    answer:
      'Yes. There are no long-term contracts. You can upgrade, downgrade, or cancel your subscription directly from workspace settings at any time.',
  },
];

export default function Pricing() {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const discount = billingCycle === 'annual' ? 0.8 : 1.0;

  const jsonLd = [
    SCHEMA_SOFTWARE_APPLICATION,
    buildBreadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'Pricing', url: '/pricing' },
    ]),
    buildFaqSchema(PRICING_FAQS),
  ];

  return (
    <>
      <SEO
        title="Transparent Pricing Tiers — Starter, Growth & Unlimited Scale"
        description="Predictable, transparent agency pricing with zero per-seat fees. Choose Starter ($97), Growth ($297), or Enterprise Scale ($497) with unlimited team seats and multi-tenant sub-accounts."
        canonical="/pricing"
        keywords={[
          'CRM software pricing',
          'white-label CRM software',
          'agency management software',
          'all-in-one business management software',
          'marketing agency CRM',
        ]}
        jsonLd={jsonLd}
      />

      <div style={styles.pageHeader}>
        <div style={styles.container}>
          <span style={styles.badge}>TRANSPARENT VALUE</span>
          <h1 style={styles.h1}>Simple, Predictable Agency Pricing</h1>
          <p style={styles.lead}>
            Consolidate your entire software stack for less than the cost of one bloated tool.
            Zero per-seat taxes. Unlimited team members on every plan.
          </p>

          {/* Billing Toggle */}
          <div style={styles.toggleRow}>
            <span style={{ fontWeight: billingCycle === 'monthly' ? 700 : 500, fontSize: 13.5 }}>Monthly</span>
            <button
              type="button"
              style={styles.toggleBtn}
              onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'annual' : 'monthly')}
              aria-label="Toggle annual billing discount"
            >
              <div
                style={{
                  ...styles.toggleCircle,
                  transform: billingCycle === 'annual' ? 'translateX(20px)' : 'translateX(0)',
                }}
              />
            </button>
            <span style={{ fontWeight: billingCycle === 'annual' ? 700 : 500, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 6 }}>
              Annual Billing <span style={styles.discountBadge}>Save 20%</span>
            </span>
          </div>
        </div>
      </div>

      {/* Pricing Cards */}
      <section style={styles.section}>
        <div style={styles.container}>
          <div style={styles.pricingGrid}>
            {/* Starter Plan */}
            <div style={styles.planCard}>
              <div style={styles.planHeader}>
                <h2 style={styles.planName}>Starter Agency</h2>
                <p style={styles.planDesc}>Ideal for boutique agencies and solo growth consultancies.</p>
                <div style={styles.priceRow}>
                  <span style={styles.priceNum}>${Math.round(97 * discount)}</span>
                  <span style={styles.pricePeriod}>/month</span>
                </div>
                {billingCycle === 'annual' && <div style={styles.billedAnnual}>Billed annually ($931/yr)</div>}
              </div>
              <ul style={styles.featureList}>
                <li>✓ Up to <strong>3 Client Sub-Accounts</strong></li>
                <li>✓ <strong>Unlimited Team Members</strong> (0 per-seat fees)</li>
                <li>✓ 2D Visual Workflow Automation Engine</li>
                <li>✓ High-Converting Funnel &amp; Landing Page Builder</li>
                <li>✓ Unified CRM Pipelines &amp; Smart Lists</li>
                <li>✓ Twilio SMS &amp; Email Marketing Integrations</li>
                <li>✓ Standard Community Support</li>
              </ul>
              <Link
                to="/signup?plan=starter"
                style={styles.planBtnSecondary}
                onClick={() => trackEvent('pricing_select', { plan: 'starter', cycle: billingCycle })}
              >
                Start 14-Day Free Trial
              </Link>
            </div>

            {/* Growth Plan (Popular) */}
            <div style={{ ...styles.planCard, ...styles.planCardFeatured }}>
              <div style={styles.featuredRibbon}>MOST POPULAR</div>
              <div style={styles.planHeader}>
                <h2 style={styles.planName}>Agency Growth</h2>
                <p style={styles.planDesc}>Engineered for growing digital marketing and consulting agencies.</p>
                <div style={styles.priceRow}>
                  <span style={styles.priceNum}>${Math.round(297 * discount)}</span>
                  <span style={styles.pricePeriod}>/month</span>
                </div>
                {billingCycle === 'annual' && <div style={styles.billedAnnual}>Billed annually ($2,851/yr)</div>}
              </div>
              <ul style={styles.featureList}>
                <li>✓ Up to <strong>15 Client Sub-Accounts</strong></li>
                <li>✓ <strong>Unlimited Team Members</strong></li>
                <li>✓ Full <strong>White-Label Client Portal</strong> (Custom CNAME)</li>
                <li>✓ Digital Contract E-Signatures with Audit Trail</li>
                <li>✓ WhatsApp Cloud API &amp; Meta Messenger Ingress</li>
                <li>✓ Virtual Telephony &amp; Call Recording</li>
                <li>✓ Account Snapshot Replication &amp; Blueprints</li>
                <li>✓ Priority Live Chat &amp; Email Support</li>
              </ul>
              <Link
                to="/signup?plan=growth"
                style={styles.planBtnPrimary}
                onClick={() => trackEvent('pricing_select', { plan: 'growth', cycle: billingCycle })}
              >
                Start 14-Day Free Trial →
              </Link>
            </div>

            {/* Scale Plan */}
            <div style={styles.planCard}>
              <div style={styles.planHeader}>
                <h2 style={styles.planName}>Enterprise Scale</h2>
                <p style={styles.planDesc}>For multi-brand agencies and white-label software resellers.</p>
                <div style={styles.priceRow}>
                  <span style={styles.priceNum}>${Math.round(497 * discount)}</span>
                  <span style={styles.pricePeriod}>/month</span>
                </div>
                {billingCycle === 'annual' && <div style={styles.billedAnnual}>Billed annually ($4,771/yr)</div>}
              </div>
              <ul style={styles.featureList}>
                <li>✓ <strong>Unlimited Client Sub-Accounts</strong></li>
                <li>✓ <strong>Unlimited Team Members</strong></li>
                <li>✓ Advanced Multi-Tenant PostgreSQL RLS Clusters</li>
                <li>✓ Bi-Directional Snapshot Diff &amp; Selective Sync</li>
                <li>✓ High-Throughput BullMQ Worker Concurrency</li>
                <li>✓ Custom Payment Gateways &amp; Merchant Routing</li>
                <li>✓ Dedicated Slack Connect Channel &amp; Architecture Onboarding</li>
              </ul>
              <Link
                to="/signup?plan=scale"
                style={styles.planBtnSecondary}
                onClick={() => trackEvent('pricing_select', { plan: 'scale', cycle: billingCycle })}
              >
                Start 14-Day Free Trial
              </Link>
            </div>
          </div>

          {/* Self-Hosted Callout */}
          <div style={styles.selfHostBox}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: '#0f172a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="database" size={20} />
              </div>
              <div>
                <strong style={{ fontSize: 16, color: '#0f172a' }}>Looking for Self-Hosted Data Sovereignty?</strong>
                <p style={{ margin: '3px 0 0', fontSize: 13.5, color: '#475569' }}>
                  Deploy Operza Open Core on your own cloud infrastructure via Docker and relational PostgreSQL with zero lock-in.
                </p>
              </div>
            </div>
            <Link to="/docs" style={styles.btnSecondary}>
              Explore Self-Hosted Docs →
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section style={styles.sectionAlt}>
        <div style={styles.container}>
          <div style={{ textAlign: 'center', maxWidth: 640, margin: '0 auto 36px' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#4f46e5', letterSpacing: '0.08em' }}>QUESTIONS</span>
            <h2 style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', margin: '8px 0 10px' }}>
              Pricing Frequently Asked Questions
            </h2>
            <p style={{ fontSize: 14.5, color: '#64748b', margin: 0 }}>
              Transparent terms, zero hidden maintenance fees, and straightforward cancellation.
            </p>
          </div>

          <div style={styles.faqList}>
            {PRICING_FAQS.map((faq, index) => {
              const isOpen = openFaq === index;
              return (
                <div key={faq.question} style={styles.faqCard}>
                  <button
                    type="button"
                    style={styles.faqBtn}
                    onClick={() => setOpenFaq(isOpen ? null : index)}
                    aria-expanded={isOpen}
                  >
                    <span>{faq.question}</span>
                    <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={15} />
                  </button>
                  {isOpen && (
                    <div style={styles.faqBody}>
                      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: '#475569' }}>
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
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageHeader: {
    padding: '60px 20px 40px',
    textAlign: 'center',
    background: 'radial-gradient(ellipse at top, #eef2ff 0%, #ffffff 80%)',
    borderBottom: '1px solid #e2e8f0',
  },
  container: {
    maxWidth: 1160,
    margin: '0 auto',
  },
  badge: {
    fontSize: 11,
    fontWeight: 700,
    color: '#4f46e5',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  h1: {
    fontSize: 42,
    fontWeight: 800,
    letterSpacing: '-0.03em',
    color: '#0f172a',
    margin: '10px 0 14px',
  },
  lead: {
    fontSize: 16.5,
    color: '#475569',
    maxWidth: 620,
    margin: '0 auto 24px',
    lineHeight: 1.6,
  },
  toggleRow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 12,
    padding: '6px 14px',
    background: '#ffffff',
    borderRadius: 99,
    border: '1px solid #cbd5e1',
    boxShadow: '0 2px 6px rgba(15, 23, 42, 0.04)',
  },
  toggleBtn: {
    width: 44,
    height: 24,
    borderRadius: 12,
    background: '#4f46e5',
    border: 'none',
    cursor: 'pointer',
    position: 'relative',
    padding: 2,
    display: 'flex',
    alignItems: 'center',
  },
  toggleCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    background: '#ffffff',
    transition: 'transform 0.2s ease',
  },
  discountBadge: {
    background: '#e6f7f1',
    color: '#0f9d6e',
    padding: '2px 8px',
    borderRadius: 99,
    fontSize: 11,
    fontWeight: 700,
  },
  section: {
    padding: '60px 20px',
  },
  sectionAlt: {
    padding: '60px 20px',
    background: '#f8fafc',
    borderTop: '1px solid #e2e8f0',
  },
  pricingGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 28,
    alignItems: 'stretch',
    marginBottom: 40,
  },
  planCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    padding: 30,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 4px 14px rgba(15, 23, 42, 0.04)',
    position: 'relative',
  },
  planCardFeatured: {
    borderColor: '#6366f1',
    boxShadow: '0 8px 30px rgba(99, 102, 241, 0.16)',
  },
  featuredRibbon: {
    position: 'absolute',
    top: -12,
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#4f46e5',
    color: '#ffffff',
    padding: '3px 12px',
    borderRadius: 99,
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: '0.06em',
  },
  planHeader: {
    borderBottom: '1px solid #f1f5f9',
    paddingBottom: 20,
    marginBottom: 20,
  },
  planName: {
    fontSize: 20,
    fontWeight: 750,
    color: '#0f172a',
    margin: '0 0 6px',
  },
  planDesc: {
    fontSize: 13,
    color: '#64748b',
    minHeight: 36,
    margin: '0 0 14px',
    lineHeight: 1.5,
  },
  priceRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 4,
  },
  priceNum: {
    fontSize: 38,
    fontWeight: 800,
    color: '#0f172a',
  },
  pricePeriod: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: 500,
  },
  billedAnnual: {
    fontSize: 11.5,
    color: '#0f9d6e',
    fontWeight: 600,
    marginTop: 4,
  },
  featureList: {
    listStyle: 'none',
    padding: 0,
    margin: '0 0 28px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    fontSize: 13.5,
    color: '#334155',
    flex: 1,
  },
  planBtnPrimary: {
    display: 'block',
    textAlign: 'center',
    padding: '12px',
    background: '#4f46e5',
    color: '#ffffff',
    fontWeight: 650,
    fontSize: 14,
    borderRadius: 8,
    textDecoration: 'none',
    boxShadow: '0 2px 8px rgba(79, 70, 229, 0.3)',
  },
  planBtnSecondary: {
    display: 'block',
    textAlign: 'center',
    padding: '12px',
    background: '#ffffff',
    color: '#334155',
    border: '1px solid #cbd5e1',
    fontWeight: 600,
    fontSize: 14,
    borderRadius: 8,
    textDecoration: 'none',
  },
  selfHostBox: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '20px 24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 16,
  },
  btnSecondary: {
    display: 'inline-block',
    padding: '10px 18px',
    background: '#ffffff',
    border: '1px solid #cbd5e1',
    color: '#334155',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13.5,
    textDecoration: 'none',
  },
  faqList: {
    maxWidth: 720,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  faqCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    overflow: 'hidden',
  },
  faqBtn: {
    width: '100%',
    textAlign: 'left',
    padding: '14px 18px',
    background: 'transparent',
    border: 'none',
    fontSize: 14.5,
    fontWeight: 650,
    color: '#0f172a',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  faqBody: {
    padding: '0 18px 16px',
    borderTop: '1px solid #f8fafc',
    paddingTop: 8,
  },
};
