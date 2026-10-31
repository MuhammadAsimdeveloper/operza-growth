import { Link } from 'react-router-dom';
import { SEO } from '../../components/SEO';
import { buildBreadcrumbSchema, SCHEMA_SOFTWARE_APPLICATION } from '../../lib/schema';
import { trackEvent } from '../../lib/analytics';

export default function PlatformAutomation() {
  const jsonLd = [
    SCHEMA_SOFTWARE_APPLICATION,
    buildBreadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'Platform', url: '/platform/crm' },
      { name: 'Workflow Automation', url: '/platform/automation' },
    ]),
  ];

  return (
    <>
      <SEO
        title="Visual Workflow Automation Engine & 2D Graph Canvas"
        description="Automate complex business and client workflows with Operza's visual node-and-wire canvas. Event triggers, conditional YES/NO branching, human approvals, and BullMQ queue durability."
        canonical="/platform/automation"
        keywords={[
          'workflow automation software',
          'marketing automation platform',
          'business process automation software',
          'workflow automation builder',
          'marketing funnel automation',
        ]}
        jsonLd={jsonLd}
      />

      <div style={styles.pageHeader}>
        <div style={styles.container}>
          <div style={styles.breadcrumbs}>
            <Link to="/" style={styles.breadLink}>Home</Link>
            <span>/</span>
            <span style={{ color: '#4f46e5' }}>Visual Workflow Automation</span>
          </div>

          <h1 style={styles.h1}>
            Visual Workflow Automation Engine &amp; Graph Canvas
          </h1>
          <p style={styles.lead}>
            Design mission-critical automations on an interactive 2D node-and-wire canvas.
            Connect inbound triggers, evaluate conditional rules, dispatch webhooks, and ensure
            zero lost tasks with durable Redis BullMQ queuing.
          </p>

          <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
            <Link
              to="/signup"
              style={styles.btnPrimary}
              onClick={() => trackEvent('signup_start', { source: 'automation_page' })}
            >
              Start Automating Workflows →
            </Link>
            <Link to="/docs" style={styles.btnSecondary}>
              Workflow Engine Docs
            </Link>
          </div>
        </div>
      </div>

      <section style={styles.section}>
        <div style={styles.container}>
          <div style={styles.grid2}>
            <div>
              <span style={styles.featureBadge}>INTERACTIVE CANVAS</span>
              <h2 style={styles.h2}>Node-and-Wire Visual Graph Editor</h2>
              <p style={styles.paragraph}>
                Stop struggling with rigid, linear workflow builders. Operza provides a full 2D infinite canvas
                with smooth pan, zoom, and cubic Bezier wiring for complex branching logic.
              </p>
              <ul style={styles.list}>
                <li>Event Triggers: Web forms, calendar bookings, inbound SMS/WhatsApp, Stripe payments</li>
                <li>Action Nodes: Send emails, assign tasks, update CRM pipeline stages, fire external webhooks</li>
                <li>Conditional Evaluators: Branch execution based on deal size, tags, or contact attributes</li>
              </ul>
            </div>
            <div style={styles.cardBox}>
              <div style={styles.cardHeader}>
                <strong>Visual Flow Architecture</strong>
                <span style={styles.tagIndigo}>2D Canvas Active</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
                <div style={styles.node}>🎯 Trigger: Inbound Lead Form Completed</div>
                <div style={{ color: '#94a3b8' }}>↓</div>
                <div style={styles.node}>⚡ Action: Apply Tag "High-Intent" &amp; Create Deal</div>
                <div style={{ color: '#94a3b8' }}>↓</div>
                <div style={styles.conditionNode}>❓ Rule: Lead Score &gt; 80?</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' }}>
                  <div style={styles.branchBox}>YES: Dispatch SMS to Lead Rep</div>
                  <div style={styles.branchBox}>NO: Enroll in Nurture Email Drip</div>
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
                <strong>Enterprise Queue Telemetry</strong>
                <span style={styles.tagGreen}>BullMQ Resilient</span>
              </div>
              <div style={{ background: '#0f172a', padding: 16, borderRadius: 8, color: '#f8fafc', fontSize: 12.5, lineHeight: 1.6 }}>
                <div>✓ Exponential Backoff with Jitter: Active</div>
                <div>✓ Dead-Letter Queue (DLQ): 0 stranded jobs</div>
                <div>✓ Idempotency Key Deduplication: Enabled</div>
                <div>✓ Safe Worker Process Graceful Shutdown: Verified</div>
              </div>
            </div>
            <div>
              <span style={styles.featureBadge}>DURABLE EXECUTION</span>
              <h2 style={styles.h2}>Zero Lost Events with BullMQ &amp; Redis</h2>
              <p style={styles.paragraph}>
                Workflows should never drop customer actions due to temporary server spikes or network glitches.
                Operza’s execution queue provides enterprise durability and exponential backoff retry handling.
              </p>
              <ul style={styles.list}>
                <li>Idempotency keys ensure non-idempotent actions (payments, SMS dispatches) never run twice</li>
                <li>Human approval gates halt workflow execution safely until authorized by a team manager</li>
                <li>Complete step execution audit trails for regulatory and client compliance</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section style={styles.ctaBox}>
        <div style={styles.container}>
          <h2 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 10px', color: '#0f172a' }}>
            Build Autonomous Agency Workflows Today
          </h2>
          <p style={{ fontSize: 15, color: '#475569', maxWidth: 520, margin: '0 auto 20px', lineHeight: 1.6 }}>
            Automate onboarding, client follow-ups, and pipeline updates with complete reliability.
          </p>
          <Link
            to="/signup"
            style={styles.btnPrimary}
            onClick={() => trackEvent('signup_start', { source: 'automation_bottom_cta' })}
          >
            Get Started Free →
          </Link>
        </div>
      </section>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageHeader: {
    padding: '60px 20px 48px',
    background: 'radial-gradient(ellipse at top, #f5f3ff 0%, #ffffff 80%)',
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
  node: {
    background: '#f8fafc',
    border: '1px solid #cbd5e1',
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 12.5,
    fontWeight: 600,
    color: '#0f172a',
    width: '100%',
    textAlign: 'center',
  },
  conditionNode: {
    background: '#fef3c7',
    border: '1px solid #fde68a',
    color: '#92400e',
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 12.5,
    fontWeight: 700,
    width: '100%',
    textAlign: 'center',
  },
  branchBox: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    padding: '8px',
    borderRadius: 6,
    fontSize: 11.5,
    textAlign: 'center',
    color: '#475569',
  },
  ctaBox: {
    padding: '60px 20px',
    textAlign: 'center',
    background: '#f1f5f9',
    borderTop: '1px solid #e2e8f0',
  },
};
