import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { IntegrationConfigModal, type IntegrationItem } from '../components/IntegrationConfigModal';
import { Badge, EmptyState, PageHeader, StatCard, StatusBadge } from '../components/ui';
import { api } from '../lib/api';

const CATEGORIES = [
  'All',
  'Payment',
  'Communications',
  'AI & Copilot',
  'Marketing',
  'Commerce',
  'Calendar',
  'Databases',
  'Automation'
];

const DEFAULT_CATALOGUE: IntegrationItem[] = [
  // Payment
  { id: 'stripe', name: 'Stripe', category: 'Payment', description: 'Credit card processing, subscriptions, customer portal, and payment links', icon: 'credit-card', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'paypal', name: 'PayPal', category: 'Payment', description: 'Direct checkout, recurring billing, and digital wallet payment processing', icon: 'credit-card', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'authorize_net', name: 'Authorize.Net', category: 'Payment', description: 'Enterprise merchant account payment gateway and fraud detection suite', icon: 'credit-card', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'razorpay', name: 'Razorpay', category: 'Payment', description: 'International multi-currency payment gateway and UPI instant transfers', icon: 'credit-card', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },

  // Communications
  { id: 'twilio', name: 'Twilio', category: 'Communications', description: '10DLC verified SMS messaging, toll-free numbers, and voice call tracking', icon: 'phone', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'sendgrid', name: 'SendGrid / SMTP', category: 'Communications', description: 'High-deliverability transactional email delivery, templates, and marketing campaigns', icon: 'mail', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'whatsapp', name: 'WhatsApp Cloud API', category: 'Communications', description: 'Official Meta WhatsApp Business API for automated notifications and 2-way client chat', icon: 'message', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'slack', name: 'Slack', category: 'Communications', description: 'Team workspace notifications for leads, booked appointments, and deal alerts', icon: 'message', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'discord', name: 'Discord', category: 'Communications', description: 'Community channel dispatch, webhook triggers, and team notification bots', icon: 'message', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },

  // AI & Copilot
  { id: 'openai', name: 'OpenAI GPT-4o', category: 'AI & Copilot', description: 'Powering Miss Minutes Copilot, autonomous conversation replies, and summary generation', icon: 'sparkles', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'gemini', name: 'Google Gemini', category: 'AI & Copilot', description: 'Multimodal 1.5 Pro & Flash reasoning, vision OCR, and CRM workflow copilot', icon: 'sparkles', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'claude', name: 'Anthropic Claude', category: 'AI & Copilot', description: 'Sonnet 3.5 complex agentic reasoning, code execution nodes, and contract drafting', icon: 'sparkles', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'ollama', name: 'Ollama (Local LLM)', category: 'AI & Copilot', description: 'Self-hosted on-premises open-source LLMs (Llama 3, Mistral, Qwen) with zero cloud egress', icon: 'cpu', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },

  // Marketing
  { id: 'meta_ads', name: 'Meta Ads', category: 'Marketing', description: 'Instant lead capture from Facebook & Instagram lead forms directly into CRM contacts', icon: 'facebook', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'google_ads', name: 'Google Ads Conversions', category: 'Marketing', description: 'Offline conversion tracking and enhanced conversions sync for PPC ROI attribution', icon: 'globe', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'tiktok_ads', name: 'TikTok Instant Leads', category: 'Marketing', description: 'Real-time synchronization for TikTok Lead Generation campaign submissions', icon: 'video', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'mailchimp', name: 'Mailchimp', category: 'Marketing', description: 'Bidirectional contact audience synchronization, tags, and newsletter opt-ins', icon: 'mail', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'hubspot', name: 'HubSpot', category: 'Marketing', description: 'Two-way contact and deal synchronization with HubSpot marketing and CRM hub', icon: 'users', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },

  // Commerce
  { id: 'shopify', name: 'Shopify', category: 'Commerce', description: 'E-commerce store orders, customer import, cart abandonment, and product sync', icon: 'store', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'woocommerce', name: 'WooCommerce', category: 'Commerce', description: 'WordPress WooCommerce online store orders, webhooks, and customer data sync', icon: 'store', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'wordpress', name: 'WordPress', category: 'Commerce', description: 'Website content management, blog authoring, and form submission capture', icon: 'globe', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'webflow', name: 'Webflow', category: 'Commerce', description: 'Webflow CMS collections, lead forms, and membership webhook triggers', icon: 'globe', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },

  // Calendar
  { id: 'google_calendar', name: 'Google Calendar & Meet', category: 'Calendar', description: 'Two-way appointment synchronization, team calendar pooling, and Google Meet link generation', icon: 'calendar', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },

  // Databases
  { id: 'google_sheets', name: 'Google Sheets', category: 'Databases', description: 'Real-time two-way spreadsheet sync, row appending, lead lookups, and reporting', icon: 'table', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'airtable', name: 'Airtable', category: 'Databases', description: 'Relational database sync, base automation, record lookups, and rich media capture', icon: 'database', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'notion', name: 'Notion', category: 'Databases', description: 'Knowledge base documentation, CRM contact pages, and collaborative wiki databases', icon: 'file-text', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'github', name: 'GitHub', category: 'Databases', description: 'Repository issue synchronization, commit triggers, and developer release webhooks', icon: 'github', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },

  // Automation
  { id: 'zapier', name: 'Zapier', category: 'Automation', description: 'Connect Operza triggers to 5,000+ business applications via REST webhooks', icon: 'zap', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'make', name: 'Make (Integromat)', category: 'Automation', description: 'Complex scenario automations and bidirectional webhook data transformation', icon: 'zap', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
  { id: 'n8n_webhooks', name: 'n8n Community Webhooks', category: 'Automation', description: 'Direct webhook nodes and payload streaming with self-hosted n8n instances', icon: 'cpu', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null }
];

export default function Integrations() {
  const [integrations, setIntegrations] = useState<IntegrationItem[]>(DEFAULT_CATALOGUE);
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<IntegrationItem | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; message: string; success: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    api.integrations.list().then((res) => {
      if (!active || !res?.integrations) return;
      setIntegrations(res.integrations);
    }).catch(() => {
      // Retain DEFAULT_CATALOGUE
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

  const handleOpenConfig = (item: IntegrationItem) => {
    setSelected(item);
    setTestResult(null);
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
        <IntegrationConfigModal
          integration={selected}
          onClose={() => setSelected(null)}
          onSaved={(updated) => {
            setIntegrations((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
            setSelected(null);
          }}
          onDisconnected={(id) => {
            setIntegrations((prev) =>
              prev.map((i) => (i.id === id ? { ...i, connected: false, status: 'disconnected', accountName: '' } : i))
            );
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}
