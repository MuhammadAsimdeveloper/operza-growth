import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from '../lib/api';
import { Badge, EmptyState } from './ui';

interface CurrencyBucket {
  currency: string;
  grossCollectedCents: number;
  refundedCents: number;
  netCollectedCents: number;
  failedAttemptCents: number;
}

interface MetricDef {
  id: string;
  name: string;
  category: string;
  sourceTable: string;
  aggregation: string;
  currencyMode: string;
  freshness: string;
}

interface OverviewPayload {
  source?: string;
  authoritative?: boolean;
  warning?: string;
  generatedAt?: string;
  freshness?: string;
  freshnessAt?: string;
  totals?: { contacts?: number; opportunities?: number; wonOpportunities?: number };
  crm?: { totalContacts: number };
  sales?: { totalOpportunities: number; wonOpportunities: number };
  funnel?: Array<{ name: string; count: number; stepConversionRate: number; overallConversionRate: number }>;
  financialByCurrency?: CurrencyBucket[];
  aiUsage?: { input_tokens: number; output_tokens: number; estimated_cost_microcents: number };
}

export function BiStudio2Panel() {
  const [tab, setTab] = useState<'overview' | 'builder' | 'catalog'>('overview');
  const [dataSource, setDataSource] = useState('opportunities');
  const [dimension, setDimension] = useState('status');
  const [queryRows, setQueryRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);

  const { data: overviewData } = useQuery<OverviewPayload>({
    queryKey: ['reports', 'v2', 'overview'],
    queryFn: () => request('/api/reports/v2/overview'),
  });

  const { data: catalogData } = useQuery<{ metrics?: MetricDef[] }>({
    queryKey: ['reports', 'v2', 'catalog'],
    queryFn: () => request('/api/reports/v2/catalog'),
  });

  const runCustomQuery = async () => {
    setQueryError(null);
    try {
      const res = await request<{ rows?: Array<Record<string, unknown>> }>('/api/reports/v2/query', {
        method: 'POST',
        body: JSON.stringify({ dataSource, dimensions: dimension ? [dimension] : [], measures: ['count'] }),
      });
      setQueryRows(res?.rows || []);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : 'Query failed');
    }
  };

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 16, marginBottom: 20, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Business Intelligence 2.0 &amp; Semantic Layer</div>
            {overviewData?.authoritative === false ? (
              <Badge tone="amber">Local Dev Fallback (Non-Authoritative)</Badge>
            ) : (
              <Badge tone="green">PostgreSQL Authoritative</Badge>
            )}
          </div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Source: {overviewData?.source || 'postgresql'} · Freshness: {overviewData?.freshness || 'real_time_source_query'} · Metrics Defined: {catalogData?.metrics?.length ?? 0}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['overview', 'builder', 'catalog'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? 'btn btn--primary' : 'btn btn--ghost'}
              onClick={() => setTab(t)}
            >
              {t === 'overview' ? 'Executive Overview' : t === 'builder' ? 'Custom Report Builder' : 'Metric Catalog'}
            </button>
          ))}
        </div>
      </div>

      {overviewData?.authoritative === false && (
        <div role="status" style={{ padding: '8px 12px', borderRadius: 8, background: '#fef3c7', color: '#92400e', fontSize: 12, marginBottom: 12 }}>
          {overviewData.warning || 'Local in-memory development metrics are non-authoritative and not backed by PostgreSQL.'}
        </div>
      )}

      {tab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: 12 }}>
            <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
              <div style={{ opacity: 0.7 }}>Contacts</div>
              <strong style={{ fontSize: 18 }}>{overviewData?.crm?.totalContacts ?? overviewData?.totals?.contacts ?? 0}</strong>
            </div>
            <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
              <div style={{ opacity: 0.7 }}>Opportunities / Won</div>
              <strong style={{ fontSize: 18 }}>
                {overviewData?.sales?.totalOpportunities ?? overviewData?.totals?.opportunities ?? 0} / {overviewData?.sales?.wonOpportunities ?? overviewData?.totals?.wonOpportunities ?? 0}
              </strong>
            </div>
            <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
              <div style={{ opacity: 0.7 }}>AI Tokens (In + Out)</div>
              <strong style={{ fontSize: 18 }}>
                {Number(overviewData?.aiUsage?.input_tokens || 0) + Number(overviewData?.aiUsage?.output_tokens || 0)}
              </strong>
            </div>
          </div>

          {(overviewData?.financialByCurrency || []).length > 0 && (
            <div style={{ fontSize: 12 }}>
              <strong>Currency-Separated Financials (Minor Units):</strong>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
                {(overviewData?.financialByCurrency || []).map((f) => (
                  <Badge key={f.currency} tone="green">
                    {f.currency.toUpperCase()}: Net {(f.netCollectedCents / 100).toFixed(2)} (Gross {(f.grossCollectedCents / 100).toFixed(2)}, Refund {(f.refundedCents / 100).toFixed(2)})
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'builder' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select className="input" value={dataSource} onChange={(e) => { setDataSource(e.target.value); setDimension('status'); }}>
              <option value="opportunities">Opportunities</option>
              <option value="appointments">Appointments</option>
              <option value="payments">Payments</option>
              <option value="workflow_executions">Workflow Executions</option>
              <option value="ai_runs">AI Runs</option>
            </select>
            <input className="input" value={dimension} onChange={(e) => setDimension(e.target.value)} placeholder="Dimension (e.g. status)" />
            <button type="button" className="btn btn--primary" onClick={runCustomQuery}>Run Safe Query</button>
          </div>
          {queryError && <div style={{ color: '#ef4444' }}>{queryError}</div>}
          {queryRows && (
            queryRows.length === 0 ? (
              <EmptyState icon="bar-chart" title="No matching rows" text="No records matched the selected allowlisted dimension." />
            ) : (
              <pre style={{ margin: 0, padding: 10, borderRadius: 8, background: 'var(--bg)', overflowX: 'auto' }}>
                {JSON.stringify(queryRows, null, 2)}
              </pre>
            )
          )}
        </div>
      )}

      {tab === 'catalog' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
          {(catalogData?.metrics || []).map((m) => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: 4 }}>
              <span><strong>{m.name}</strong> (<code>{m.id}</code>) · {m.sourceTable}</span>
              <Badge tone="blue">{m.category}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
