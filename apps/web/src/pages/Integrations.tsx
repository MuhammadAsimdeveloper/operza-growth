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

const UNIVERSAL_CONNECTORS = [
  { id: 'slack', name: 'Slack', category: 'Communications', auth: 'OAuth 2.0', triggers: ['New Channel Message', 'Reaction Added'], actions: ['Send Channel Message', 'Send Direct Message', 'Create Channel'] },
  { id: 'gmail', name: 'Gmail', category: 'Communications', auth: 'OAuth 2.0', triggers: ['New Email', 'New Attachment', 'New Labeled Email'], actions: ['Send Email', 'Create Draft', 'Add Label'] },
  { id: 'google_sheets', name: 'Google Sheets', category: 'Productivity', auth: 'OAuth 2.0', triggers: ['New Spreadsheet Row', 'Updated Spreadsheet Row'], actions: ['Create Spreadsheet Row', 'Update Row', 'Lookup Row'] },
  { id: 'salesforce', name: 'Salesforce', category: 'CRM', auth: 'OAuth 2.0', triggers: ['New Lead', 'Updated Opportunity', 'New Account'], actions: ['Create Lead', 'Update Opportunity', 'Add Contact to Campaign'] },
  { id: 'stripe', name: 'Stripe', category: 'Commerce', auth: 'API Key', triggers: ['Payment Succeeded', 'Subscription Created', 'Invoice Paid'], actions: ['Create Customer', 'Create Invoice', 'Create Payment Link'] },
  { id: 'shopify', name: 'Shopify', category: 'Commerce', auth: 'OAuth 2.0', triggers: ['New Order', 'Paid Order', 'New Customer'], actions: ['Create Product', 'Update Inventory', 'Create Discount Code'] },
  { id: 'airtable', name: 'Airtable', category: 'Productivity', auth: 'API Key', triggers: ['New Record', 'Updated Record'], actions: ['Create Record', 'Update Record', 'Search Records'] },
  { id: 'calendly', name: 'Calendly', category: 'Productivity', auth: 'OAuth 2.0', triggers: ['Invitee Created', 'Invitee Canceled'], actions: ['Create Single-Use Scheduling Link'] },
  { id: 'notion', name: 'Notion', category: 'Productivity', auth: 'OAuth 2.0', triggers: ['New Database Item', 'Updated Database Item'], actions: ['Create Database Item', 'Update Page', 'Append Block'] },
  { id: 'quickbooks', name: 'QuickBooks Online', category: 'Commerce', auth: 'OAuth 2.0', triggers: ['New Invoice', 'New Payment', 'New Customer'], actions: ['Create Invoice', 'Create Customer', 'Send Invoice'] },
  { id: 'discord', name: 'Discord', category: 'Communications', auth: 'Bot Token', triggers: ['New Message in Channel'], actions: ['Send Channel Message', 'Send DM to User'] },
  { id: 'twilio', name: 'Twilio', category: 'Communications', auth: 'API Key', triggers: ['Incoming SMS', 'Incoming Call'], actions: ['Send SMS', 'Make Call'] },
  { id: 'zoom', name: 'Zoom', category: 'Communications', auth: 'OAuth 2.0', triggers: ['Meeting Created', 'Registrant Added'], actions: ['Create Meeting', 'Add Meeting Registrant'] },
  { id: 'mailchimp', name: 'Mailchimp', category: 'Marketing', auth: 'API Key', triggers: ['New Subscriber', 'Unsubscribe'], actions: ['Add/Update Subscriber', 'Add Tag', 'Send Campaign'] },
  { id: 'sendgrid', name: 'SendGrid', category: 'Marketing', auth: 'API Key', triggers: ['Email Delivered', 'Email Opened', 'Link Clicked'], actions: ['Send Transactional Email', 'Add Contact to List', 'Send Marketing Campaign'] },
  { id: 'clickup', name: 'ClickUp', category: 'Productivity', auth: 'OAuth 2.0', triggers: ['Task Created', 'Task Status Updated'], actions: ['Create Task', 'Update Task Status'] },
  { id: 'asana', name: 'Asana', category: 'Productivity', auth: 'OAuth 2.0', triggers: ['Task Added to Project'], actions: ['Create Task', 'Update Task'] },
  { id: 'trello', name: 'Trello', category: 'Productivity', auth: 'API Key', triggers: ['New Card', 'Card Moved to List'], actions: ['Create Card', 'Move Card'] },
  { id: 'webflow', name: 'Webflow', category: 'Marketing', auth: 'OAuth 2.0', triggers: ['Form Submission', 'E-commerce Order'], actions: ['Create Live Item', 'Update Item'] },
  { id: 'github', name: 'GitHub', category: 'Developer', auth: 'Personal Access Token', triggers: ['New Issue', 'Pull Request Opened', 'Release Published'], actions: ['Create Issue', 'Create PR Comment'] },
  { id: 'intercom', name: 'Intercom', category: 'Communications', auth: 'OAuth 2.0', triggers: ['New Conversation', 'New Lead'], actions: ['Send Message', 'Add Tag to User'] },
  { id: 'jira', name: 'Jira Software', category: 'Developer', auth: 'OAuth 2.0', triggers: ['New Issue', 'Issue Status Changed'], actions: ['Create Issue', 'Assign Issue', 'Add Comment'] }
];

export default function Integrations() {
  const [activeTab, setActiveTab] = useState<'connections' | 'marketplace' | 'zapier'>('connections');

  // Platform Provider Connections State
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>([]);
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);

  // Zapier Platform State
  const [zapierAuth, setZapierAuth] = useState<any>(null);
  const [zapierSubTab, setZapierSubTab] = useState<'overview' | 'actions' | 'hooks' | 'deliveries' | 'connectors' | 'templates'>('overview');
  const [selectedSampleEvent, setSelectedSampleEvent] = useState<string>('contact.created');
  const [samplePayload, setSamplePayload] = useState<any>(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [connectorCategory, setConnectorCategory] = useState<string>('All');
  const [connectorSearch, setConnectorSearch] = useState<string>('');

  // Zapier Live Hooks & Deliveries State
  const [zapierSubscriptions, setZapierSubscriptions] = useState<any[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [zapierDeliveries, setZapierDeliveries] = useState<any[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [testWebhookUrl, setTestWebhookUrl] = useState('https://hooks.zapier.com/hooks/catch/sample/test');
  const [testWebhookEvent, setTestWebhookEvent] = useState('contact.created');
  const [testWebhookLoading, setTestWebhookLoading] = useState(false);
  const [testWebhookResult, setTestWebhookResult] = useState<any>(null);

  // Zapier Interactive Actions & Searches Playground State
  const [testActionKey, setTestActionKey] = useState<string>('create_contact');
  const [testActionData, setTestActionData] = useState<string>(
    JSON.stringify({
      firstName: 'Sarah',
      lastName: 'Connor',
      email: 'sarah@skynet-defense.com',
      phone: '+1 555-0199',
      company: 'Cyberdyne Systems',
      tags: ['zapier-inbound', 'enterprise']
    }, null, 2)
  );
  const [testActionLoading, setTestActionLoading] = useState(false);
  const [testActionResult, setTestActionResult] = useState<any>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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

  const fetchZapierDetails = async () => {
    try {
      const auth = await api.zapier.getAuth();
      setZapierAuth(auth);
    } catch {}
    loadSample(selectedSampleEvent);
  };

  const loadSample = async (event: string) => {
    setSampleLoading(true);
    try {
      const samples = await api.zapier.getSamples(event);
      setSamplePayload(samples);
    } catch {
      setSamplePayload(null);
    } finally {
      setSampleLoading(false);
    }
  };

  const fetchSubscriptions = async () => {
    setSubsLoading(true);
    try {
      const res = await api.zapier.getSubscriptions();
      setZapierSubscriptions(res.subscriptions || []);
    } catch {
      setZapierSubscriptions([]);
    } finally {
      setSubsLoading(false);
    }
  };

  const fetchDeliveries = async () => {
    setDeliveriesLoading(true);
    try {
      const res = await api.zapier.getDeliveries();
      setZapierDeliveries(res.deliveries || []);
    } catch {
      setZapierDeliveries([]);
    } finally {
      setDeliveriesLoading(false);
    }
  };

  const handleTestPing = async (e: React.FormEvent) => {
    e.preventDefault();
    setTestWebhookLoading(true);
    setTestWebhookResult(null);
    try {
      const res = await api.zapier.testHook(testWebhookUrl, testWebhookEvent);
      setTestWebhookResult(res);
      fetchDeliveries();
    } catch (err: any) {
      setTestWebhookResult({ error: err.message });
    } finally {
      setTestWebhookLoading(false);
    }
  };

  const handleRunTestAction = async () => {
    setTestActionLoading(true);
    setTestActionResult(null);
    try {
      let parsed = {};
      try {
        parsed = JSON.parse(testActionData);
      } catch {
        throw new Error('Invalid JSON input format');
      }
      let res;
      if (testActionKey.startsWith('find_')) {
        res = await api.zapier.executeSearch(testActionKey, parsed);
      } else {
        res = await api.zapier.executeAction(testActionKey, parsed);
      }
      setTestActionResult(res);
    } catch (err: any) {
      setTestActionResult({ error: err.message });
    } finally {
      setTestActionLoading(false);
    }
  };

  const handleActionPresetChange = (key: string) => {
    setTestActionKey(key);
    setTestActionResult(null);
    const presets: Record<string, any> = {
      create_contact: {
        firstName: 'Sarah',
        lastName: 'Connor',
        email: 'sarah@skynet-defense.com',
        phone: '+1 555-0199',
        company: 'Cyberdyne Systems',
        tags: ['zapier-inbound', 'enterprise']
      },
      update_contact: {
        email: 'sarah@skynet-defense.com',
        company: 'Skynet Research Division',
        tags: ['upgraded-tier']
      },
      create_opportunity: {
        name: 'Enterprise Security Advisory Retainer',
        value: 85000,
        stage: 'Discovery',
        contactEmail: 'sarah@skynet-defense.com'
      },
      update_opportunity: {
        contactEmail: 'sarah@skynet-defense.com',
        stage: 'Proposal Accepted',
        value: 125000
      },
      create_appointment: {
        contactName: 'Sarah Connor',
        contactEmail: 'sarah@skynet-defense.com',
        title: 'Executive Architecture Consultation',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        durationMin: 45
      },
      create_task: {
        title: 'Prepare Custom Enterprise SLA Proposal',
        priority: 'high',
        assignedTo: 'Lead Solution Architect',
        dueDate: new Date(Date.now() + 86400000 * 2).toISOString()
      },
      add_tag: {
        email: 'sarah@skynet-defense.com',
        tag: 'contract-review'
      },
      remove_tag: {
        email: 'sarah@skynet-defense.com',
        tag: 'unresponsive'
      },
      create_note: {
        email: 'sarah@skynet-defense.com',
        note: 'Customer requested multi-region failover architecture overview.'
      },
      trigger_workflow: {
        workflowName: 'Discovery Consultation Workflow',
        mode: 'live',
        payload: { triggeredBy: 'Zapier Test Playground' }
      },
      send_notification: {
        title: 'High-Value Lead Created via Zapier',
        message: 'Sarah Connor at Cyberdyne Systems entered the sales pipeline.',
        channel: 'in_app'
      },
      find_contact: {
        email: 'sarah@skynet-defense.com'
      },
      find_opportunity: {
        contactEmail: 'sarah@skynet-defense.com'
      },
      find_appointment: {
        contactName: 'Sarah'
      },
      find_task: {
        title: 'Enterprise'
      }
    };
    setTestActionData(JSON.stringify(presets[key] || {}, null, 2));
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  useEffect(() => {
    if (activeTab === 'zapier') {
      fetchZapierDetails();
      fetchSubscriptions();
      fetchDeliveries();
    }
  }, [activeTab, selectedSampleEvent]);

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

        <button
          onClick={() => setActiveTab('zapier')}
          className={`pb-3 font-medium transition-colors flex items-center gap-2 border-b-2 ${
            activeTab === 'zapier'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-semibold'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <Icon name="zap" size={16} />
          Zapier & Universal Connectors
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-orange-100 dark:bg-orange-950 text-orange-600 dark:text-orange-400 font-mono font-bold">
            22+
          </span>
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

      {activeTab === 'zapier' && (
        <div className="space-y-6">
          {/* Zapier Platform Banner & Quick Credentials */}
          <div className="bg-gradient-to-r from-orange-500/10 via-amber-500/10 to-orange-500/5 border border-orange-500/30 rounded-xl p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide bg-orange-500 text-white">
                    Zapier Platform Certified
                  </span>
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">
                    Full Universal SaaS Integration Suite
                  </h3>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300 max-w-2xl">
                  Connect Operza to 6,000+ external SaaS apps. Supports 14 real-time REST Hook triggers, 12 inbound actions, 4 search lookups, and HMAC-SHA256 replay defense.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs">
                  <span className={`w-2 h-2 rounded-full ${zapierAuth?.valid ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
                  <span className="font-medium text-gray-700 dark:text-gray-200">
                    {zapierAuth?.valid ? 'REST Hooks Engine Active' : 'Checking Status...'}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Connection Credentials Card */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-orange-500/20 text-xs">
              <div className="p-3 bg-white/70 dark:bg-gray-900/70 border border-orange-500/20 rounded-lg space-y-1">
                <span className="text-[10px] uppercase font-bold text-gray-500 block">Zapier API Base URL</span>
                <div className="flex items-center justify-between font-mono text-[11px] text-gray-800 dark:text-gray-200">
                  <span className="truncate">/api/v1/zapier</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(`${window.location.origin}/api/v1/zapier`, 'url')}
                    className="ml-2 text-orange-600 dark:text-orange-400 hover:underline font-sans font-semibold text-[10px]"
                  >
                    {copiedKey === 'url' ? 'Copied!' : 'Copy URL'}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-white/70 dark:bg-gray-900/70 border border-orange-500/20 rounded-lg space-y-1">
                <span className="text-[10px] uppercase font-bold text-gray-500 block">Authentication Header</span>
                <div className="flex items-center justify-between font-mono text-[11px] text-gray-800 dark:text-gray-200">
                  <span className="truncate">Authorization: Bearer opz_...</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard('Authorization: Bearer <YOUR_OPERZA_API_KEY>', 'auth')}
                    className="ml-2 text-orange-600 dark:text-orange-400 hover:underline font-sans font-semibold text-[10px]"
                  >
                    {copiedKey === 'auth' ? 'Copied!' : 'Copy Format'}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-white/70 dark:bg-gray-900/70 border border-orange-500/20 rounded-lg space-y-1">
                <span className="text-[10px] uppercase font-bold text-gray-500 block">Webhook HMAC Signature</span>
                <div className="flex items-center justify-between font-mono text-[11px] text-gray-800 dark:text-gray-200">
                  <span className="truncate">X-Operza-Signature (SHA256)</span>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold font-sans">
                    Replay-Protected
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Zapier Feature Sub-Navigation */}
          <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 pb-2 text-xs overflow-x-auto">
            <button
              type="button"
              onClick={() => setZapierSubTab('overview')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                zapierSubTab === 'overview'
                  ? 'bg-orange-500 text-white font-bold'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              14 Triggers & Schemas
            </button>
            <button
              type="button"
              onClick={() => setZapierSubTab('actions')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                zapierSubTab === 'actions'
                  ? 'bg-orange-500 text-white font-bold'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              Action & Search Tester
            </button>
            <button
              type="button"
              onClick={() => {
                setZapierSubTab('hooks');
                fetchSubscriptions();
              }}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                zapierSubTab === 'hooks'
                  ? 'bg-orange-500 text-white font-bold'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              REST Hooks Manager ({zapierSubscriptions.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setZapierSubTab('deliveries');
                fetchDeliveries();
              }}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                zapierSubTab === 'deliveries'
                  ? 'bg-orange-500 text-white font-bold'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              Delivery Audit Logs ({zapierDeliveries.length})
            </button>
            <button
              type="button"
              onClick={() => setZapierSubTab('connectors')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                zapierSubTab === 'connectors'
                  ? 'bg-orange-500 text-white font-bold'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              Universal Connectors ({UNIVERSAL_CONNECTORS.length})
            </button>
            <button
              type="button"
              onClick={() => setZapierSubTab('templates')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                zapierSubTab === 'templates'
                  ? 'bg-orange-500 text-white font-bold'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              1-Click Zap Recipes
            </button>
          </div>

          {/* Sub-Tab 1: Triggers & Schema Explorer */}
          {zapierSubTab === 'overview' && (
            <div className="space-y-4">
              <div className="card p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-200 dark:border-gray-800 pb-3">
                  <div>
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                      <Icon name="code" size={16} className="text-orange-500" />
                      Live Zapier performList Schema & Trigger Samples
                    </h4>
                    <p className="text-xs text-gray-500">
                      Select any of the 14 supported real-time triggers to inspect canonical schemas sent to Zapier.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedSampleEvent}
                      onChange={(e) => setSelectedSampleEvent(e.target.value)}
                      className="input text-xs py-1.5 font-mono"
                    >
                      <option value="contact.created">contact.created (New Contact)</option>
                      <option value="contact.updated">contact.updated (Updated Contact)</option>
                      <option value="opportunity.created">opportunity.created (New Opportunity)</option>
                      <option value="opportunity.stage_changed">opportunity.stage_changed (Stage Change)</option>
                      <option value="appointment.booked">appointment.booked (New Appointment)</option>
                      <option value="appointment.cancelled">appointment.cancelled (Cancelled Appointment)</option>
                      <option value="form.submitted">form.submitted (New Form Submission)</option>
                      <option value="payment.received">payment.received (Payment Completed)</option>
                      <option value="invoice.paid">invoice.paid (Invoice Paid)</option>
                      <option value="task.created">task.created (New Task)</option>
                      <option value="call.completed">call.completed (Call Session Ended)</option>
                      <option value="tag.added">tag.added (Contact Tag Added)</option>
                      <option value="workflow.completed">workflow.completed (Workflow Finished)</option>
                      <option value="notification.created">notification.created (Team Notification)</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => loadSample(selectedSampleEvent)}
                      className="btn btn--sm text-xs flex items-center gap-1"
                    >
                      <Icon name="refresh" size={12} className={sampleLoading ? 'animate-spin' : ''} />
                      Refresh
                    </button>
                  </div>
                </div>

                {sampleLoading ? (
                  <div className="p-4 text-center text-xs text-gray-500">Loading payload schema...</div>
                ) : samplePayload ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span>Canonical Zapier performList Data Format:</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(JSON.stringify(samplePayload, null, 2), 'sampleJson')}
                        className="text-orange-500 hover:underline"
                      >
                        {copiedKey === 'sampleJson' ? 'Copied JSON!' : 'Copy Sample Payload'}
                      </button>
                    </div>
                    <pre className="p-3 bg-gray-900 text-emerald-400 font-mono text-xs rounded-lg overflow-x-auto max-h-56">
                      {JSON.stringify(samplePayload, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <div className="p-4 text-center text-xs text-gray-500">No sample records available.</div>
                )}
              </div>
            </div>
          )}

          {/* Sub-Tab 2: Inbound Action & Search Interactive Playground */}
          {zapierSubTab === 'actions' && (
            <div className="card p-5 space-y-4">
              <div>
                <h4 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Icon name="play" size={16} className="text-orange-500" />
                  Zapier Inbound Action & Search Testing Playground
                </h4>
                <p className="text-xs text-gray-500">
                  Simulate live inbound Zapier actions and searches directly against your workspace tenant API.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      Target Zapier Operation (12 Actions + 4 Searches)
                    </label>
                    <select
                      value={testActionKey}
                      onChange={(e) => handleActionPresetChange(e.target.value)}
                      className="input w-full text-xs font-mono"
                    >
                      <optgroup label="Inbound Creates & Actions">
                        <option value="create_contact">create_contact (Upsert Contact)</option>
                        <option value="update_contact">update_contact (Update Contact Details)</option>
                        <option value="create_opportunity">create_opportunity (New Pipeline Deal)</option>
                        <option value="update_opportunity">update_opportunity (Change Deal Stage)</option>
                        <option value="create_appointment">create_appointment (Schedule Calendar Booking)</option>
                        <option value="create_task">create_task (Create CRM Task)</option>
                        <option value="add_tag">add_tag (Add Tag to Contact)</option>
                        <option value="remove_tag">remove_tag (Remove Tag from Contact)</option>
                        <option value="create_note">create_note (Append Activity Note)</option>
                        <option value="trigger_workflow">trigger_workflow (Execute Automation Flow)</option>
                        <option value="send_notification">send_notification (Push Team Alert)</option>
                      </optgroup>
                      <optgroup label="Inbound Searches / Lookups">
                        <option value="find_contact">find_contact (Lookup Contact by Email/Phone)</option>
                        <option value="find_opportunity">find_opportunity (Lookup Deal Opportunity)</option>
                        <option value="find_appointment">find_appointment (Lookup Calendar Appointment)</option>
                        <option value="find_task">find_task (Lookup Assigned Task)</option>
                      </optgroup>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      JSON Input Payload
                    </label>
                    <textarea
                      rows={8}
                      value={testActionData}
                      onChange={(e) => setTestActionData(e.target.value)}
                      className="input w-full font-mono text-xs p-2.5"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={testActionLoading}
                    onClick={handleRunTestAction}
                    className="btn btn--primary text-xs w-full py-2 flex items-center justify-center gap-2"
                  >
                    <Icon name="play" size={14} className={testActionLoading ? 'animate-spin' : ''} />
                    {testActionLoading ? 'Executing via Zapier Platform...' : `Execute ${testActionKey}`}
                  </button>
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 block">
                    Execution Response Output
                  </span>
                  {testActionResult ? (
                    <pre className="p-3 bg-gray-900 text-emerald-400 font-mono text-xs rounded-lg overflow-x-auto min-h-[220px]">
                      {JSON.stringify(testActionResult, null, 2)}
                    </pre>
                  ) : (
                    <div className="p-8 border border-dashed border-gray-300 dark:border-gray-800 rounded-lg text-center text-xs text-gray-400 min-h-[220px] flex items-center justify-center">
                      Select an action preset and click "Execute" to inspect the live response.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Sub-Tab 3: REST Hooks Manager */}
          {zapierSubTab === 'hooks' && (
            <div className="space-y-5">
              {/* Test Hook Ping Dispatcher Card */}
              <div className="card p-5 space-y-4">
                <div>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <Icon name="send" size={16} className="text-orange-500" />
                    Send Live Signed Test Ping to Zapier Webhook
                  </h4>
                  <p className="text-xs text-gray-500">
                    Dispatches a real-time HMAC-SHA256 signed event payload to verify end-to-end delivery into your Zap catch hook.
                  </p>
                </div>

                <form onSubmit={handleTestPing} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                        Zapier Target Catch URL (HTTPS required) *
                      </label>
                      <input
                        type="url"
                        required
                        value={testWebhookUrl}
                        onChange={(e) => setTestWebhookUrl(e.target.value)}
                        placeholder="https://hooks.zapier.com/hooks/catch/..."
                        className="input w-full text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                        Trigger Event
                      </label>
                      <select
                        value={testWebhookEvent}
                        onChange={(e) => setTestWebhookEvent(e.target.value)}
                        className="input w-full text-xs font-mono"
                      >
                        <option value="contact.created">contact.created</option>
                        <option value="opportunity.stage_changed">opportunity.stage_changed</option>
                        <option value="appointment.booked">appointment.booked</option>
                        <option value="form.submitted">form.submitted</option>
                        <option value="payment.received">payment.received</option>
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={testWebhookLoading}
                    className="btn btn--primary text-xs py-2 px-4 flex items-center gap-2"
                  >
                    <Icon name="zap" size={14} className={testWebhookLoading ? 'animate-spin' : ''} />
                    {testWebhookLoading ? 'Dispatching...' : 'Send Signed Test Ping'}
                  </button>
                </form>

                {testWebhookResult && (
                  <div className="p-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg text-xs space-y-1">
                    <span className="font-bold text-gray-700 dark:text-gray-300">Ping Result:</span>
                    <pre className="font-mono text-[11px] text-emerald-500 overflow-x-auto">
                      {JSON.stringify(testWebhookResult, null, 2)}
                    </pre>
                  </div>
                )}
              </div>

              {/* Subscriptions Table */}
              <div className="card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white">
                    Active REST Hook Subscriptions ({zapierSubscriptions.length})
                  </h4>
                  <button
                    type="button"
                    onClick={fetchSubscriptions}
                    className="btn btn--sm text-xs flex items-center gap-1"
                  >
                    <Icon name="refresh" size={12} className={subsLoading ? 'animate-spin' : ''} />
                    Refresh
                  </button>
                </div>

                {subsLoading ? (
                  <div className="p-4 text-center text-xs text-gray-500">Loading subscriptions...</div>
                ) : zapierSubscriptions.length === 0 ? (
                  <div className="p-6 border border-dashed border-gray-300 dark:border-gray-800 rounded-lg text-center text-xs text-gray-500">
                    No active Zapier REST hook subscriptions yet. Create a Zap using Operza triggers to automatically register subscriptions.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-800 text-gray-400">
                          <th className="pb-2 font-semibold">Subscription ID</th>
                          <th className="pb-2 font-semibold">Event</th>
                          <th className="pb-2 font-semibold">Target Catch URL</th>
                          <th className="pb-2 font-semibold">Status</th>
                          <th className="pb-2 font-semibold">Created</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {zapierSubscriptions.map((sub) => (
                          <tr key={sub.id} className="font-mono">
                            <td className="py-2.5 font-bold text-orange-600 dark:text-orange-400">{sub.id}</td>
                            <td className="py-2.5 text-blue-600 dark:text-blue-400">{sub.event}</td>
                            <td className="py-2.5 truncate max-w-[200px] text-gray-600 dark:text-gray-300">{sub.targetUrl}</td>
                            <td className="py-2.5">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${sub.status === 'active' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-gray-500/10 text-gray-400'}`}>
                                {sub.status}
                              </span>
                            </td>
                            <td className="py-2.5 text-gray-400 font-sans text-[11px]">{new Date(sub.createdAt).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Sub-Tab 4: Outbound Deliveries Audit Trail */}
          {zapierSubTab === 'deliveries' && (
            <div className="card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white">
                    Zapier Outbound Event Delivery Logs
                  </h4>
                  <p className="text-xs text-gray-500">
                    Real-time audit log of all REST hook dispatches, HMAC signatures, HTTP status codes, and latency.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={fetchDeliveries}
                  className="btn btn--sm text-xs flex items-center gap-1"
                >
                  <Icon name="refresh" size={12} className={deliveriesLoading ? 'animate-spin' : ''} />
                  Refresh Logs
                </button>
              </div>

              {deliveriesLoading ? (
                <div className="p-4 text-center text-xs text-gray-500">Loading delivery logs...</div>
              ) : zapierDeliveries.length === 0 ? (
                <div className="p-6 border border-dashed border-gray-300 dark:border-gray-800 rounded-lg text-center text-xs text-gray-500">
                  No outbound events delivered yet. Triggers and test pings will appear here immediately.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-800 text-gray-400 font-sans">
                        <th className="pb-2 font-semibold">Delivery ID</th>
                        <th className="pb-2 font-semibold">Event</th>
                        <th className="pb-2 font-semibold">HTTP Status</th>
                        <th className="pb-2 font-semibold">Delivered At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {zapierDeliveries.map((deliv) => (
                        <tr key={deliv.id}>
                          <td className="py-2 text-gray-500">{deliv.id}</td>
                          <td className="py-2 text-indigo-500">{deliv.event}</td>
                          <td className="py-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              deliv.httpStatus >= 200 && deliv.httpStatus < 300
                                ? 'bg-emerald-500/10 text-emerald-500'
                                : 'bg-red-500/10 text-red-500'
                            }`}>
                              HTTP {deliv.httpStatus}
                            </span>
                          </td>
                          <td className="py-2 text-gray-400 text-[11px] font-sans">
                            {new Date(deliv.deliveredAt).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Sub-Tab 5: 22+ Universal Connectors Catalog */}
          {zapierSubTab === 'connectors' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white">
                      Universal App Connectors Catalog ({UNIVERSAL_CONNECTORS.length})
                    </h4>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                      Zapier REST Hooks & Outbound Ingress
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    Pre-configured app connector schemas ready for visual workflows and Zapier REST hook dispatches.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Search connectors..."
                    value={connectorSearch}
                    onChange={(e) => setConnectorSearch(e.target.value)}
                    className="input text-xs py-1.5 w-44"
                  />
                  <select
                    value={connectorCategory}
                    onChange={(e) => setConnectorCategory(e.target.value)}
                    className="input text-xs py-1.5"
                  >
                    <option value="All">All Categories</option>
                    <option value="CRM">CRM</option>
                    <option value="Communications">Communications</option>
                    <option value="Commerce">Commerce</option>
                    <option value="Productivity">Productivity</option>
                    <option value="Marketing">Marketing</option>
                    <option value="Developer">Developer</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {UNIVERSAL_CONNECTORS
                  .filter((c) => connectorCategory === 'All' || c.category === connectorCategory)
                  .filter((c) => !connectorSearch || c.name.toLowerCase().includes(connectorSearch.toLowerCase()) || c.category.toLowerCase().includes(connectorSearch.toLowerCase()))
                  .map((conn) => (
                    <div key={conn.id} className="card p-4 space-y-3 hover:border-orange-500/40 transition-colors">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-lg bg-orange-500/10 text-orange-600 dark:text-orange-400 flex items-center justify-center font-bold text-sm">
                            {conn.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <h5 className="text-sm font-bold text-gray-900 dark:text-white">{conn.name}</h5>
                            <span className="text-[11px] text-gray-500">{conn.category}</span>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                          {conn.auth}
                        </span>
                      </div>

                      <div className="space-y-1.5 text-xs">
                        <div>
                          <span className="text-[10px] uppercase font-semibold text-gray-400 block">Triggers:</span>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {conn.triggers.map((t) => (
                              <span key={t} className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px]">
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-semibold text-gray-400 block">Actions:</span>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {conn.actions.map((a) => (
                              <span key={a} className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px]">
                                {a}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Sub-Tab 6: Pre-Built 1-Click Zapier Recipes */}
          {zapierSubTab === 'templates' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-bold text-gray-900 dark:text-white">
                  Popular Pre-Built Zapier Recipes
                </h4>
                <p className="text-xs text-gray-500">
                  Ready-to-deploy Zapier integrations pairing Operza with popular external apps.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="card p-4 space-y-3 border-l-4 border-l-emerald-500">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Google Sheets ➔ Operza</span>
                    <Badge tone="default">Lead Capture</Badge>
                  </div>
                  <h5 className="text-sm font-bold text-gray-900 dark:text-white">
                    New Spreadsheet Row ➔ Create Contact & Start Onboarding Flow
                  </h5>
                  <p className="text-xs text-gray-500">
                    When a new row is added to your lead spreadsheet, immediately creates a contact in Operza and launches an email sequence.
                  </p>
                </div>

                <div className="card p-4 space-y-3 border-l-4 border-l-indigo-500">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">Stripe ➔ Operza</span>
                    <Badge tone="default">Sales & Revenue</Badge>
                  </div>
                  <h5 className="text-sm font-bold text-gray-900 dark:text-white">
                    Payment Succeeded ➔ Move Opportunity to Closed-Won & Issue Portal Access
                  </h5>
                  <p className="text-xs text-gray-500">
                    When a Stripe payment is processed, updates the sales pipeline deal to Won, grants Client Portal access, and notifies the team.
                  </p>
                </div>

                <div className="card p-4 space-y-3 border-l-4 border-l-orange-500">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-orange-600 dark:text-orange-400">Operza ➔ Slack & Discord</span>
                    <Badge tone="default">Team Alerts</Badge>
                  </div>
                  <h5 className="text-sm font-bold text-gray-900 dark:text-white">
                    Appointment Booked ➔ Post Rich Slack Notification to #sales
                  </h5>
                  <p className="text-xs text-gray-500">
                    Dispatches scheduled strategy call details to your internal Slack or Discord channels with one-click contact review links.
                  </p>
                </div>

                <div className="card p-4 space-y-3 border-l-4 border-l-blue-500">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-600 dark:text-blue-400">Meta Ads ➔ Operza</span>
                    <Badge tone="default">Paid Acquisition</Badge>
                  </div>
                  <h5 className="text-sm font-bold text-gray-900 dark:text-white">
                    Facebook Lead Ads Submission ➔ Inbound Contact & SMS Confirmation
                  </h5>
                  <p className="text-xs text-gray-500">
                    Instantly syncs lead form submissions from Instagram and Facebook into Operza contacts with sub-second SMS follow-ups.
                  </p>
                </div>
              </div>
            </div>
          )}
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
