import { useState } from 'react';

export function ArchitectureDiagram() {
  const [view, setView] = useState<'system' | 'rls' | 'workflow'>('system');

  return (
    <div
      style={{
        background: 'var(--surface-2, #161b22)',
        border: '1px solid var(--line, #30363d)',
        borderRadius: 12,
        padding: 20,
        boxShadow: 'var(--shadow-md)',
        color: 'var(--text, #f0f6fc)',
        fontFamily: 'var(--font)',
      }}
    >
      {/* Header & View Switcher */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: 'var(--accent, #ff6d5a)',
                boxShadow: '0 0 10px var(--accent, #ff6d5a)',
              }}
            />
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
              Operza Production Architecture & Data Flow
            </h3>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-3, #8b949e)', marginTop: 2, margin: 0 }}>
            Editorial system topology, Row-Level Security tenant isolation, and visual pipeline execution.
          </p>
        </div>

        <div className="tabs" style={{ margin: 0 }}>
          <button
            type="button"
            className={`tab ${view === 'system' ? 'is-active' : ''}`}
            onClick={() => setView('system')}
          >
            System Topology
          </button>
          <button
            type="button"
            className={`tab ${view === 'rls' ? 'is-active' : ''}`}
            onClick={() => setView('rls')}
          >
            Multi-Tenant RLS Isolation
          </button>
          <button
            type="button"
            className={`tab ${view === 'workflow' ? 'is-active' : ''}`}
            onClick={() => setView('workflow')}
          >
            Workflow Execution Walker
          </button>
        </div>
      </div>

      {/* SVG Diagram Canvas */}
      <div
        style={{
          background: 'var(--bg, #0d1117)',
          border: '1px solid var(--line, #21262d)',
          borderRadius: 8,
          overflow: 'hidden',
          position: 'relative',
          padding: '16px',
        }}
      >
        {view === 'system' && (
          <svg
            viewBox="0 0 880 440"
            style={{ width: '100%', height: 'auto', display: 'block', maxHeight: 440 }}
          >
            <defs>
              <linearGradient id="coralGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ff6d5a" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#ea4b71" stopOpacity="0.8" />
              </linearGradient>
              <linearGradient id="indigoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.8" />
              </linearGradient>
              <linearGradient id="emeraldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#059669" stopOpacity="0.8" />
              </linearGradient>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#8b949e" />
              </marker>
            </defs>

            {/* Layer 1: Ingress & Clients */}
            <g transform="translate(20, 30)">
              <rect width="180" height="380" rx="10" fill="#161b22" stroke="#30363d" strokeWidth="1" />
              <text x="20" y="32" fill="#8b949e" fontSize="11" fontWeight="700" letterSpacing="0.05em">
                1. INGRESS & CLIENTS
              </text>

              {/* Node: Web App */}
              <g transform="translate(15, 50)">
                <rect width="150" height="60" rx="8" fill="#21262d" stroke="#30363d" />
                <circle cx="24" cy="30" r="12" fill="url(#coralGrad)" />
                <text x="46" y="27" fill="#f0f6fc" fontSize="12" fontWeight="600">React 19 App</text>
                <text x="46" y="42" fill="#8b949e" fontSize="10">Vite · Tailwind · Dark</text>
              </g>

              {/* Node: Client Portal */}
              <g transform="translate(15, 125)">
                <rect width="150" height="60" rx="8" fill="#21262d" stroke="#30363d" />
                <circle cx="24" cy="30" r="12" fill="#3b82f6" />
                <text x="46" y="27" fill="#f0f6fc" fontSize="12" fontWeight="600">Client Portal</text>
                <text x="46" y="42" fill="#8b949e" fontSize="10">White-label Invoicing</text>
              </g>

              {/* Node: Webhook Ingress */}
              <g transform="translate(15, 200)">
                <rect width="150" height="60" rx="8" fill="#21262d" stroke="#30363d" />
                <circle cx="24" cy="30" r="12" fill="#8b5cf6" />
                <text x="46" y="27" fill="#f0f6fc" fontSize="12" fontWeight="600">Webhooks & API</text>
                <text x="46" y="42" fill="#8b949e" fontSize="10">HMAC Sig · Replay Gate</text>
              </g>

              {/* Node: Mobile / Omni */}
              <g transform="translate(15, 275)">
                <rect width="150" height="60" rx="8" fill="#21262d" stroke="#30363d" />
                <circle cx="24" cy="30" r="12" fill="#10b981" />
                <text x="46" y="27" fill="#f0f6fc" fontSize="12" fontWeight="600">Omni Gateways</text>
                <text x="46" y="42" fill="#8b949e" fontSize="10">WhatsApp · SMS · Meta</text>
              </g>
            </g>

            {/* Connection Wires: Layer 1 to Layer 2 */}
            <path d="M 200 110 C 240 110, 250 160, 280 160" fill="none" stroke="#484f58" strokeWidth="2" markerEnd="url(#arrow)" />
            <path d="M 200 185 C 240 185, 250 185, 280 185" fill="none" stroke="#484f58" strokeWidth="2" markerEnd="url(#arrow)" />
            <path d="M 200 260 C 240 260, 250 210, 280 210" fill="none" stroke="#484f58" strokeWidth="2" markerEnd="url(#arrow)" />

            {/* Layer 2: API Gateway & Security */}
            <g transform="translate(280, 70)">
              <rect width="200" height="300" rx="10" fill="#161b22" stroke="#30363d" strokeWidth="1" />
              <text x="20" y="32" fill="#8b949e" fontSize="11" fontWeight="700" letterSpacing="0.05em">
                2. API & GATEWAY TIER
              </text>

              {/* Node: Gateway Router */}
              <g transform="translate(15, 50)">
                <rect width="170" height="65" rx="8" fill="#21262d" stroke="#484f58" />
                <text x="14" y="26" fill="#f0f6fc" fontSize="12" fontWeight="700">Fastify / Express Core</text>
                <text x="14" y="42" fill="#8b949e" fontSize="10.5">Helmet · CORS · CSRF</text>
                <text x="14" y="55" fill="#ff6d5a" fontSize="10" fontWeight="600">Rate Limiter (100 req/min)</text>
              </g>

              {/* Node: Auth & Context */}
              <g transform="translate(15, 130)">
                <rect width="170" height="65" rx="8" fill="#21262d" stroke="#484f58" />
                <text x="14" y="26" fill="#f0f6fc" fontSize="12" fontWeight="700">Tenant Resolver</text>
                <text x="14" y="42" fill="#8b949e" fontSize="10.5">JWT / Session Cookie</text>
                <text x="14" y="55" fill="#a371f7" fontSize="10" fontWeight="600">RLS Context Injector</text>
              </g>

              {/* Node: Realtime WS */}
              <g transform="translate(15, 210)">
                <rect width="170" height="65" rx="8" fill="#21262d" stroke="#484f58" />
                <text x="14" y="26" fill="#f0f6fc" fontSize="12" fontWeight="700">WebSocket Dispatcher</text>
                <text x="14" y="42" fill="#8b949e" fontSize="10.5">Agency Event Channels</text>
                <text x="14" y="55" fill="#388bfd" fontSize="10" fontWeight="600">Zero Cross-Tenant Leakage</text>
              </g>
            </g>

            {/* Connection Wires: Layer 2 to Layer 3 */}
            <path d="M 480 155 C 520 155, 530 140, 560 140" fill="none" stroke="#6366f1" strokeWidth="2" markerEnd="url(#arrow)" />
            <path d="M 480 230 C 520 230, 530 250, 560 250" fill="none" stroke="#10b981" strokeWidth="2" markerEnd="url(#arrow)" />

            {/* Layer 3: Engines & Durable State */}
            <g transform="translate(560, 30)">
              <rect width="280" height="380" rx="10" fill="#161b22" stroke="#30363d" strokeWidth="1" />
              <text x="20" y="32" fill="#8b949e" fontSize="11" fontWeight="700" letterSpacing="0.05em">
                3. ENGINES & POSTGRES DATA
              </text>

              {/* Node: n8n Workflow Engine */}
              <g transform="translate(15, 50)">
                <rect width="250" height="75" rx="8" fill="#21262d" stroke="#6366f1" strokeWidth="1.5" />
                <text x="16" y="26" fill="#f0f6fc" fontSize="12.5" fontWeight="700">n8n Workflow Engine</text>
                <text x="16" y="43" fill="#8b949e" fontSize="11">Graph Walker · Safe JS Sandbox</text>
                <text x="16" y="58" fill="#8b949e" fontSize="10">Retry Backoff · Checksums</text>
                <circle cx="230" cy="24" r="5" fill="#ff6d5a" />
              </g>

              {/* Node: BullMQ Queue */}
              <g transform="translate(15, 140)">
                <rect width="250" height="70" rx="8" fill="#21262d" stroke="#484f58" />
                <text x="16" y="26" fill="#f0f6fc" fontSize="12" fontWeight="700">BullMQ Redis Queue</text>
                <text x="16" y="43" fill="#8b949e" fontSize="10.5">Durable Jobs · DLQ Routing</text>
                <text x="16" y="57" fill="#d29922" fontSize="10">Concurrency Controls · Webhooks</text>
              </g>

              {/* Node: PostgreSQL Multi-Tenant RLS */}
              <g transform="translate(15, 225)">
                <rect width="250" height="85" rx="8" fill="#21262d" stroke="#10b981" strokeWidth="1.5" />
                <text x="16" y="26" fill="#f0f6fc" fontSize="12.5" fontWeight="700">PostgreSQL (RLS Enforced)</text>
                <text x="16" y="43" fill="#10b981" fontSize="10.5" fontWeight="600">SET LOCAL app.current_agency_id</text>
                <text x="16" y="58" fill="#8b949e" fontSize="10">Contacts · Funnels · Workflows · Ledger</text>
                <text x="16" y="73" fill="#8b949e" fontSize="9.5">Transactions · Read/Write Safety</text>
              </g>

              {/* Node: External Integrations */}
              <g transform="translate(15, 322)">
                <rect width="250" height="42" rx="6" fill="#1a202c" stroke="#30363d" />
                <text x="14" y="26" fill="#8b949e" fontSize="11" fontWeight="500">
                  ⚡ Stripe · Twilio · WhatsApp · Resend
                </text>
              </g>
            </g>
          </svg>
        )}

        {view === 'rls' && (
          <div style={{ padding: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <div
                style={{
                  background: 'var(--surface-3, #21262d)',
                  borderRadius: 8,
                  padding: 16,
                  border: '1px solid var(--line, #30363d)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent, #ff6d5a)', marginBottom: 6 }}>
                  1. Request Ingress & Token Extraction
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-2, #8b949e)', lineHeight: 1.5, margin: 0 }}>
                  Every incoming API call must present an authenticated JWT cookie or API token. The middleware parses the verified <code>agencyId</code>.
                </p>
              </div>

              <div
                style={{
                  background: 'var(--surface-3, #21262d)',
                  borderRadius: 8,
                  padding: 16,
                  border: '1px solid var(--line, #30363d)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue, #388bfd)', marginBottom: 6 }}>
                  2. Transaction Context Injection
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-2, #8b949e)', lineHeight: 1.5, margin: 0 }}>
                  The backend executes <code>SET LOCAL app.current_agency_id = :agencyId</code> within an isolated PostgreSQL transaction block.
                </p>
              </div>

              <div
                style={{
                  background: 'var(--surface-3, #21262d)',
                  borderRadius: 8,
                  padding: 16,
                  border: '1px solid var(--line, #30363d)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green, #2ea043)', marginBottom: 6 }}>
                  3. Hardware-Level Zero Leakage
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-2, #8b949e)', lineHeight: 1.5, margin: 0 }}>
                  Postgres RLS filters every table query automatically. Even if code omits a WHERE clause, rows from other agencies are completely invisible (HTTP 404).
                </p>
              </div>
            </div>
          </div>
        )}

        {view === 'workflow' && (
          <div style={{ padding: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <div style={{ background: '#161b22', padding: 14, borderRadius: 8, border: '1px solid #30363d' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#ff6d5a', display: 'block', marginBottom: 4 }}>STEP 1: INGESTION</span>
                <strong style={{ fontSize: 13 }}>Trigger Node Fires</strong>
                <p style={{ fontSize: 11.5, color: '#8b949e', marginTop: 4, margin: 0 }}>Webhook, Schedule, or Form submission generates incoming item payload.</p>
              </div>

              <div style={{ background: '#161b22', padding: 14, borderRadius: 8, border: '1px solid #30363d' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#388bfd', display: 'block', marginBottom: 4 }}>STEP 2: GRAPH WALKER</span>
                <strong style={{ fontSize: 13 }}>Node Traversal</strong>
                <p style={{ fontSize: 11.5, color: '#8b949e', marginTop: 4, margin: 0 }}>Sequential and conditional branches routed via topological DAG traversal.</p>
              </div>

              <div style={{ background: '#161b22', padding: 14, borderRadius: 8, border: '1px solid #30363d' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#a371f7', display: 'block', marginBottom: 4 }}>STEP 3: SANDBOX</span>
                <strong style={{ fontSize: 13 }}>Safe JS Evaluation</strong>
                <p style={{ fontSize: 11.5, color: '#8b949e', marginTop: 4, margin: 0 }}>Code transformations execute in isolated Node vm without network or filesystem access.</p>
              </div>

              <div style={{ background: '#161b22', padding: 14, borderRadius: 8, border: '1px solid #30363d' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#2ea043', display: 'block', marginBottom: 4 }}>STEP 4: SETTLEMENT</span>
                <strong style={{ fontSize: 13 }}>Execution Timeline</strong>
                <p style={{ fontSize: 11.5, color: '#8b949e', marginTop: 4, margin: 0 }}>State checksum calculated, node outputs stored, and real-time pulse emitted over WS.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
