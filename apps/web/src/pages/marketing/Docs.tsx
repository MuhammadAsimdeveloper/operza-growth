import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SEO } from '../../components/SEO';
import { buildBreadcrumbSchema } from '../../lib/schema';
import { trackEvent } from '../../lib/analytics';

export default function Docs() {
  const [activeSection, setActiveSection] = useState<'overview' | 'api' | 'webhooks' | 'rls' | 'docker'>('overview');

  const jsonLd = [
    buildBreadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'Documentation', url: '/docs' },
    ]),
  ];

  return (
    <>
      <SEO
        title="Developer Documentation & Enterprise Architecture"
        description="Comprehensive technical documentation for Operza: REST API endpoints, webhook handling, PostgreSQL Row-Level Security, BullMQ job queues, and Docker container deployment."
        canonical="/docs"
        keywords={[
          'Operza documentation',
          'multi-tenant CRM architecture',
          'self-hosted marketing automation software',
          'agency CRM API',
        ]}
        jsonLd={jsonLd}
      />

      <div style={styles.pageHeader}>
        <div style={styles.container}>
          <div style={styles.breadcrumbs}>
            <Link to="/" style={styles.breadLink}>Home</Link>
            <span>/</span>
            <span style={{ color: '#4f46e5' }}>Documentation</span>
          </div>

          <h1 style={styles.h1}>Operza Developer &amp; Architecture Docs</h1>
          <p style={styles.lead}>
            Technical references, API specifications, and infrastructure deployment guides for engineers
            and technical operations directors.
          </p>
        </div>
      </div>

      <section style={styles.section}>
        <div style={styles.container}>
          <div style={styles.docsLayout}>
            {/* Docs Sidebar Nav */}
            <aside style={styles.sidebar}>
              <div style={styles.navGroup}>
                <div style={styles.groupTitle}>Getting Started</div>
                <button
                  type="button"
                  style={{ ...styles.docNavLink, ...(activeSection === 'overview' ? styles.docNavActive : {}) }}
                  onClick={() => { setActiveSection('overview'); trackEvent('doc_view', { section: 'overview' }); }}
                >
                  Architecture Overview
                </button>
                <button
                  type="button"
                  style={{ ...styles.docNavLink, ...(activeSection === 'docker' ? styles.docNavActive : {}) }}
                  onClick={() => { setActiveSection('docker'); trackEvent('doc_view', { section: 'docker' }); }}
                >
                  Docker Deployment
                </button>
              </div>

              <div style={styles.navGroup}>
                <div style={styles.groupTitle}>APIs &amp; Integration</div>
                <button
                  type="button"
                  style={{ ...styles.docNavLink, ...(activeSection === 'api' ? styles.docNavActive : {}) }}
                  onClick={() => { setActiveSection('api'); trackEvent('doc_view', { section: 'api' }); }}
                >
                  REST API Endpoints
                </button>
                <button
                  type="button"
                  style={{ ...styles.docNavLink, ...(activeSection === 'webhooks' ? styles.docNavActive : {}) }}
                  onClick={() => { setActiveSection('webhooks'); trackEvent('doc_view', { section: 'webhooks' }); }}
                >
                  Webhooks &amp; Events
                </button>
              </div>

              <div style={styles.navGroup}>
                <div style={styles.groupTitle}>Security &amp; Multi-Tenancy</div>
                <button
                  type="button"
                  style={{ ...styles.docNavLink, ...(activeSection === 'rls' ? styles.docNavActive : {}) }}
                  onClick={() => { setActiveSection('rls'); trackEvent('doc_view', { section: 'rls' }); }}
                >
                  PostgreSQL RLS Policies
                </button>
              </div>
            </aside>

            {/* Docs Content Body */}
            <div style={styles.contentBody}>
              {activeSection === 'overview' && (
                <div>
                  <h2 style={styles.docH2}>System Architecture Overview</h2>
                  <p style={styles.docP}>
                    Operza is engineered as a decoupled full-stack platform utilizing a high-performance
                    Node.js ESM backend, a React 19 frontend compiled via Vite, and a PostgreSQL relational database.
                  </p>
                  <div style={styles.codeBox}>
                    <div style={{ color: '#818cf8', marginBottom: 4 }}># High-Level Architecture Topology</div>
                    [Web Client: React 19 / Vite] ← WebSocket / REST → [Node.js Unified API Server: Port 4000]<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;├── [PostgreSQL 16: Strict RLS Isolation]<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└── [BullMQ Redis Queue: Async Workflows]
                  </div>

                  <h3 style={styles.docH3}>Core Workspace Subsystems</h3>
                  <ul style={styles.docList}>
                    <li><strong>Agency CRM:</strong> Contacts, pipelines, opportunities, smart lists, and notes.</li>
                    <li><strong>Workflow Engine:</strong> Graph walker traversing cubic bezier connections with event triggers.</li>
                    <li><strong>Funnel Engine:</strong> Modular WYSIWYG element serializer with order bump math.</li>
                    <li><strong>Omnichannel Bus:</strong> Unified Twilio, WhatsApp, Meta, and transactional email streams.</li>
                    <li><strong>Client Portal:</strong> HTML canvas e-signature agreements and Stripe invoice pay.</li>
                  </ul>
                </div>
              )}

              {activeSection === 'docker' && (
                <div>
                  <h2 style={styles.docH2}>Docker &amp; Self-Hosted Deployment</h2>
                  <p style={styles.docP}>
                    Operza can be packaged and run across any standard container runtime with zero external dependencies.
                  </p>
                  <div style={styles.codeBox}>
                    <span style={{ color: '#94a3b8' }}># Clone the repository</span><br />
                    git clone https://github.com/MuhammadAsimdeveloper/operza-growth.git<br />
                    cd operza-growth<br /><br />
                    <span style={{ color: '#94a3b8' }}># Boot the entire stack with Docker Compose</span><br />
                    docker compose up -d<br /><br />
                    <span style={{ color: '#34d399' }}># Operza will be available at http://localhost:5173</span>
                  </div>
                  <h3 style={styles.docH3}>Environment Configuration</h3>
                  <p style={styles.docP}>
                    Required environment variables include <code>DATABASE_URL</code> (PostgreSQL connection string)
                    and <code>REDIS_URL</code> (for BullMQ queue persistence).
                  </p>
                </div>
              )}

              {activeSection === 'api' && (
                <div>
                  <h2 style={styles.docH2}>REST API Endpoints</h2>
                  <p style={styles.docP}>
                    All agency resources are accessible via authenticated REST endpoints requiring standard Bearer tokens
                    or session cookies.
                  </p>
                  <div style={styles.endpointCard}>
                    <span style={styles.badgeGet}>GET</span>
                    <code>/api/crm/contacts</code>
                    <span style={styles.endpointDesc}>List and search workspace contacts</span>
                  </div>
                  <div style={styles.endpointCard}>
                    <span style={styles.badgePost}>POST</span>
                    <code>/api/crm/contacts</code>
                    <span style={styles.endpointDesc}>Create a new contact record</span>
                  </div>
                  <div style={styles.endpointCard}>
                    <span style={styles.badgePost}>POST</span>
                    <code>/api/workflows/:id/run</code>
                    <span style={styles.endpointDesc}>Trigger on-demand workflow execution</span>
                  </div>
                  <div style={styles.endpointCard}>
                    <span style={styles.badgeGet}>GET</span>
                    <code>/api/dashboard/stats</code>
                    <span style={styles.endpointDesc}>Fetch real-time pipeline and revenue metrics</span>
                  </div>
                </div>
              )}

              {activeSection === 'webhooks' && (
                <div>
                  <h2 style={styles.docH2}>Webhooks &amp; Ingress Protection</h2>
                  <p style={styles.docP}>
                    Operza provides hardened ingress handlers with cryptographic signature validation and replay attack prevention.
                  </p>
                  <ul style={styles.docList}>
                    <li><strong>Stripe Ingress:</strong> <code>/api/webhooks/stripe</code> verifies event signatures and prevents duplicate payment executions.</li>
                    <li><strong>Twilio Telephony:</strong> <code>/api/webhooks/twilio</code> parses inbound SMS and IVR voice events.</li>
                    <li><strong>WhatsApp Cloud API:</strong> <code>/api/webhooks/whatsapp</code> handles challenge handshakes and message ingestion.</li>
                  </ul>
                </div>
              )}

              {activeSection === 'rls' && (
                <div>
                  <h2 style={styles.docH2}>PostgreSQL Row-Level Security</h2>
                  <p style={styles.docP}>
                    Operza avoids application-level tenancy filtering which is prone to omission bugs.
                    Instead, every table (<code>contacts</code>, <code>opportunities</code>, <code>invoices</code>, <code>workflows</code>)
                    is protected with strict RLS policies:
                  </p>
                  <div style={styles.codeBox}>
                    <span style={{ color: '#818cf8' }}>CREATE POLICY</span> agency_isolation_policy <span style={{ color: '#818cf8' }}>ON</span> contacts<br />
                    &nbsp;&nbsp;<span style={{ color: '#818cf8' }}>FOR ALL</span><br />
                    &nbsp;&nbsp;<span style={{ color: '#818cf8' }}>USING</span> (agency_id = current_setting(<span style={{ color: '#a7f3d0' }}>'app.current_agency_id'</span>, <span style={{ color: '#f59e0b' }}>true</span>));
                  </div>
                  <p style={styles.docP}>
                    If a database connection fails to set the agency context, queries automatically return 0 records,
                    ensuring fail-closed security guarantees.
                  </p>
                </div>
              )}
            </div>
          </div>
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
  section: {
    padding: '48px 20px 80px',
  },
  docsLayout: {
    display: 'grid',
    gridTemplateColumns: '240px 1fr',
    gap: 48,
    alignItems: 'start',
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    borderRight: '1px solid #e2e8f0',
    paddingRight: 20,
  },
  navGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  groupTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 4,
  },
  docNavLink: {
    display: 'block',
    textAlign: 'left',
    padding: '6px 10px',
    fontSize: 13.5,
    color: '#475569',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  docNavActive: {
    background: '#eef0ff',
    color: '#4f46e5',
    fontWeight: 650,
  },
  contentBody: {
    minHeight: 400,
  },
  docH2: {
    fontSize: 26,
    fontWeight: 800,
    color: '#0f172a',
    margin: '0 0 14px',
  },
  docH3: {
    fontSize: 18,
    fontWeight: 700,
    color: '#0f172a',
    margin: '24px 0 10px',
  },
  docP: {
    fontSize: 14.5,
    lineHeight: 1.65,
    color: '#475569',
    margin: '0 0 16px',
  },
  codeBox: {
    background: '#0f172a',
    color: '#f8fafc',
    padding: 18,
    borderRadius: 8,
    fontFamily: 'var(--font-mono)',
    fontSize: 12.5,
    lineHeight: 1.6,
    marginBottom: 20,
  },
  docList: {
    paddingLeft: 20,
    fontSize: 14,
    color: '#334155',
    lineHeight: 1.7,
    margin: '0 0 16px',
  },
  endpointCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 14px',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    marginBottom: 10,
    fontSize: 13,
  },
  badgeGet: {
    background: '#dbeafe',
    color: '#1d4ed8',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
  },
  badgePost: {
    background: '#dcfce7',
    color: '#15803d',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
  },
  endpointDesc: {
    color: '#64748b',
    marginLeft: 'auto',
    fontSize: 12,
  },
};
