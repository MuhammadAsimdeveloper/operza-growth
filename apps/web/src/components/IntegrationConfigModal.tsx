import { useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { api } from '../lib/api';

export interface IntegrationItem {
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

interface IntegrationConfigModalProps {
  integration: IntegrationItem;
  onClose: () => void;
  onSaved: (updated: IntegrationItem) => void;
  onDisconnected?: (id: string) => void;
}

export function IntegrationConfigModal({
  integration,
  onClose,
  onSaved,
  onDisconnected,
}: IntegrationConfigModalProps) {
  const [accountName, setAccountName] = useState(integration.accountName || '');
  const [apiKey, setApiKey] = useState('');
  const [publishableKey, setPublishableKey] = useState(integration.config?.publishableKey || '');
  const [webhookUrl, setWebhookUrl] = useState(integration.config?.webhookUrl || '');
  const [phoneNumber, setPhoneNumber] = useState(integration.config?.phoneNumber || '');
  const [channel, setChannel] = useState(integration.config?.channel || '');
  const [model, setModel] = useState(integration.config?.model || '');

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latencyMs?: number } | null>(null);
  const [error, setError] = useState('');

  const id = integration.id;

  const handleTestPing = async () => {
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const res = await api.integrations.test(id);
      setTestResult({
        success: true,
        message: res.message || `${integration.name} connection healthy.`,
        latencyMs: res.latencyMs || 28,
      });
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Could not verify connection endpoint.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await api.integrations.connect(id, {
        accountName: accountName.trim() || `${integration.name} Account`,
        apiKey: apiKey.trim() || undefined,
        publishableKey: publishableKey.trim() || undefined,
        webhookUrl: webhookUrl.trim() || undefined,
        phoneNumber: phoneNumber.trim() || undefined,
        channel: channel.trim() || undefined,
        model: model.trim() || undefined,
      });

      if (res?.integration) {
        onSaved(res.integration);
      } else {
        onSaved({
          ...integration,
          connected: true,
          status: 'connected',
          accountName: accountName.trim() || `${integration.name} Account`,
          lastSyncAt: new Date().toISOString(),
          config: {
            hasApiKey: Boolean(apiKey),
            publishableKey: publishableKey ? `${publishableKey.slice(0, 8)}...` : undefined,
            webhookUrl,
            phoneNumber,
            channel,
            model,
          },
        });
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save integration settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm(`Are you sure you want to disconnect ${integration.name}?`)) return;
    setDisconnecting(true);
    setError('');
    try {
      await api.integrations.disconnect(id);
      if (onDisconnected) onDisconnected(id);
      onSaved({
        ...integration,
        connected: false,
        status: 'disconnected',
        accountName: '',
        config: null,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to disconnect integration.');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Modal
      title={`Configure ${integration.name}`}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div>
            {integration.connected && (
              <button
                type="button"
                className="btn btn--subtle"
                style={{ color: 'var(--red)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                onClick={handleDisconnect}
                disabled={disconnecting || saving}
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn" type="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn--primary" type="button" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save & Activate'}
            </button>
          </div>
        </div>
      }
    >
      <form onSubmit={handleSave} className="stack" style={{ gap: 14 }}>
        {/* Service Header Info */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 14px',
            background: 'var(--surface-2)',
            borderRadius: 'var(--r-md)',
            border: '1px solid var(--line)',
          }}
        >
          <div
            className="avatar avatar--md avatar--square"
            style={{
              background: integration.connected ? 'var(--green-soft)' : 'var(--surface-3)',
              color: integration.connected ? 'var(--green)' : 'var(--text-3)',
            }}
          >
            <Icon name={integration.icon || 'plug'} size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 14 }}>{integration.name}</strong>
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontWeight: 600,
                  backgroundColor: integration.connected ? 'var(--green-soft)' : 'var(--surface-3)',
                  color: integration.connected ? 'var(--green)' : 'var(--text-3)',
                }}
              >
                {integration.connected ? '● Active' : '○ Not configured'}
              </span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '2px 0 0' }}>
              {integration.description}
            </p>
          </div>
        </div>

        {error && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--r-md)',
              background: 'var(--red-soft)',
              color: 'var(--red)',
              fontSize: 12.5,
              fontWeight: 550,
            }}
          >
            {error}
          </div>
        )}

        {/* Account Identifier */}
        <div className="field">
          <label htmlFor="cfg-acc-label">Workspace Account Label</label>
          <input
            id="cfg-acc-label"
            className="input"
            placeholder={`e.g. My Agency ${integration.name} Account`}
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
          />
          <span className="hint">Name this connection so team members recognize it in workflows.</span>
        </div>

        {/* Dynamic Service-Specific Fields */}
        {id === 'stripe' && (
          <>
            <div className="field">
              <label htmlFor="cfg-stripe-pk">Publishable Key</label>
              <input
                id="cfg-stripe-pk"
                className="input"
                style={{ fontFamily: 'var(--font-mono)' }}
                placeholder="pk_live_... or pk_test_..."
                value={publishableKey}
                onChange={(e) => setPublishableKey(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="cfg-stripe-sk">Secret Key</label>
              <input
                id="cfg-stripe-sk"
                type="password"
                className="input"
                style={{ fontFamily: 'var(--font-mono)' }}
                placeholder={integration.connected ? '••••••••••••••••••••' : 'sk_live_... or sk_test_...'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <span className="hint">Encrypted using AES-256 in PostgreSQL agency store.</span>
            </div>
            <div className="field">
              <label htmlFor="cfg-stripe-wh">Webhook Signing Secret</label>
              <input
                id="cfg-stripe-wh"
                className="input"
                style={{ fontFamily: 'var(--font-mono)' }}
                placeholder="whsec_..."
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            </div>
          </>
        )}

        {id === 'twilio' && (
          <>
            <div className="field">
              <label htmlFor="cfg-tw-sid">Account SID</label>
              <input
                id="cfg-tw-sid"
                className="input"
                style={{ fontFamily: 'var(--font-mono)' }}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={publishableKey}
                onChange={(e) => setPublishableKey(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="cfg-tw-tok">Auth Token</label>
              <input
                id="cfg-tw-tok"
                type="password"
                className="input"
                style={{ fontFamily: 'var(--font-mono)' }}
                placeholder={integration.connected ? '••••••••••••••••••••' : 'Twilio Auth Token'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="cfg-tw-phone">Verified Sender Phone Number (E.164)</label>
              <input
                id="cfg-tw-phone"
                className="input"
                placeholder="+1 (800) 555-0199"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
            </div>
          </>
        )}

        {id === 'sendgrid' && (
          <>
            <div className="field">
              <label htmlFor="cfg-sg-key">SendGrid API Key</label>
              <input
                id="cfg-sg-key"
                type="password"
                className="input"
                style={{ fontFamily: 'var(--font-mono)' }}
                placeholder={integration.connected ? '••••••••••••••••••••' : 'SG.xxxxxxxxxxxxxxxxxxxx'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="cfg-sg-from">Verified Sender Email</label>
              <input
                id="cfg-sg-from"
                className="input"
                placeholder="notifications@youragency.com"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
            </div>
          </>
        )}

        {(id === 'openai' || id === 'anthropic' || id === 'gemini') && (
          <>
            <div className="field">
              <label htmlFor="cfg-ai-key">API Secret Key</label>
              <input
                id="cfg-ai-key"
                type="password"
                className="input"
                style={{ fontFamily: 'var(--font-mono)' }}
                placeholder={integration.connected ? '••••••••••••••••••••' : 'Enter API Key'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="cfg-ai-model">Default LLM Model</label>
              <input
                id="cfg-ai-model"
                className="input"
                placeholder={id === 'openai' ? 'gpt-4o-mini' : id === 'anthropic' ? 'claude-3-5-sonnet' : 'gemini-2.0-flash'}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
              <span className="hint">Used across Operza Copilot, AI Agent Nodes, and smart summarization.</span>
            </div>
          </>
        )}

        {id === 'ollama' && (
          <>
            <div className="field">
              <label htmlFor="cfg-ollama-url">Ollama Host URL</label>
              <input
                id="cfg-ollama-url"
                className="input"
                style={{ fontFamily: 'var(--font-mono)' }}
                placeholder="http://localhost:11434"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="cfg-ollama-model">Ollama Model</label>
              <input
                id="cfg-ollama-model"
                className="input"
                placeholder="llama3 or mistral"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
          </>
        )}

        {(id === 'slack' || id === 'discord') && (
          <>
            <div className="field">
              <label htmlFor="cfg-chat-wh">Incoming Webhook URL</label>
              <input
                id="cfg-chat-wh"
                className="input"
                style={{ fontFamily: 'var(--font-mono)' }}
                placeholder={id === 'slack' ? 'https://hooks.slack.com/services/...' : 'https://discord.com/api/webhooks/...'}
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="cfg-chat-chan">Default Alert Channel</label>
              <input
                id="cfg-chat-chan"
                className="input"
                placeholder="#leads-and-sales"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              />
            </div>
          </>
        )}

        {/* General Fallback Fields */}
        {!['stripe', 'twilio', 'sendgrid', 'openai', 'anthropic', 'gemini', 'ollama', 'slack', 'discord'].includes(id) && (
          <>
            <div className="field">
              <label htmlFor="cfg-gen-key">API Key or Access Token</label>
              <input
                id="cfg-gen-key"
                type="password"
                className="input"
                style={{ fontFamily: 'var(--font-mono)' }}
                placeholder={integration.connected ? '••••••••••••••••••••' : 'Enter API Token or Secret'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="cfg-gen-wh">Webhook Inbound / Sync Endpoint (Optional)</label>
              <input
                id="cfg-gen-wh"
                className="input"
                style={{ fontFamily: 'var(--font-mono)' }}
                placeholder={`https://operza.io/api/webhooks/${id}`}
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            </div>
          </>
        )}

        {/* Test Connection & Health Check Section */}
        <div
          style={{
            padding: '12px 14px',
            background: 'var(--surface-3)',
            borderRadius: 'var(--r-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Connection Verification</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
              Test endpoint reachability and verify response handshake.
            </div>
          </div>
          <button
            type="button"
            className="btn btn--sm"
            onClick={handleTestPing}
            disabled={testing}
          >
            <Icon name="refresh" size={13} /> {testing ? 'Testing…' : 'Test Ping'}
          </button>
        </div>

        {testResult && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--r-sm)',
              fontSize: 12,
              fontWeight: 550,
              background: testResult.success ? 'var(--green-soft)' : 'var(--red-soft)',
              color: testResult.success ? 'var(--green)' : 'var(--red)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span>{testResult.success ? '✅' : '❌'}</span>
            <span>{testResult.message}</span>
          </div>
        )}
      </form>
    </Modal>
  );
}
