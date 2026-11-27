import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../lib/api';
import { Badge, Button, Card, EmptyState, Alert } from './ui';

type Tab = 'inbox' | 'campaigns' | 'templates' | 'journeys' | 'suppression' | 'analytics';

interface TemplateItem {
  id: string;
  name: string;
  channel: string;
  subject?: string;
  body: string;
  approval_status: string;
  version: number;
}

interface CampaignItem {
  id: string;
  name: string;
  channel: string;
  status: string;
  timezone: string;
  total_recipients: number;
  eligible_recipients: number;
}

interface SuppressionItem {
  id: string;
  channel: string;
  identifier: string;
  reason: string;
  source: string;
}

export function EngagementHub2Panel() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('inbox');
  const [aiInput, setAiInput] = useState('Can I book a demo and see pricing?');
  const [aiResult, setAiResult] = useState<any>(null);
  const [tplName, setTplName] = useState('');
  const [tplChannel, setTplChannel] = useState('email');
  const [tplBody, setTplBody] = useState('Hi {{contact.first_name}}, thanks for connecting with {{contact.company}}.');
  const [tplPreview, setTplPreview] = useState<string | null>(null);
  const [campName, setCampName] = useState('');
  const [campChannel, setCampChannel] = useState('email');
  const [supId, setSupId] = useState('');
  const [supChannel, setSupChannel] = useState('sms');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const templatesQ = useQuery({
    queryKey: ['engagement2', 'templates'],
    queryFn: () => request<{ data: TemplateItem[] }>('/api/engagement/v2/templates'),
    retry: false,
  });

  const campaignsQ = useQuery({
    queryKey: ['engagement2', 'campaigns'],
    queryFn: () => request<{ data: CampaignItem[] }>('/api/engagement/v2/campaigns'),
    retry: false,
  });

  const suppressionsQ = useQuery({
    queryKey: ['engagement2', 'suppressions'],
    queryFn: () => request<{ data: SuppressionItem[] }>('/api/engagement/v2/suppressions'),
    retry: false,
  });

  const analyticsQ = useQuery({
    queryKey: ['engagement2', 'analytics'],
    queryFn: () => request<any>('/api/engagement/v2/analytics'),
    retry: false,
  });

  const aiAssistMut = useMutation({
    mutationFn: (text: string) =>
      request('/api/engagement/v2/inbox/ai-assist', {
        method: 'POST',
        body: JSON.stringify({
          contact: { firstName: 'Customer' },
          messages: [{ direction: 'inbound', channel: 'sms', body: text }],
          autoSendPolicyEnabled: false,
        }),
      }),
    onSuccess: (data) => {
      setErrorMsg(null);
      setAiResult(data);
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const previewTplMut = useMutation({
    mutationFn: () =>
      request<{ rendered: string }>('/api/engagement/v2/templates/preview', {
        method: 'POST',
        body: JSON.stringify({
          channel: tplChannel,
          body: tplBody,
          context: { contact: { first_name: 'Elena', company: 'Vance Dynamics' } },
        }),
      }),
    onSuccess: (data) => {
      setErrorMsg(null);
      setTplPreview(data.rendered);
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const createTplMut = useMutation({
    mutationFn: () =>
      request('/api/engagement/v2/templates', {
        method: 'POST',
        body: JSON.stringify({ name: tplName || 'Engagement Template', channel: tplChannel, body: tplBody }),
      }),
    onSuccess: () => {
      setErrorMsg(null);
      setTplName('');
      qc.invalidateQueries({ queryKey: ['engagement2', 'templates'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const createCampMut = useMutation({
    mutationFn: () =>
      request('/api/engagement/v2/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name: campName || 'Q4 Outreach', channel: campChannel, body: tplBody }),
      }),
    onSuccess: () => {
      setErrorMsg(null);
      setCampName('');
      qc.invalidateQueries({ queryKey: ['engagement2', 'campaigns'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const addSupMut = useMutation({
    mutationFn: () =>
      request('/api/engagement/v2/suppressions', {
        method: 'POST',
        body: JSON.stringify({ channel: supChannel, identifier: supId, reason: 'opt_out', source: 'manual' }),
      }),
    onSuccess: () => {
      setErrorMsg(null);
      setSupId('');
      qc.invalidateQueries({ queryKey: ['engagement2', 'suppressions'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  return (
    <Card className="p-5" style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Customer Engagement &amp; Marketing Automation 2.0</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-2)' }}>
            Human-approved AI inbox assistant, consent-gated campaigns, safe templates, Workflow 2.0 journeys, and suppression governance.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(['inbox', 'campaigns', 'templates', 'journeys', 'suppression', 'analytics'] as Tab[]).map((t) => (
            <Button key={t} variant={tab === t ? 'primary' : 'secondary'} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {errorMsg && <Alert tone="danger" title="Engagement Action Error">{errorMsg}</Alert>}

      {tab === 'inbox' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>AI Response Assistant (Human Approval Required)</div>
          <textarea
            className="textarea"
            rows={2}
            value={aiInput}
            onChange={(e) => setAiInput(e.target.value)}
            aria-label="Inbound customer message"
          />
          <div>
            <Button onClick={() => aiAssistMut.mutate(aiInput)} disabled={aiAssistMut.isPending}>
              {aiAssistMut.isPending ? 'Analyzing...' : 'Generate AI Suggestion'}
            </Button>
          </div>
          {aiResult && (
            <div style={{ padding: 12, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-2)' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <Badge tone="accent">AI Draft (Requires Human Review)</Badge>
                <Badge tone="default">Intent: {aiResult.intent}</Badge>
                <Badge tone="default">Sentiment: {aiResult.sentiment}</Badge>
              </div>
              <p style={{ margin: '0 0 6px', fontSize: 13 }}>{aiResult.summary}</p>
              <div style={{ padding: 10, borderRadius: 6, background: 'var(--surface)', fontSize: 13 }}>
                {aiResult.suggestedReply}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'templates' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <input className="input" placeholder="Template name" value={tplName} onChange={(e) => setTplName(e.target.value)} />
            <select className="select" value={tplChannel} onChange={(e) => setTplChannel(e.target.value)}>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="internal_notification">Internal Notification</option>
            </select>
            <Button variant="secondary" onClick={() => previewTplMut.mutate()}>Safe Preview</Button>
            <Button onClick={() => createTplMut.mutate()} disabled={createTplMut.isPending}>Save Template</Button>
          </div>
          <textarea className="textarea" rows={2} value={tplBody} onChange={(e) => setTplBody(e.target.value)} />
          {tplPreview !== null && (
            <Alert tone="info" title="Escaped Preview">{tplPreview}</Alert>
          )}
          {(templatesQ.data?.data?.length ?? 0) === 0 ? (
            <EmptyState title="No Engagement 2.0 templates yet" text="Create a validated template above (PostgreSQL required for persistence)." />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {templatesQ.data?.data.map((t) => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 10, border: '1px solid var(--line)', borderRadius: 8 }}>
                  <span><strong>{t.name}</strong> ({t.channel}) v{t.version}</span>
                  <Badge tone={t.approval_status === 'approved' ? 'green' : 'default'}>{t.approval_status}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'campaigns' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <input className="input" placeholder="Campaign name" value={campName} onChange={(e) => setCampName(e.target.value)} />
            <select className="select" value={campChannel} onChange={(e) => setCampChannel(e.target.value)}>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="internal_notification">Internal Notification</option>
            </select>
            <Button onClick={() => createCampMut.mutate()} disabled={createCampMut.isPending}>Create Draft Campaign</Button>
          </div>
          {(campaignsQ.data?.data?.length ?? 0) === 0 ? (
            <EmptyState title="No Engagement 2.0 campaigns yet" text="Draft campaigns start in review-gated status and recheck consent before send." />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {campaignsQ.data?.data.map((c) => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 10, border: '1px solid var(--line)', borderRadius: 8 }}>
                  <span><strong>{c.name}</strong> · {c.channel} · {c.eligible_recipients}/{c.total_recipients} eligible</span>
                  <Badge tone={c.status === 'completed' ? 'green' : 'default'}>{c.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'journeys' && (
        <Alert tone="info" title="Powered by Workflow Engine 2.0">
          Marketing journeys (new lead follow-up, appointment reminders, post-purchase, and review requests) execute on Workflow Engine 2.0 with deduplicated enrollment (`engagement_journey_enrollments`) and automatic exit on opt-out. Manage graphs in Workflow Studio (`/workflows`).
        </Alert>
      )}

      {tab === 'suppression' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <input className="input" placeholder="Email or phone identifier" value={supId} onChange={(e) => setSupId(e.target.value)} />
            <select className="select" value={supChannel} onChange={(e) => setSupChannel(e.target.value)}>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="all">All Channels</option>
            </select>
            <Button onClick={() => addSupMut.mutate()} disabled={!supId.trim() || addSupMut.isPending}>Add Suppression</Button>
          </div>
          {(suppressionsQ.data?.data?.length ?? 0) === 0 ? (
            <EmptyState title="Suppression list empty" text="Inbound STOP/UNSUBSCRIBE callbacks and manual opt-outs appear here." />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {suppressionsQ.data?.data.map((s) => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 10, border: '1px solid var(--line)', borderRadius: 8 }}>
                  <span>{s.identifier} ({s.channel})</span>
                  <Badge tone="red">{s.reason} · {s.source}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'analytics' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <div style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Conversations</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{analyticsQ.data?.conversations?.total ?? 0}</div>
          </div>
          <div style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Campaigns</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{analyticsQ.data?.campaigns?.total ?? 0}</div>
          </div>
          <div style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Delivered Recipients</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{analyticsQ.data?.deliveries?.delivered ?? 0}</div>
          </div>
          <div style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Suppressions</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{analyticsQ.data?.suppressions?.total ?? 0}</div>
          </div>
        </div>
      )}
    </Card>
  );
}
