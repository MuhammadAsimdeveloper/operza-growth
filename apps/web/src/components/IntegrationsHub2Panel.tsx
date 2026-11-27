import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../lib/api';
import { Badge, EmptyState } from './ui';

interface ConnectorSpec {
  id: string;
  name: string;
  provider: string;
  category: string;
  description: string;
  authStrategy: string;
  readinessLevel: string;
  triggers: Array<{ id: string; name: string }>;
  actions: Array<{ id: string; name: string }>;
}

interface IntegrationConn {
  id: string;
  connectorId: string;
  accountLabel: string;
  status: string;
  readinessLevel: string;
  tokenExpiresAt?: string | null;
  lastTestedAt?: string | null;
  circuitState: string;
}

interface WebhookEventRow {
  id: string;
  provider: string;
  event_type: string;
  processing_state: string;
  received_at: string;
}

interface SyncConflictRow {
  id: string;
  local_record_id: string;
  external_record_id: string;
  status: string;
}

const READINESS_TONE: Record<string, 'green' | 'amber' | 'blue' | 'default'> = {
  live_verified: 'green',
  production_configured: 'green',
  sandbox_verified: 'blue',
  unit_tested: 'amber',
  implemented_adapter: 'default',
};

export function IntegrationsHub2Panel() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'catalog' | 'connections' | 'webhooks' | 'sync' | 'specs'>('catalog');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [selectedConnector, setSelectedConnector] = useState<ConnectorSpec | null>(null);

  const { data: catalogData } = useQuery<{ connectors?: ConnectorSpec[] }>({
    queryKey: ['integrations', 'v2', 'catalog', category, search],
    queryFn: () =>
      request<{ connectors?: ConnectorSpec[] }>(
        `/api/integrations/v2/catalog?category=${encodeURIComponent(category)}&search=${encodeURIComponent(search)}`
      ),
  });

  const { data: connData } = useQuery<{ connections?: IntegrationConn[] }>({
    queryKey: ['integrations', 'v2', 'connections'],
    queryFn: () => request<{ connections?: IntegrationConn[] }>('/api/integrations/v2/connections'),
  });

  const { data: webhookData } = useQuery<{ events?: WebhookEventRow[] }>({
    queryKey: ['integrations', 'v2', 'webhooks'],
    queryFn: () => request<{ events?: WebhookEventRow[] }>('/api/integrations/v2/webhooks/events'),
  });

  const { data: conflictData } = useQuery<{ conflicts?: SyncConflictRow[] }>({
    queryKey: ['integrations', 'v2', 'conflicts'],
    queryFn: () => request<{ conflicts?: SyncConflictRow[] }>('/api/integrations/v2/sync/conflicts'),
  });

  const { data: metricsData } = useQuery<{
    connections?: { total: number; active: number; degraded: number };
    webhookEvents?: { total_events: number; dead_letter_count: number };
    openSyncConflicts?: number;
  }>({
    queryKey: ['integrations', 'v2', 'metrics'],
    queryFn: () => request('/api/integrations/v2/metrics'),
  });

  const connectors = catalogData?.connectors || [];
  const connections = connData?.connections || [];
  const events = webhookData?.events || [];
  const conflicts = conflictData?.conflicts || [];

  const handleTestConnection = async (id: string) => {
    await request(`/api/integrations/v2/connections/${id}/test`, { method: 'POST', body: '{}' });
    await queryClient.invalidateQueries({ queryKey: ['integrations', 'v2'] });
  };

  const handleDisconnect = async (id: string) => {
    await request(`/api/integrations/v2/connections/${id}/disconnect`, { method: 'POST', body: '{}' });
    await queryClient.invalidateQueries({ queryKey: ['integrations', 'v2'] });
  };

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 16, marginBottom: 18, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Integrations Hub 2.0</div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Active: {metricsData?.connections?.active ?? 0} · Degraded: {metricsData?.connections?.degraded ?? 0} · Open Conflicts: {metricsData?.openSyncConflicts ?? 0}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['catalog', 'connections', 'webhooks', 'sync', 'specs'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? 'btn btn--primary' : 'btn btn--ghost'}
              onClick={() => setTab(t)}
            >
              {t === 'catalog' ? 'Catalog' : t === 'connections' ? 'Connections' : t === 'webhooks' ? 'Webhooks' : t === 'sync' ? 'Sync & Conflicts' : 'Developer Specs'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'catalog' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input className="input" placeholder="Search connectors..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">All categories</option>
              <option value="crm">CRM</option>
              <option value="communication">Communication</option>
              <option value="payments">Payments</option>
              <option value="automation">Automation</option>
              <option value="developer">Developer</option>
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {connectors.map((c) => (
              <div key={c.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <strong style={{ fontSize: 13 }}>{c.name}</strong>
                  <Badge tone={READINESS_TONE[c.readinessLevel] || 'default'}>{c.readinessLevel.replace(/_/g, ' ')}</Badge>
                </div>
                <div style={{ fontSize: 12, opacity: 0.78, marginBottom: 8 }}>{c.description}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                  <span>{c.triggers.length} triggers · {c.actions.length} actions</span>
                  <button type="button" className="btn btn--ghost" onClick={() => { setSelectedConnector(c); setTab('specs'); }}>
                    Inspect
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'connections' && (
        connections.length === 0 ? (
          <EmptyState icon="plug" title="No active V2 connections" text="Connect an integration via OAuth 2.0 PKCE or encrypted vault reference." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {connections.map((conn) => (
              <div key={conn.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
                <div>
                  <strong style={{ fontSize: 13 }}>{conn.accountLabel || conn.connectorId}</strong>
                  <div style={{ fontSize: 11, opacity: 0.75 }}>
                    Status: {conn.status} · Circuit: {conn.circuitState} · Readiness: {conn.readinessLevel}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn--ghost" onClick={() => handleTestConnection(conn.id)}>Test</button>
                  <button type="button" className="btn btn--ghost" onClick={() => handleDisconnect(conn.id)}>Disconnect</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'webhooks' && (
        events.length === 0 ? (
          <EmptyState icon="webhook" title="No webhook events recorded" text="Signed inbound and outbound webhook deliveries appear here." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
            {events.map((ev) => (
              <div key={ev.id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: 4 }}>
                <span><strong>{ev.provider}</strong> · {ev.event_type}</span>
                <Badge tone={ev.processing_state === 'dead_letter' ? 'red' : 'green'}>{ev.processing_state}</Badge>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'sync' && (
        conflicts.length === 0 ? (
          <EmptyState icon="refresh" title="No open sync conflicts" text="Two-way synchronization conflicts queued for review appear here." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
            {conflicts.map((cf) => (
              <div key={cf.id} style={{ display: 'flex', justifyContent: 'space-between', border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}>
                <span>Local {cf.local_record_id} ↔ External {cf.external_record_id}</span>
                <Badge tone="amber">{cf.status}</Badge>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'specs' && (
        selectedConnector ? (
          <div style={{ fontSize: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{selectedConnector.name} ({selectedConnector.provider})</div>
            <div>Auth Strategy: {selectedConnector.authStrategy}</div>
            <div>Triggers: {selectedConnector.triggers.map(t => t.id).join(', ') || 'None'}</div>
            <div>Actions: {selectedConnector.actions.map(a => a.id).join(', ') || 'None'}</div>
          </div>
        ) : (
          <div style={{ fontSize: 12, opacity: 0.75 }}>Select a connector from the Catalog tab to inspect its SDK 2.0 specification.</div>
        )
      )}
    </div>
  );
}
