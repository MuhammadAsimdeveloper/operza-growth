import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, PageHeader, StatCard, StatusBadge } from '../components/ui';
import { api } from '../lib/api';

interface ApiKey {
  id: string;
  label: string;
  maskedKey: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string | null;
}

interface WebhookSub {
  id: string;
  url: string;
  events: string[];
  secret: string;
  status: string;
  createdAt: string;
}

interface WebhookDelivery {
  id: string;
  webhookId: string;
  url: string;
  event: string;
  status: number;
  durationMs: number;
  payload: any;
  at: string;
}

const AVAILABLE_SCOPES = [
  'contacts:read',
  'contacts:write',
  'opportunities:manage',
  'workflows:trigger',
  'invoices:manage',
  'forms:read',
];

const AVAILABLE_EVENTS = [
  'contact.created',
  'opportunity.stage_changed',
  'form.submitted',
  'payment.completed',
  'workflow.finished',
  'appointment.booked',
];

export default function Developers() {
  const [activeTab, setActiveTab] = useState<'keys' | 'webhooks' | 'logs'>('keys');
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookSub[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);

  // Key creation state
  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const [keyLabel, setKeyLabel] = useState('');
  const [keyScopes, setKeyScopes] = useState<string[]>(['contacts:read', 'contacts:write', 'workflows:trigger']);
  const [createdSecretToken, setCreatedSecretToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  // Webhook creation state
  const [newWebhookOpen, setNewWebhookOpen] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEvents, setWebhookEvents] = useState<string[]>(['contact.created', 'opportunity.stage_changed']);
  const [selectedPayload, setSelectedPayload] = useState<any | null>(null);

  // Ping test feedback
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.developers.getKeys(),
      api.developers.getWebhooks(),
      api.developers.getDeliveries(),
    ])
      .then(([kRes, wRes, dRes]) => {
        if (!active) return;
        if (kRes?.keys) setKeys(kRes.keys);
        if (wRes?.webhooks) setWebhooks(wRes.webhooks);
        if (dRes?.deliveries) setDeliveries(dRes.deliveries);
      })
      .catch(() => {
        setKeys([
          {
            id: 'key_live_01',
            label: 'Zapier Production Bridge',
            maskedKey: 'op_live_3821...9f82',
            scopes: ['contacts:read', 'contacts:write', 'workflows:trigger'],
            createdAt: new Date().toISOString(),
          },
        ]);
        setWebhooks([
          {
            id: 'wh_01',
            url: 'https://hooks.zapier.com/hooks/catch/19828/operza',
            events: ['contact.created', 'form.submitted'],
            secret: 'whsec_98f8219482810a01948194',
            status: 'active',
            createdAt: new Date().toISOString(),
          },
        ]);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleCreateKey = async () => {
    if (!keyLabel.trim()) return;
    try {
      const res = await api.developers.createKey({
        label: keyLabel.trim(),
        scopes: keyScopes,
      });
      if (res?.key) {
        setKeys((prev) => [res.key, ...prev]);
        setCreatedSecretToken(res.key.secretToken);
      }
    } catch (err) {
      console.error('Failed to generate API key:', err);
    }
  };

  const handleRevokeKey = async (id: string) => {
    try {
      await api.developers.revokeKey(id);
      setKeys((prev) => prev.filter((k) => k.id !== id));
    } catch (err) {
      console.error('Failed to revoke API key:', err);
    }
  };

  const handleCreateWebhook = async () => {
    if (!webhookUrl.trim() || !webhookUrl.startsWith('http')) return;
    try {
      const res = await api.developers.createWebhook({
        url: webhookUrl.trim(),
        events: webhookEvents,
      });
      if (res?.webhook) {
        setWebhooks((prev) => [res.webhook, ...prev]);
        setNewWebhookOpen(false);
        setWebhookUrl('');
      }
    } catch (err) {
      console.error('Failed to register webhook endpoint:', err);
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    try {
      await api.developers.deleteWebhook(id);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
    } catch (err) {
      console.error('Failed to delete webhook endpoint:', err);
    }
  };

  const handleTestWebhook = async (id: string) => {
    setTestingWebhookId(id);
    try {
      const res = await api.developers.testWebhook(id);
      if (res?.delivery) {
        setDeliveries((prev) => [res.delivery, ...prev]);
      }
    } catch (err) {
      console.error('Failed to test webhook ping:', err);
    } finally {
      setTestingWebhookId(null);
    }
  };

  return (
    <div className="content">
      <PageHeader
        title="Developer Hub & Webhooks"
        subtitle="Manage API keys, register real-time outbound webhooks, and inspect delivery logs."
        actions={
          activeTab === 'keys' ? (
            <button className="btn btn--primary" onClick={() => { setNewKeyOpen(true); setCreatedSecretToken(null); setKeyLabel(''); }}>
              <Icon name="plus" size={15} /> Generate API key
            </button>
          ) : (
            <button className="btn btn--primary" onClick={() => setNewWebhookOpen(true)}>
              <Icon name="plus" size={15} /> Add webhook endpoint
            </button>
          )
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="API Keys" value={String(keys.length)} icon={<Icon name="lock" size={15} />} meta="active credentials" />
        <StatCard label="Webhooks" value={String(webhooks.length)} icon={<Icon name="webhook" size={15} />} meta="subscribed endpoints" />
        <StatCard label="Total Deliveries" value={String(deliveries.length)} icon={<Icon name="send" size={15} />} meta="dispatched events" />
        <StatCard label="Success Rate" value="99.8%" icon={<Icon name="check" size={15} />} meta="HTTP 200 delivery" />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <div className="segmented">
            <button
              type="button"
              className={activeTab === 'keys' ? 'is-active' : ''}
              onClick={() => setActiveTab('keys')}
            >
              <Icon name="lock" size={14} /> API Keys ({keys.length})
            </button>
            <button
              type="button"
              className={activeTab === 'webhooks' ? 'is-active' : ''}
              onClick={() => setActiveTab('webhooks')}
            >
              <Icon name="webhook" size={14} /> Webhook Subscriptions ({webhooks.length})
            </button>
            <button
              type="button"
              className={activeTab === 'logs' ? 'is-active' : ''}
              onClick={() => setActiveTab('logs')}
            >
              <Icon name="clipboard" size={14} /> Delivery Logs ({deliveries.length})
            </button>
          </div>
        </div>

        {activeTab === 'keys' && (
          <div style={{ padding: '0 16px 16px' }}>
            {keys.length === 0 ? (
              <EmptyState
                icon={<Icon name="lock" size={24} />}
                title="No API keys provisioned"
                text="Create an API key to securely query contacts, trigger workflows, or build custom integrations."
                action={
                  <button className="btn btn--primary btn--sm" onClick={() => setNewKeyOpen(true)}>
                    Generate first API key
                  </button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Key Label</th>
                      <th>Token Preview</th>
                      <th>Scopes</th>
                      <th>Created</th>
                      <th style={{ width: 80 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => (
                      <tr key={k.id}>
                        <td className="cell-main">{k.label}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{k.maskedKey}</td>
                        <td>
                          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                            {k.scopes.map((s) => (
                              <Badge key={s} tone="default">
                                {s}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="cell-sub">{new Date(k.createdAt).toLocaleDateString()}</td>
                        <td>
                          <button
                            type="button"
                            className="icon-btn"
                            title={`Revoke ${k.label}`}
                            onClick={() => handleRevokeKey(k.id)}
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'webhooks' && (
          <div style={{ padding: '0 16px 16px' }}>
            {webhooks.length === 0 ? (
              <EmptyState
                icon={<Icon name="webhook" size={24} />}
                title="No outbound webhooks"
                text="Subscribe an external URL to receive real-time JSON payloads when leads convert or appointments book."
                action={
                  <button className="btn btn--primary btn--sm" onClick={() => setNewWebhookOpen(true)}>
                    Register webhook URL
                  </button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Endpoint URL</th>
                      <th>Subscribed Events</th>
                      <th>Status</th>
                      <th>Secret</th>
                      <th style={{ width: 130 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhooks.map((w) => (
                      <tr key={w.id}>
                        <td className="cell-main" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                          {w.url}
                        </td>
                        <td>
                          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                            {w.events.map((e) => (
                              <Badge key={e} tone="blue">
                                {e}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td>
                          <StatusBadge status={w.status} />
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
                          {w.secret.slice(0, 10)}...
                        </td>
                        <td>
                          <div className="row" style={{ gap: 4 }}>
                            <button
                              type="button"
                              className="btn btn--sm"
                              onClick={() => handleTestWebhook(w.id)}
                              disabled={testingWebhookId === w.id}
                            >
                              <Icon name="send" size={12} /> {testingWebhookId === w.id ? 'Sending...' : 'Test'}
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              title="Delete webhook"
                              onClick={() => handleDeleteWebhook(w.id)}
                            >
                              <Icon name="trash" size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'logs' && (
          <div style={{ padding: '0 16px 16px' }}>
            {deliveries.length === 0 ? (
              <EmptyState
                icon={<Icon name="clipboard" size={24} />}
                title="No deliveries recorded yet"
                text="Webhook payloads dispatched from your workspace will appear here with execution timestamps."
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Event</th>
                      <th>Destination URL</th>
                      <th>Status</th>
                      <th>Latency</th>
                      <th style={{ width: 80 }}>Payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.map((d) => (
                      <tr key={d.id}>
                        <td className="cell-sub">{new Date(d.at).toLocaleTimeString()}</td>
                        <td className="cell-main">
                          <Badge tone="violet">{d.event}</Badge>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{d.url}</td>
                        <td>
                          <Badge tone={d.status === 200 ? 'green' : 'red'}>{d.status} OK</Badge>
                        </td>
                        <td className="cell-num">{d.durationMs}ms</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn--sm"
                            onClick={() => setSelectedPayload(d.payload)}
                          >
                            <Icon name="eye" size={12} /> View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Generate API Key Modal */}
      {newKeyOpen && (
        <Modal
          title={createdSecretToken ? 'API Key Generated' : 'Generate New API Key'}
          onClose={() => setNewKeyOpen(false)}
          footer={
            createdSecretToken ? (
              <button className="btn btn--primary" onClick={() => setNewKeyOpen(false)}>
                Done
              </button>
            ) : (
              <>
                <button className="btn" onClick={() => setNewKeyOpen(false)}>
                  Cancel
                </button>
                <button className="btn btn--primary" onClick={handleCreateKey} disabled={!keyLabel.trim()}>
                  Create API key
                </button>
              </>
            )
          }
        >
          {createdSecretToken ? (
            <div className="stack" style={{ gap: 12 }}>
              <div
                style={{
                  background: 'var(--amber-soft)',
                  color: 'var(--amber)',
                  padding: '10px 14px',
                  borderRadius: 'var(--r-md)',
                  fontSize: 12.5,
                  lineHeight: 1.5,
                }}
              >
                ⚠️ <strong>Copy this secret key now.</strong> For security reasons, you will not be able to view this token again after closing this dialog.
              </div>

              <div className="field">
                <label>Live Secret API Token</label>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="input"
                    readOnly
                    value={createdSecretToken}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
                  />
                  <button
                    className="btn"
                    onClick={() => {
                      navigator.clipboard.writeText(createdSecretToken);
                      setCopiedToken(true);
                      setTimeout(() => setCopiedToken(false), 2000);
                    }}
                  >
                    <Icon name="copy" size={14} /> {copiedToken ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              <div className="field">
                <label htmlFor="key-lbl">Key Name / Description</label>
                <input
                  id="key-lbl"
                  className="input"
                  autoFocus
                  placeholder="e.g. Mobile App Backend SDK"
                  value={keyLabel}
                  onChange={(e) => setKeyLabel(e.target.value)}
                />
              </div>

              <div className="field">
                <label>Permission Scopes</label>
                <div className="grid grid--2" style={{ gap: 8, marginTop: 4 }}>
                  {AVAILABLE_SCOPES.map((scope) => {
                    const checked = keyScopes.includes(scope);
                    return (
                      <label
                        key={scope}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 12.5,
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            if (checked) {
                              setKeyScopes(keyScopes.filter((s) => s !== scope));
                            } else {
                              setKeyScopes([...keyScopes, scope]);
                            }
                          }}
                        />
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{scope}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Add Webhook Modal */}
      {newWebhookOpen && (
        <Modal
          title="Register Outbound Webhook"
          onClose={() => setNewWebhookOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setNewWebhookOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={handleCreateWebhook}
                disabled={!webhookUrl.trim() || !webhookUrl.startsWith('http')}
              >
                Register endpoint
              </button>
            </>
          }
        >
          <div className="stack" style={{ gap: 12 }}>
            <div className="field">
              <label htmlFor="wh-url">Target Endpoint URL</label>
              <input
                id="wh-url"
                className="input"
                autoFocus
                placeholder="https://your-service.com/api/webhooks/operza"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>

            <div className="field">
              <label>Event Triggers</label>
              <div className="grid grid--2" style={{ gap: 8, marginTop: 4 }}>
                {AVAILABLE_EVENTS.map((event) => {
                  const checked = webhookEvents.includes(event);
                  return (
                    <label
                      key={event}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 12.5,
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          if (checked) {
                            setWebhookEvents(webhookEvents.filter((e) => e !== event));
                          } else {
                            setWebhookEvents([...webhookEvents, event]);
                          }
                        }}
                      />
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{event}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Payload Inspection Modal */}
      {selectedPayload && (
        <Modal
          title="Webhook Payload Inspector"
          wide
          onClose={() => setSelectedPayload(null)}
          footer={
            <button className="btn btn--primary" onClick={() => setSelectedPayload(null)}>
              Close
            </button>
          }
        >
          <pre
            style={{
              background: 'var(--surface-3)',
              padding: '12px 14px',
              borderRadius: 'var(--r-md)',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              overflowX: 'auto',
              maxHeight: '350px',
            }}
          >
            {JSON.stringify(selectedPayload, null, 2)}
          </pre>
        </Modal>
      )}
    </div>
  );
}
