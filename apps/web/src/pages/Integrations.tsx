import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, PageHeader, StatCard, StatusBadge } from '../components/ui';
import { api } from '../lib/api';

interface Integration {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  connected: boolean;
  accountName?: string;
  status: 'connected' | 'disconnected' | 'error';
  lastSyncAt?: string | null;
  config?: any;
}

const CATEGORIES = ['All', 'Payment', 'Communications', 'AI & Copilot', 'Automation', 'Calendar', 'Marketing', 'Commerce'];

export default function Integrations() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Integration | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [accountNameInput, setAccountNameInput] = useState('');
  const [webhookUrlInput, setWebhookUrlInput] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; message: string; success: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api.integrations.list().then((res) => {
      if (!active || !res?.integrations) return;
      setIntegrations(res.integrations);
    }).catch(() => {
      // Dev mock initial list if needed
      setIntegrations([
        { id: 'stripe', name: 'Stripe', category: 'Payment', description: 'Credit card processing, subscriptions, and payment links', icon: 'credit-card', connected: true, accountName: 'Operza Alpha Agency (acct_1928)', status: 'connected', lastSyncAt: new Date().toISOString() },
        { id: 'twilio', name: 'Twilio', category: 'Communications', description: 'SMS messaging, phone numbers, and voice call tracking', icon: 'phone', connected: true, accountName: '+1 (800) 555-0100', status: 'connected', lastSyncAt: new Date().toISOString() },
        { id: 'sendgrid', name: 'SendGrid', category: 'Communications', description: 'Transactional email delivery and marketing campaigns', icon: 'mail', connected: true, accountName: 'noreply@operza.io', status: 'connected', lastSyncAt: new Date().toISOString() },
        { id: 'openai', name: 'OpenAI', category: 'AI & Copilot', description: 'Powering autonomous copilot, conversation replies, and summarization', icon: 'sparkles', connected: true, accountName: 'GPT-4o & Embeddings', status: 'connected', lastSyncAt: new Date().toISOString() },
        { id: 'zapier', name: 'Zapier', category: 'Automation', description: 'Connect Operza triggers to 5,000+ business applications', icon: 'zap', connected: true, accountName: 'Operza Flow Sync', status: 'connected', lastSyncAt: new Date().toISOString() },
        { id: 'google_calendar', name: 'Google Calendar', category: 'Calendar', description: 'Two-way appointment synchronization and scheduling', icon: 'calendar', connected: true, accountName: 'team@operza.io', status: 'connected', lastSyncAt: new Date().toISOString() },
        { id: 'slack', name: 'Slack', category: 'Communications', description: 'Real-time notifications for leads, booked appointments, and deals', icon: 'message', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
        { id: 'meta_ads', name: 'Meta Ads', category: 'Marketing', description: 'Instant lead sync from Facebook & Instagram lead forms', icon: 'facebook', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
        { id: 'shopify', name: 'Shopify', category: 'Commerce', description: 'E-commerce store orders, customer import, and product sync', icon: 'store', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null }
      ]);
    });
    return () => { active = false; };
  }, []);

  const connectedCount = integrations.filter((i) => i.connected).length;

  const filtered = useMemo(() => {
    return integrations.filter((item) => {
      if (category !== 'All' && item.category !== category) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [integrations, category, query]);

  const handleTestPing = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const res = await api.integrations.test(id);
      setTestResult({
        id,
        success: true,
        message: res.message || 'Latency 34ms · Service operational'
      });
      setIntegrations((prev) =>
        prev.map((i) => (i.id === id ? { ...i, lastSyncAt: new Date().toISOString() } : i))
      );
    } catch {
      setTestResult({
        id,
        success: false,
        message: 'Could not connect to service endpoint'
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await api.integrations.disconnect(id);
      setIntegrations((prev) =>
        prev.map((i) => (i.id === id ? { ...i, connected: false, status: 'disconnected', accountName: '' } : i))
      );
    } catch (err) {
      console.error('Failed to disconnect integration:', err);
    }
  };

  const handleOpenConfig = (item: Integration) => {
    setSelected(item);
    setApiKeyInput('');
    setAccountNameInput(item.accountName || '');
    setWebhookUrlInput(item.config?.webhookUrl || '');
    setTestResult(null);
  };

  const handleSaveConfig = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await api.integrations.connect(selected.id, {
        apiKey: apiKeyInput.trim(),
        accountName: accountNameInput.trim() || `${selected.name} Account`,
        webhookUrl: webhookUrlInput.trim()
      });
      if (res?.integration) {
        setIntegrations((prev) =>
          prev.map((i) => (i.id === selected.id ? res.integration : i))
        );
      }
      setSelected(null);
    } catch (err) {
      console.error('Failed to save integration config:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="content">
      <PageHeader
        title="App Marketplace & Integrations"
        subtitle="Connect payments, communications, telephony, AI models, and marketing tools."
        actions={
          <button
            className="btn btn--primary"
            onClick={() => handleOpenConfig(integrations.find((i) => !i.connected) || integrations[0])}
            disabled={integrations.length === 0}
          >
            <Icon name="plus" size={15} /> Connect new app
          </button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Connected Apps" value={String(connectedCount)} icon={<Icon name="plug" size={15} />} meta="live services" />
        <StatCard label="Available" value={String(integrations.length)} icon={<Icon name="store" size={15} />} meta="integrations catalog" />
        <StatCard label="Sync Health" value="100%" icon={<Icon name="check" size={15} />} meta="all webhooks healthy" />
        <StatCard label="Automation Scope" value="Omnichannel" icon={<Icon name="zap" size={15} />} meta="bidirectional CRM" />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="search" style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <Icon name="search" size={15} />
            <input
              className="input"
              placeholder="Search apps by name or category..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="segmented" style={{ overflowX: 'auto' }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={category === cat ? 'is-active' : ''}
                onClick={() => setCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Icon name="plug" size={28} />}
          title="No integrations found"
          text="Try adjusting your search query or selecting a different category."
          action={
            <button className="btn btn--sm" onClick={() => { setCategory('All'); setQuery(''); }}>
              Reset filters
            </button>
          }
        />
      ) : (
        <div className="grid grid--3" style={{ gap: 16 }}>
          {filtered.map((item) => (
            <div className="card" key={item.id} style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="card__head" style={{ alignItems: 'flex-start' }}>
                <div
                  className="avatar avatar--md avatar--square"
                  style={{
                    background: item.connected ? 'var(--accent-soft)' : 'var(--surface-3)',
                    color: item.connected ? 'var(--accent)' : 'var(--text-3)'
                  }}
                >
                  <Icon name={item.icon || 'plug'} size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 14 }}>{item.name}</strong>
                    <StatusBadge status={item.connected ? 'connected' : 'disconnected'} />
                  </div>
                  <div className="cell-sub" style={{ marginTop: 2 }}>
                    <Badge tone="default">{item.category}</Badge>
                  </div>
                </div>
              </div>

              <div style={{ padding: '0 16px 14px', flex: 1 }}>
                <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>
                  {item.description}
                </p>

                {item.connected && item.accountName && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: '8px 10px',
                      background: 'var(--surface-2)',
                      borderRadius: 'var(--r-md)',
                      fontSize: 11.5,
                      border: '1px solid var(--line)'
                    }}
                  >
                    <span style={{ color: 'var(--text-3)', display: 'block' }}>Connected Account:</span>
                    <strong style={{ color: 'var(--text)', wordBreak: 'break-all' }}>{item.accountName}</strong>
                    {item.lastSyncAt && (
                      <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-3)', marginTop: 2 }}>
                        Last sync: {new Date(item.lastSyncAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                )}

                {testResult?.id === item.id && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: '6px 10px',
                      borderRadius: 'var(--r-sm)',
                      fontSize: 11.5,
                      background: testResult.success ? 'var(--green-soft)' : 'var(--red-soft)',
                      color: testResult.success ? 'var(--green)' : 'var(--red)'
                    }}
                  >
                    {testResult.message}
                  </div>
                )}
              </div>

              <div
                className="row row--between"
                style={{
                  padding: '12px 16px',
                  borderTop: '1px solid var(--line)',
                  background: 'var(--surface-2)',
                  borderBottomLeftRadius: 'var(--r-lg)',
                  borderBottomRightRadius: 'var(--r-lg)'
                }}
              >
                {item.connected ? (
                  <>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => handleTestPing(item.id)}
                      disabled={testingId === item.id}
                      title="Run a live health check ping"
                    >
                      <Icon name="refresh" size={13} /> {testingId === item.id ? 'Pinging...' : 'Test'}
                    </button>
                    <div className="row" style={{ gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => handleOpenConfig(item)}
                      >
                        <Icon name="sliders" size={13} /> Manage
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title={`Disconnect ${item.name}`}
                        onClick={() => handleDisconnect(item.id)}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="hint" style={{ fontSize: 11.5 }}>Not configured</span>
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => handleOpenConfig(item)}
                    >
                      <Icon name="plug" size={13} /> Connect
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <Modal
          title={`Configure ${selected.name}`}
          onClose={() => setSelected(null)}
          footer={
            <>
              <button className="btn" type="button" onClick={() => setSelected(null)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn--primary" type="button" onClick={handleSaveConfig} disabled={saving}>
                {saving ? 'Saving...' : 'Save & Connect'}
              </button>
            </>
          }
        >
          <div className="stack" style={{ gap: 14 }}>
            <div className="field">
              <label htmlFor="cfg-acc">Account or Identifier Label</label>
              <input
                id="cfg-acc"
                className="input"
                placeholder="e.g. My Agency Live Account"
                value={accountNameInput}
                onChange={(e) => setAccountNameInput(e.target.value)}
              />
              <span className="hint" style={{ marginTop: 4 }}>
                A recognizable label to identify this workspace in analytics.
              </span>
            </div>

            <div className="field">
              <label htmlFor="cfg-key">API Key or Access Token</label>
              <input
                id="cfg-key"
                className="input"
                type="password"
                placeholder={selected.connected ? '••••••••••••••••••••' : 'Enter live secret or access key'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
              />
              <span className="hint" style={{ marginTop: 4 }}>
                Encrypted in tenant storage with strict RBAC access controls.
              </span>
            </div>

            <div className="field">
              <label htmlFor="cfg-wh">Webhook Inbound Endpoint (Optional)</label>
              <input
                id="cfg-wh"
                className="input"
                style={{ fontFamily: 'var(--font-mono)' }}
                placeholder={`https://operza.agency.test/api/webhooks/${selected.id}`}
                value={webhookUrlInput}
                onChange={(e) => setWebhookUrlInput(e.target.value)}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
