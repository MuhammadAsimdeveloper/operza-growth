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
      'Zero per-seat fees on all plans. Unlike legacy CRMs that charge $50–$150 for every staff member or account manager you invite, Operza gives you unlimited team seats from day one.',
  },
  {
    question: 'How do sub-accounts work?',
    answer:
      'The Starter plan includes 3 client sub-accounts. The Growth plan provides 15 client sub-accounts, and the Scale plan delivers unlimited sub-accounts with full snapshot blueprint replication and multi-tenant database isolation.',
  },
  {
    question: 'How does Operza compare in price to legacy agency platforms?',
    answer:
      'Operza is engineered to be disruptive: Starter is just $35/month (compared to $97/mo elsewhere), Growth is $79/month (compared to $297/mo elsewhere), and Enterprise Scale is $149/month (compared to $497+/mo elsewhere). You get superior 2D visual automation graphs, native database RLS, and zero webhook fragility at a fraction of the cost.',
  },
  {
    question: 'What is included in the 14-day free trial?',
    answer:
      'The 14-day trial provides full unrestricted access to all platform features: visual workflows, funnel builder, multi-page website CMS, CRM pipelines, omnichannel inbox, and the white-label client portal.',
  },
  {
    question: 'Can I self-host Operza on my own servers?',
    answer:
      'Yes. Operza offers an Open Core self-hosted edition. You can deploy via Docker on your own cloud (AWS, DigitalOcean, Hetzner, Railway) with relational PostgreSQL and BullMQ Redis for 100% data sovereignty.',
  },
  {
    question: 'Can I cancel or change my plan anytime?',
    answer:
      'Yes. There are no contracts or termination penalties. You can upgrade, downgrade, or cancel your subscription directly from workspace settings at any time with 1 click.',
  },
];

export default function Pricing() {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Interactive ROI Calculator State
  const [calcSeats, setCalcSeats] = useState<number>(5);
  const [calcClients, setCalcClients] = useState<number>(10);

  const discount = billingCycle === 'annual' ? 0.8 : 1.0;

  // Fragmented stack cost calculation:
  // CRM ($50/user) + Funnels ($147) + Zapier ($99) + Inbox/Email ($120) + Contracts ($40) + Sub-accounts ($25/client)
  const legacyStackCost = Math.round(
    calcSeats * 50 + 147 + 99 + 120 + 40 + calcClients * 25
  );

  // Recommended Operza plan based on client count
  const recommendedPlan = calcClients <= 3 ? 'Starter' : calcClients <= 15 ? 'Growth' : 'Scale';
  const operzaCost =
    recommendedPlan === 'Starter'
      ? Math.round(35 * discount)
      : recommendedPlan === 'Growth'
      ? Math.round(79 * discount)
      : Math.round(149 * discount);

  const monthlySavings = Math.max(0, legacyStackCost - operzaCost);
  const annualSavings = monthlySavings * 12;

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
        title="Disruptive Agency Pricing — $35 Starter, $79 Growth & $149 Scale"
        description="Predictable, high-value agency pricing with zero per-seat fees. Choose Starter ($35/mo), Growth ($79/mo), or Enterprise Scale ($149/mo) with unlimited team seats and multi-tenant sub-accounts."
        canonical="/pricing"
        keywords={[
          'CRM software pricing',
          'white-label CRM software',
          'agency management software',
          'all-in-one business management software',
          'marketing agency CRM',
          'affordable agency crm alternative',
        ]}
        jsonLd={jsonLd}
      />

      <div style={styles.pageHeader}>
        <div style={styles.container}>
          <div style={styles.badgeRow}>
            <span style={styles.badge}>DISRUPTIVE VALUE · UNLIMITED SEATS</span>
          </div>
          <h1 style={styles.h1}>Predictable, Fair Agency Pricing</h1>
          <p style={styles.lead}>
            Consolidate your entire software stack for less than the cost of one bloated tool.
            Zero per-seat taxes. Unlimited team members on every plan.
          </p>

          {/* Billing Toggle */}
          <div style={styles.toggleRow}>
            <span style={{ fontWeight: billingCycle === 'monthly' ? 700 : 500, fontSize: 13.5, color: billingCycle === 'monthly' ? '#0f172a' : '#64748b' }}>
              Monthly
            </span>
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
            <span style={{ fontWeight: billingCycle === 'annual' ? 700 : 500, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 6, color: billingCycle === 'annual' ? '#0f172a' : '#64748b' }}>
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
            <div style={styles.planCard} className="card-premium">
              <div style={styles.planHeader}>
                <div style={styles.tierPill}>STARTER</div>
                <h2 style={styles.planName}>Starter Agency</h2>
                <p style={styles.planDesc}>Ideal for boutique agencies, solo consultants, and early-stage founders.</p>
                <div style={styles.priceRow}>
                  <span style={styles.priceNum}>${Math.round(35 * discount)}</span>
                  <span style={styles.pricePeriod}>/month</span>
                </div>
                {billingCycle === 'annual' ? (
                  <div style={styles.billedAnnual}>Billed annually ($336/yr · save $84)</div>
                ) : (
                  <div style={styles.billedMonthly}>Billed monthly ($35/mo)</div>
                )}
              </div>
              <ul style={styles.featureList}>
                <li><span style={styles.checkIcon}>✓</span> Up to <strong>3 Client Sub-Accounts</strong></li>
                <li><span style={styles.checkIcon}>✓</span> <strong>Unlimited Team Members</strong> (0 per-seat tax)</li>
                <li><span style={styles.checkIcon}>✓</span> 2D Visual Node-and-Wire Automation Engine</li>
                <li><span style={styles.checkIcon}>✓</span> High-Converting Funnel &amp; Website Builder</li>
                <li><span style={styles.checkIcon}>✓</span> Multi-Page Website Templates &amp; CMS</li>
                <li><span style={styles.checkIcon}>✓</span> Unified CRM Pipelines &amp; Smart Lists</li>
                <li><span style={styles.checkIcon}>✓</span> Twilio SMS &amp; Email Marketing Integrations</li>
                <li><span style={styles.checkIcon}>✓</span> Native PostgreSQL Database Isolation</li>
                <li><span style={styles.checkIcon}>✓</span> Standard Community &amp; Help Desk Support</li>
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
            <div style={{ ...styles.planCard, ...styles.planCardFeatured }} className="card-premium">
              <div style={styles.featuredRibbon}>⚡ MOST POPULAR · BEST VALUE</div>
              <div style={styles.planHeader}>
                <div style={{ ...styles.tierPill, background: 'rgba(99, 102, 241, 0.15)', color: '#4f46e5' }}>GROWTH</div>
                <h2 style={styles.planName}>Agency Growth</h2>
                <p style={styles.planDesc}>Engineered for growing digital marketing, SEO, and consulting agencies.</p>
                <div style={styles.priceRow}>
                  <span style={styles.priceNum}>${Math.round(79 * discount)}</span>
                  <span style={styles.pricePeriod}>/month</span>
                </div>
                {billingCycle === 'annual' ? (
                  <div style={styles.billedAnnual}>Billed annually ($758/yr · save $190)</div>
                ) : (
                  <div style={styles.billedMonthly}>Billed monthly ($79/mo)</div>
                )}
              </div>
              <ul style={styles.featureList}>
                <li><span style={styles.checkIcon}>✓</span> Up to <strong>15 Client Sub-Accounts</strong></li>
                <li><span style={styles.checkIcon}>✓</span> <strong>Unlimited Team Members</strong> (No limits)</li>
                <li><span style={styles.checkIcon}>✓</span> Full <strong>White-Label Client Portal</strong> (Custom CNAME)</li>
                <li><span style={styles.checkIcon}>✓</span> Digital Contract E-Signatures with Audit Trail</li>
                <li><span style={styles.checkIcon}>✓</span> WhatsApp Cloud API &amp; Meta Messenger Ingress</li>
                <li><span style={styles.checkIcon}>✓</span> Virtual Telephony, IVR &amp; Call Recording</li>
                <li><span style={styles.checkIcon}>✓</span> Account Snapshot Blueprints &amp; Selective Sync</li>
                <li><span style={styles.checkIcon}>✓</span> Custom Domain SSL &amp; Edge CDN Publishing</li>
                <li><span style={styles.checkIcon}>✓</span> Priority Live Chat &amp; Architecture Support</li>
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
            <div style={styles.planCard} className="card-premium">
              <div style={styles.planHeader}>
                <div style={styles.tierPill}>SCALE</div>
                <h2 style={styles.planName}>Enterprise Scale</h2>
                <p style={styles.planDesc}>For multi-location brands, enterprise teams, and software resellers.</p>
                <div style={styles.priceRow}>
                  <span style={styles.priceNum}>${Math.round(149 * discount)}</span>
                  <span style={styles.pricePeriod}>/month</span>
                </div>
                {billingCycle === 'annual' ? (
                  <div style={styles.billedAnnual}>Billed annually ($1,430/yr · save $358)</div>
                ) : (
                  <div style={styles.billedMonthly}>Billed monthly ($149/mo)</div>
                )}
              </div>
              <ul style={styles.featureList}>
                <li><span style={styles.checkIcon}>✓</span> <strong>Unlimited Client Sub-Accounts</strong></li>
                <li><span style={styles.checkIcon}>✓</span> <strong>Unlimited Team Members</strong></li>
                <li><span style={styles.checkIcon}>✓</span> Multi-Tenant PostgreSQL RLS Clusters</li>
                <li><span style={styles.checkIcon}>✓</span> Bi-Directional Snapshot Diff &amp; Batch Sync</li>
                <li><span style={styles.checkIcon}>✓</span> High-Throughput BullMQ Worker Concurrency</li>
                <li><span style={styles.checkIcon}>✓</span> Custom Payment Gateways &amp; Merchant Routing</li>
                <li><span style={styles.checkIcon}>✓</span> Full REST API &amp; Webhook Gateway Access</li>
                <li><span style={styles.checkIcon}>✓</span> 99.99% Uptime SLA &amp; HIPAA BAA Compliance</li>
                <li><span style={styles.checkIcon}>✓</span> Dedicated Slack Connect Channel Onboarding</li>
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

          {/* ─── Interactive ROI Cost Savings Calculator ─── */}
          <div style={styles.calculatorCard}>
            <div style={styles.calcHeader}>
              <div style={styles.calcBadge}>LIVE SAVINGS CALCULATOR</div>
              <h2 style={styles.calcTitle}>Calculate Your Real Stack Savings</h2>
              <p style={styles.calcSubtitle}>
                See how much your agency saves every month by replacing fragmented subscriptions with Operza.
              </p>
            </div>

            <div style={styles.calcGrid}>
              {/* Sliders Box */}
              <div style={styles.calcControls}>
                <div style={styles.sliderGroup}>
                  <div style={styles.sliderLabelRow}>
                    <label htmlFor="team-seats-slider" style={styles.sliderLabel}>
                      <strong>Team Seats / Staff:</strong>
                    </label>
                    <span style={styles.sliderValue}>{calcSeats} members</span>
                  </div>
                  <input
                    id="team-seats-slider"
                    type="range"
                    min={1}
                    max={30}
                    value={calcSeats}
                    onChange={(e) => setCalcSeats(Number(e.target.value))}
                    style={styles.rangeInput}
                  />
                  <div style={styles.sliderHint}>Legacy CRMs charge $50–$150/user. Operza charges $0.</div>
                </div>

                <div style={styles.sliderGroup}>
                  <div style={styles.sliderLabelRow}>
                    <label htmlFor="client-accounts-slider" style={styles.sliderLabel}>
                      <strong>Client Sub-Accounts:</strong>
                    </label>
                    <span style={styles.sliderValue}>{calcClients} clients</span>
                  </div>
                  <input
                    id="client-accounts-slider"
                    type="range"
                    min={1}
                    max={50}
                    value={calcClients}
                    onChange={(e) => setCalcClients(Number(e.target.value))}
                    style={styles.rangeInput}
                  />
                  <div style={styles.sliderHint}>
                    Recommended Operza Plan: <strong>{recommendedPlan} (${operzaCost}/mo)</strong>
                  </div>
                </div>

                <div style={styles.stackBreakdown}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>
                    Replaced Subscriptions Included in Operza:
                  </div>
                  <div style={styles.tagGrid}>
                    <span style={styles.subTag}>✓ CRM (${calcSeats * 50}/mo)</span>
                    <span style={styles.subTag}>✓ Zapier/iPaaS ($99/mo)</span>
                    <span style={styles.subTag}>✓ Funnels &amp; Sites ($147/mo)</span>
                    <span style={styles.subTag}>✓ Email &amp; SMS ($120/mo)</span>
                    <span style={styles.subTag}>✓ E-Signatures ($40/mo)</span>
                    <span style={styles.subTag}>✓ Sub-Accounts (${calcClients * 25}/mo)</span>
                  </div>
                </div>
              </div>

              {/* Savings Results Display */}
              <div style={styles.calcResults}>
                <div style={styles.resultsBox}>
                  <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 4 }}>Current Fragmented Stack Cost:</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: '#f87171', textDecoration: 'line-through' }}>
                    ${legacyStackCost.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 400 }}>/ month</span>
                  </div>

                  <div style={{ margin: '16px 0 10px', height: 1, background: 'rgba(255,255,255,0.1)' }} />

                  <div style={{ fontSize: 13, color: '#a5b4fc', marginBottom: 4 }}>Operza Unified Business OS:</div>
                  <div style={{ fontSize: 36, fontWeight: 800, color: '#38bdf8' }}>
                    ${operzaCost.toLocaleString()} <span style={{ fontSize: 15, fontWeight: 400, color: '#94a3b8' }}>/ month</span>
                  </div>

                  <div style={styles.savingsCallout}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#10b981' }}>
                      YOUR ESTIMATED ANNUAL SAVINGS:
                    </div>
                    <div style={{ fontSize: 32, fontWeight: 900, color: '#10b981', margin: '4px 0' }}>
                      ${annualSavings.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                      That's ${(monthlySavings).toLocaleString()} extra gross profit back into your agency every month!
                    </div>
                  </div>

                  <Link to="/signup" style={styles.calcCtaBtn}>
                    Claim Your Savings — Start 14-Day Free Trial →
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Self-Hosted Callout */}
          <div style={styles.selfHostBox}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: '#0f172a', color: '#38bdf8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="database" size={22} />
              </div>
              <div>
                <strong style={{ fontSize: 16, color: '#0f172a' }}>Looking for Self-Hosted Data Sovereignty?</strong>
                <p style={{ margin: '3px 0 0', fontSize: 13.5, color: '#475569' }}>
                  Deploy Operza Open Core on your own cloud infrastructure via Docker and relational PostgreSQL for 100% data ownership.
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
            <h2 style={{ fontSize: 30, fontWeight: 800, color: '#0f172a', margin: '8px 0 10px' }}>
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
                      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: '#475569' }}>
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
    padding: '64px 20px 48px',
    textAlign: 'center',
    background: 'radial-gradient(ellipse at top, #eef2ff 0%, #ffffff 80%)',
    borderBottom: '1px solid #e2e8f0',
  },
  container: {
    maxWidth: 1180,
    margin: '0 auto',
  },
  badgeRow: {
    display: 'flex',
    justifyContent: 'center',
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
    margin: '10px 0 14px',
    lineHeight: 1.15,
  },
  lead: {
    fontSize: 17,
    color: '#475569',
    maxWidth: 640,
    margin: '0 auto 28px',
    lineHeight: 1.6,
  },
  toggleRow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 12,
    padding: '6px 16px',
    background: '#ffffff',
    borderRadius: 99,
    border: '1px solid #cbd5e1',
    boxShadow: '0 2px 8px rgba(15, 23, 42, 0.05)',
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
    transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  },
  discountBadge: {
    background: '#dcfce7',
    color: '#15803d',
    padding: '2px 8px',
    borderRadius: 99,
    fontSize: 11,
    fontWeight: 700,
  },
  section: {
    padding: '64px 20px',
  },
  sectionAlt: {
    padding: '64px 20px',
    background: '#f8fafc',
    borderTop: '1px solid #e2e8f0',
  },
  pricingGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 28,
    alignItems: 'stretch',
    marginBottom: 50,
  },
  planCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 16,
    padding: '32px 28px',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04)',
    position: 'relative',
    transition: 'transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease',
  },
  planCardFeatured: {
    borderColor: '#6366f1',
    background: 'linear-gradient(180deg, #faf5ff 0%, #ffffff 100%)',
    boxShadow: '0 12px 36px rgba(99, 102, 241, 0.18)',
    transform: 'translateY(-4px)',
  },
  featuredRibbon: {
    position: 'absolute',
    top: -13,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
    color: '#ffffff',
    padding: '4px 14px',
    borderRadius: 99,
    fontSize: 10.5,
    fontWeight: 800,
    letterSpacing: '0.06em',
    boxShadow: '0 2px 8px rgba(79, 70, 229, 0.4)',
    whiteSpace: 'nowrap',
  },
  planHeader: {
    borderBottom: '1px solid #f1f5f9',
    paddingBottom: 22,
    marginBottom: 22,
  },
  tierPill: {
    display: 'inline-block',
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.08em',
    color: '#64748b',
    background: '#f1f5f9',
    padding: '3px 8px',
    borderRadius: 6,
    marginBottom: 8,
  },
  planName: {
    fontSize: 22,
    fontWeight: 800,
    color: '#0f172a',
    margin: '0 0 6px',
  },
  planDesc: {
    fontSize: 13,
    color: '#64748b',
    minHeight: 38,
    margin: '0 0 16px',
    lineHeight: 1.5,
  },
  priceRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 4,
  },
  priceNum: {
    fontSize: 42,
    fontWeight: 850,
    color: '#0f172a',
    letterSpacing: '-0.02em',
  },
  pricePeriod: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: 500,
  },
  billedAnnual: {
    fontSize: 11.5,
    color: '#15803d',
    fontWeight: 650,
    marginTop: 6,
  },
  billedMonthly: {
    fontSize: 11.5,
    color: '#64748b',
    fontWeight: 500,
    marginTop: 6,
  },
  featureList: {
    listStyle: 'none',
    padding: 0,
    margin: '0 0 28px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    fontSize: 13.5,
    color: '#334155',
    flex: 1,
  },
  checkIcon: {
    color: '#10b981',
    fontWeight: 800,
    marginRight: 6,
    display: 'inline-block',
  },
  planBtnPrimary: {
    display: 'block',
    textAlign: 'center',
    padding: '13px',
    background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
    color: '#ffffff',
    fontWeight: 700,
    fontSize: 14.5,
    borderRadius: 10,
    textDecoration: 'none',
    boxShadow: '0 4px 14px rgba(79, 70, 229, 0.35)',
  },
  planBtnSecondary: {
    display: 'block',
    textAlign: 'center',
    padding: '13px',
    background: '#ffffff',
    color: '#1e293b',
    border: '1px solid #cbd5e1',
    fontWeight: 650,
    fontSize: 14.5,
    borderRadius: 10,
    textDecoration: 'none',
  },
  calculatorCard: {
    background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
    borderRadius: 20,
    padding: '40px 36px',
    color: '#ffffff',
    marginBottom: 44,
    boxShadow: '0 20px 50px rgba(15, 23, 42, 0.25)',
  },
  calcHeader: {
    textAlign: 'center',
    maxWidth: 640,
    margin: '0 auto 36px',
  },
  calcBadge: {
    display: 'inline-block',
    fontSize: 10.5,
    fontWeight: 800,
    letterSpacing: '0.1em',
    color: '#38bdf8',
    background: 'rgba(56, 189, 248, 0.15)',
    padding: '4px 12px',
    borderRadius: 99,
    marginBottom: 10,
  },
  calcTitle: {
    fontSize: 32,
    fontWeight: 850,
    color: '#ffffff',
    letterSpacing: '-0.02em',
    margin: '0 0 10px',
  },
  calcSubtitle: {
    fontSize: 15,
    color: '#94a3b8',
    lineHeight: 1.5,
    margin: 0,
  },
  calcGrid: {
    display: 'grid',
    gridTemplateColumns: '1.2fr 1fr',
    gap: 36,
    alignItems: 'center',
  },
  calcControls: {
    display: 'flex',
    flexDirection: 'column',
    gap: 22,
  },
  sliderGroup: {
    background: 'rgba(255, 255, 255, 0.05)',
    padding: '18px 20px',
    borderRadius: 12,
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
  sliderLabelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    fontSize: 14,
  },
  sliderLabel: {
    color: '#f8fafc',
  },
  sliderValue: {
    fontSize: 14,
    fontWeight: 750,
    color: '#38bdf8',
    background: 'rgba(56, 189, 248, 0.15)',
    padding: '2px 8px',
    borderRadius: 6,
  },
  rangeInput: {
    width: '100%',
    cursor: 'pointer',
    accentColor: '#6366f1',
    margin: '4px 0 6px',
  },
  sliderHint: {
    fontSize: 11.5,
    color: '#94a3b8',
  },
  stackBreakdown: {
    marginTop: 4,
  },
  tagGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  subTag: {
    fontSize: 11,
    background: 'rgba(255, 255, 255, 0.08)',
    padding: '4px 8px',
    borderRadius: 6,
    color: '#cbd5e1',
  },
  calcResults: {
    height: '100%',
  },
  resultsBox: {
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 16,
    padding: '28px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  savingsCallout: {
    background: 'rgba(16, 185, 129, 0.12)',
    border: '1px solid rgba(16, 185, 129, 0.3)',
    borderRadius: 12,
    padding: '18px',
    margin: '20px 0',
    textAlign: 'center',
  },
  calcCtaBtn: {
    display: 'block',
    textAlign: 'center',
    padding: '14px',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: '#ffffff',
    fontWeight: 750,
    fontSize: 14.5,
    borderRadius: 10,
    textDecoration: 'none',
    boxShadow: '0 4px 16px rgba(16, 185, 129, 0.35)',
  },
  selfHostBox: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    padding: '22px 26px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 16,
    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.03)',
  },
  btnSecondary: {
    display: 'inline-block',
    padding: '10px 20px',
    background: '#ffffff',
    border: '1px solid #cbd5e1',
    color: '#334155',
    borderRadius: 8,
    fontWeight: 650,
    fontSize: 13.5,
    textDecoration: 'none',
  },
  faqList: {
    maxWidth: 760,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  faqCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  faqBtn: {
    width: '100%',
    textAlign: 'left',
    padding: '16px 20px',
    background: 'transparent',
    border: 'none',
    fontSize: 15,
    fontWeight: 700,
    color: '#0f172a',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  faqBody: {
    padding: '0 20px 18px',
    borderTop: '1px solid #f8fafc',
    paddingTop: 10,
  },
};
