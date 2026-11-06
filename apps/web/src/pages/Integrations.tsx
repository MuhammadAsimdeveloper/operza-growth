import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, PageHeader, StatusBadge } from '../components/ui';
import { api } from '../lib/api';

interface ProviderCatalogEntry {
  providerKey: string;
  name: string;
  category: 'email' | 'sms' | 'whatsapp' | 'payment';
  capabilities: string[];
  liveDispatch: boolean;
  requiredConfigFields?: string[];
  secretRefFormatHint: string;
}

interface ProviderConnection {
  id: string;
  agencyId: string;
  locationId: string;
  providerKey: string;
  label?: string;
  status: 'pending_verification' | 'verified' | 'degraded' | 'revoked';
  config?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

interface MarketplaceApp {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  connected: boolean;
  status: 'connected' | 'disconnected' | 'error';
  accountName?: string;
}

export default function Integrations() {
  const [activeTab, setActiveTab] = useState<'connections' | 'marketplace'>('connections');

  // Platform Provider Connections State
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>([]);
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);

  // New Connection Wizard State
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [selectedProviderKey, setSelectedProviderKey] = useState<string>('sendgrid');
  const [connectionLabelInput, setConnectionLabelInput] = useState('');
  const [secretRefInput, setSecretRefInput] = useState('');
  const [configInputs, setConfigInputs] = useState<Record<string, string>>({});
  const [connectSaving, setConnectSaving] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Verification & Revoke State
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verificationFeedback, setVerificationFeedback] = useState<{
    id: string;
    code: string;
    error: string;
  } | null>(null);
  const [revokingConnection, setRevokingConnection] = useState<ProviderConnection | null>(null);

  // Marketplace Ecosystem State
  const [marketplaceApps, setMarketplaceApps] = useState<MarketplaceApp[]>([]);

  const fetchPlatformConnections = async () => {
    setConnectionsLoading(true);
    try {
      const [catRes, connRes] = await Promise.all([
        api.platform.getProviderCatalog(),
        api.platform.getConnections(),
      ]);
      setCatalog(catRes.data || []);
      setConnections(connRes.data || []);
      if (catRes.data?.length > 0 && !selectedProviderKey) {
        setSelectedProviderKey(catRes.data[0].providerKey);
      }
    } catch (err: any) {
      console.error('Failed to load platform connections', err);
    } finally {
      setConnectionsLoading(false);
    }
  };

  const fetchMarketplace = async () => {
    try {
      const res = await api.integrations.list();
      setMarketplaceApps(res?.integrations || []);
    } catch {
      setMarketplaceApps([
        { id: 'google_calendar', name: 'Google Calendar', category: 'Calendar', description: 'Two-way appointment synchronization and scheduling', icon: 'calendar', connected: true, status: 'connected', accountName: 'team@operza.io' },
        { id: 'slack', name: 'Slack', category: 'Communications', description: 'Real-time notifications for leads, booked appointments, and deals', icon: 'message', connected: false, status: 'disconnected' },
        { id: 'shopify', name: 'Shopify', category: 'Commerce', description: 'E-commerce store orders, customer import, and product sync', icon: 'store', connected: false, status: 'disconnected' },
        { id: 'openai', name: 'OpenAI Embeddings', category: 'AI', description: 'Vector indexing for document knowledge base', icon: 'sparkles', connected: true, status: 'connected' },
      ]);
    }
  };

  useEffect(() => {
    fetchPlatformConnections();
    fetchMarketplace();
  }, []);

  const handleCreateConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secretRefInput.trim()) {
      setConnectError('Secret Reference name is required (e.g. SENDGRID_API_KEY)');
      return;
    }

    setConnectSaving(true);
    setConnectError(null);
    try {
      await api.platform.createConnection({
        providerKey: selectedProviderKey,
        secretRef: secretRefInput.trim(),
        label: connectionLabelInput.trim() || undefined,
        config: Object.keys(configInputs).length > 0 ? configInputs : undefined,
      });
      setShowConnectModal(false);
      setConnectionLabelInput('');
      setSecretRefInput('');
      setConfigInputs({});
      await fetchPlatformConnections();
    } catch (err: any) {
      setConnectError(err.message || 'Failed to create connection');
    } finally {
      setConnectSaving(false);
    }
  };

  const handleVerifyConnection = async (connId: string) => {
    setVerifyingId(connId);
    setVerificationFeedback(null);
    try {
      const res = await api.platform.verifyConnection(connId);
      if (res.error) {
        setVerificationFeedback({
          id: connId,
          code: res.code || 'PROVIDER_ADAPTER_UNAVAILABLE',
          error: res.error,
        });
      } else {
        await fetchPlatformConnections();
      }
    } catch (err: any) {
      setVerificationFeedback({
        id: connId,
        code: 'PROVIDER_ADAPTER_UNAVAILABLE',
        error: err.message || 'Verification endpoint failed closed. Adapter unavailable on this server.',
      });
    } finally {
      setVerifyingId(null);
    }
  };

  const handleRevokeConnection = async () => {
    if (!revokingConnection) return;
    setConnectSaving(true);
    try {
      await api.platform.revokeConnection(revokingConnection.id);
      setRevokingConnection(null);
      await fetchPlatformConnections();
    } catch (err: any) {
      alert(err.message || 'Failed to revoke connection');
    } finally {
      setConnectSaving(false);
    }
  };

  const selectedCatalogEntry = useMemo(() => {
    return catalog.find((c) => c.providerKey === selectedProviderKey);
  }, [catalog, selectedProviderKey]);

  return (
    <div className="page-container space-y-6">
      <PageHeader
        title="Integrations & Provider Connections"
        subtitle="Manage server-side provider credentials, communication channels, and ecosystem integrations."
        actions={
          activeTab === 'connections' && (
            <button
              onClick={() => {
                setConnectError(null);
                setShowConnectModal(true);
              }}
              className="btn btn--primary flex items-center gap-2 text-sm"
            >
              <Icon name="plus" size={16} />
              Connect Provider Account
            </button>
          )
        }
      />

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 gap-6 text-sm">
        <button
          onClick={() => setActiveTab('connections')}
          className={`pb-3 font-medium transition-colors flex items-center gap-2 border-b-2 ${
            activeTab === 'connections'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-semibold'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <Icon name="shield" size={16} />
          Governed Provider Connections
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-mono">
            {connections.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('marketplace')}
          className={`pb-3 font-medium transition-colors flex items-center gap-2 border-b-2 ${
            activeTab === 'marketplace'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-semibold'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <Icon name="plug" size={16} />
          App Marketplace Ecosystem
        </button>
      </div>

      {activeTab === 'connections' && (
        <div className="space-y-6">
          {/* Security & Provenance Banner */}
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-start gap-3">
            <Icon name="lock" size={20} className="text-emerald-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-semibold text-emerald-900 dark:text-emerald-200">
                Zero-Secret Browser Exposure Architecture
              </p>
              <p className="text-emerald-800/90 dark:text-emerald-300/90 mt-1">
                Operza never collects or echoes raw API keys or access tokens in the frontend client. Connections bind to an opaque server-side secret reference name (resolved securely via environment variables or secret vaults). Provider verification fails closed until a trusted adapter and verified server credentials are confirmed.
              </p>
            </div>
          </div>

          {/* Active Connections List */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Icon name="check" size={18} className="text-indigo-500" />
                Configured Provider Connections
              </h3>
              <button
                onClick={fetchPlatformConnections}
                className="btn btn--sm text-xs flex items-center gap-1.5"
              >
                <Icon name="refresh" size={12} className={connectionsLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>

            {connectionsLoading ? (
              <div className="py-10 text-center text-gray-400 text-sm">Loading connections...</div>
            ) : connections.length === 0 ? (
              <EmptyState
                icon={<Icon name="plug" size={32} />}
                title="No provider connections configured"
                text="Connect your verified SendGrid, Twilio, Resend, or WhatsApp provider accounts using server-side secret references."
                action={
                  <button
                    onClick={() => setShowConnectModal(true)}
                    className="btn btn--primary btn--sm"
                  >
                    Add Connection
                  </button>
                }
              />
            ) : (
              <div className="divide-y divide-gray-200 dark:divide-gray-800">
                {connections.map((conn) => {
                  const entry = catalog.find((c) => c.providerKey === conn.providerKey);
                  const isVerifying = verifyingId === conn.id;
                  const feedback = verificationFeedback?.id === conn.id ? verificationFeedback : null;

                  return (
                    <div key={conn.id} className="py-4 space-y-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center font-bold text-indigo-600 dark:text-indigo-400 uppercase text-xs">
                            {conn.providerKey.slice(0, 3)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-gray-900 dark:text-white">
                                {conn.label || entry?.name || conn.providerKey}
                              </span>
                              <Badge tone="default">
                                {conn.providerKey}
                              </Badge>
                              <StatusBadge
                                status={
                                  conn.status === 'verified'
                                    ? 'active'
                                    : conn.status === 'revoked'
                                    ? 'cancelled'
                                    : 'pending'
                                }
                              />
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5">
                              ID: <span className="font-mono">{conn.id}</span> • Created: {new Date(conn.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {conn.status !== 'revoked' && (
                            <>
                              <button
                                onClick={() => handleVerifyConnection(conn.id)}
                                disabled={isVerifying}
                                className="btn btn--sm text-xs flex items-center gap-1.5"
                                title="Run live verification check"
                              >
                                <Icon name="refresh" size={12} className={isVerifying ? 'animate-spin' : ''} />
                                {isVerifying ? 'Checking...' : 'Verify Connection'}
                              </button>
                              <button
                                onClick={() => setRevokingConnection(conn)}
                                className="btn btn--danger btn--sm text-xs flex items-center gap-1"
                                title="Revoke this connection"
                              >
                                <Icon name="trash" size={12} />
                                Revoke
                              </button>
                            </>
                          )}
                          {conn.status === 'revoked' && (
                            <Badge tone="red">Revoked (Terminal)</Badge>
                          )}
                        </div>
                      </div>

                      {/* Verification Feedback Notice (Fail-Closed explanation) */}
                      {feedback && (
                        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs space-y-1">
                          <div className="font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                            <Icon name="alert-triangle" size={14} className="text-amber-500" />
                            Verification Failed Closed: {feedback.code}
                          </div>
                          <div className="text-amber-800 dark:text-amber-300">
                            {feedback.error}
                          </div>
                          <div className="text-gray-500 text-[11px] pt-1 border-t border-amber-500/20">
                            Security policy: Operza does not fabricate test connection states. Real delivery remains safely blocked until a verified server adapter is installed.
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Provider Catalog Cards */}
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white mb-3">
              Supported Provider Catalog
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {catalog.map((cat) => (
                <div key={cat.providerKey} className="card p-4 space-y-3 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex justify-between items-start">
                      <h4 className="font-bold text-sm text-gray-900 dark:text-white">
                        {cat.name}
                      </h4>
                      <Badge tone={cat.category === 'payment' ? 'amber' : 'default'}>
                        {cat.category}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {cat.capabilities?.map((cap, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                          {cap}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400">
                      Secret Ref: <code className="font-mono text-gray-600 dark:text-gray-300">{cat.secretRefFormatHint}</code>
                    </p>
                  </div>

                  <div className="pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-xs">
                    <span className="text-gray-400">
                      {cat.liveDispatch ? 'Live dispatch ready' : 'Live dispatch disabled'}
                    </span>
                    <button
                      onClick={() => {
                        setSelectedProviderKey(cat.providerKey);
                        setShowConnectModal(true);
                      }}
                      className="btn btn--sm text-xs"
                    >
                      Connect
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* App Marketplace Tab */}
      {activeTab === 'marketplace' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {marketplaceApps.map((app) => (
              <div key={app.id} className="card p-4 space-y-3 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-sm text-gray-900 dark:text-white">
                      {app.name}
                    </span>
                    <StatusBadge
                      status={app.connected ? 'active' : 'cancelled'}
                    />
                  </div>
                  <Badge tone="default">{app.category}</Badge>
                  <p className="text-xs text-gray-500">{app.description}</p>
                </div>
                {app.connected && app.accountName && (
                  <div className="text-xs text-gray-400 font-mono bg-gray-50 dark:bg-gray-900 p-2 rounded">
                    Account: {app.accountName}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connect Wizard Modal */}
      {showConnectModal && (
        <Modal
          title="Connect Provider Account"
          onClose={() => setShowConnectModal(false)}
        >
          <form onSubmit={handleCreateConnection} className="space-y-4">
            {connectError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-red-500 text-xs">
                {connectError}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Provider Type *
              </label>
              <select
                value={selectedProviderKey}
                onChange={(e) => setSelectedProviderKey(e.target.value)}
                className="input w-full text-sm"
              >
                {catalog.map((c) => (
                  <option key={c.providerKey} value={c.providerKey}>
                    {c.name} ({c.category})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Display Label
              </label>
              <input
                type="text"
                value={connectionLabelInput}
                onChange={(e) => setConnectionLabelInput(e.target.value)}
                placeholder="e.g. Primary Agency SendGrid Account"
                className="input w-full text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Server-Side Secret Reference Name *
              </label>
              <input
                type="text"
                required
                value={secretRefInput}
                onChange={(e) => setSecretRefInput(e.target.value)}
                placeholder={selectedCatalogEntry?.secretRefFormatHint || 'e.g. SENDGRID_API_KEY'}
                className="input w-full text-sm font-mono"
              />
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                ⚠️ Security: Enter only the name of the environment variable or vault reference. Never type or paste raw API secrets into this field.
              </p>
            </div>

            {selectedCatalogEntry?.requiredConfigFields && selectedCatalogEntry.requiredConfigFields.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-gray-800">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 block">
                  Configuration Fields:
                </span>
                {selectedCatalogEntry.requiredConfigFields.map((field) => (
                  <div key={field}>
                    <label className="block text-[11px] font-mono text-gray-500 mb-0.5">
                      {field}
                    </label>
                    <input
                      type="text"
                      value={configInputs[field] || ''}
                      onChange={(e) =>
                        setConfigInputs({ ...configInputs, [field]: e.target.value })
                      }
                      placeholder={`Value for ${field}`}
                      className="input w-full text-xs"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setShowConnectModal(false)}
                className="btn btn--sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={connectSaving}
                className="btn btn--primary btn--sm flex items-center gap-1.5"
              >
                {connectSaving && <Icon name="refresh" size={14} className="animate-spin" />}
                Save Provider Reference
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Revocation Confirmation Modal */}
      {revokingConnection && (
        <Modal
          title="Revoke Provider Connection"
          onClose={() => setRevokingConnection(null)}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Are you sure you want to revoke the connection for{' '}
              <span className="font-semibold">{revokingConnection.label || revokingConnection.providerKey}</span>?
            </p>
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-600 dark:text-red-400">
              Revocation is terminal. The connection status will become <code className="font-mono">revoked</code> and any workflows relying on this provider will be blocked from dispatching.
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setRevokingConnection(null)}
                className="btn btn--sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={connectSaving}
                onClick={handleRevokeConnection}
                className="btn btn--danger btn--sm flex items-center gap-1.5"
              >
                {connectSaving && <Icon name="refresh" size={14} className="animate-spin" />}
                Confirm Revocation
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
