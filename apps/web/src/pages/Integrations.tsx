/**
 * ============================================================================
 * Operza Unified Integrations, App Marketplace & Governance Connectors
 * ============================================================================
 * 
 * Provides production-grade connectivity for:
 * 1. Governed Provider Connections: Server-side secret references for Twilio,
 *    SendGrid, Meta WhatsApp Cloud, Stripe, and Resend with zero-browser secret exposure.
 * 2. App Marketplace Ecosystem: 24+ SaaS connectors across CRM, Comms, AI,
 *    Commerce, Productivity, Marketing, and Developer stacks.
 * 3. Zapier Universal Platform Suite: 14 real-time REST Hook triggers, 12 inbound
 *    actions, 4 search lookups, and HMAC-SHA256 replay defense.
 * 4. Webhook Event Bus & Delivery Logs: Real-time latency, signed test pings,
 *    and HTTP delivery status observability.
 */

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, StatusBadge } from '../components/ui';
import { IntegrationsHub2Panel } from '../components/IntegrationsHub2Panel';
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
  status: 'connected' | 'disconnected' | 'error' | 'unconfigured' | 'available';
  accountName?: string;
  accentColor?: string;
  authMethod?: string;
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

const DEFAULT_MARKETPLACE_APPS: MarketplaceApp[] = [
  { id: 'microsoft_outlook', name: 'Microsoft Outlook', category: 'Communications', description: 'Connect a Microsoft 365 or Outlook mailbox with delegated OAuth access to send email from Operza.', icon: 'mail', connected: false, status: 'unconfigured', accentColor: '#0078d4', authMethod: 'OAuth 2.0' },
  { id: 'google_calendar', name: 'Google Calendar', category: 'Productivity', description: 'Two-way appointment synchronization, busy slot filtering, and team calendar access.', icon: 'calendar', connected: false, status: 'disconnected', accentColor: '#4285f4', authMethod: 'OAuth 2.0' },
  { id: 'stripe', name: 'Stripe Payments & Subscriptions', category: 'Commerce', description: 'Payment processing stays disabled until reconciliation, refunds and compliance controls are complete.', icon: 'wallet', connected: false, status: 'unconfigured', accentColor: '#6366f1', authMethod: 'API Key' },
  { id: 'twilio', name: 'Twilio Voice & SMS', category: 'Communications', description: 'Connect and verify a real Twilio account before enabling external messaging.', icon: 'phone', connected: false, status: 'disconnected', accentColor: '#ef4444', authMethod: 'Account SID / Auth Token' },
  { id: 'sendgrid', name: 'SendGrid Email Delivery', category: 'Communications', description: 'Connect and verify a SendGrid sender identity before sending email.', icon: 'mail', connected: false, status: 'disconnected', accentColor: '#0ea5e9', authMethod: 'API Key' },
  { id: 'meta_whatsapp', name: 'WhatsApp Cloud API', category: 'Communications', description: 'Connect and verify a Meta WhatsApp Business account before messaging.', icon: 'whatsapp', connected: false, status: 'disconnected', accentColor: '#22c55e', authMethod: 'System User Token' },
  { id: 'openai', name: 'OpenAI & Gemini AI Models', category: 'AI', description: 'Configure AI model credentials in the AI settings and deployment environment.', icon: 'sparkles', connected: false, status: 'disconnected', accentColor: '#10b981', authMethod: 'API Key' },
  { id: 'slack', name: 'Slack Team Collaboration', category: 'Communications', description: 'Real-time alert dispatches for booked appointments, new high-value deals, and system events.', icon: 'message', connected: false, status: 'disconnected', accentColor: '#e01e5a', authMethod: 'OAuth 2.0 / Bot Token' },
  { id: 'shopify', name: 'Shopify Storefront Sync', category: 'Commerce', description: 'Bi-directional e-commerce store sync: orders, abandoned checkouts, inventory, and customer tags.', icon: 'store', connected: false, status: 'disconnected', accentColor: '#96bf48', authMethod: 'OAuth 2.0' },
  { id: 'google_sheets', name: 'Google Sheets Live Sync', category: 'Productivity', description: 'Stream new leads, form submissions, and deals directly into cloud spreadsheets in real time.', icon: 'clipboard', connected: false, status: 'disconnected', accentColor: '#0f9d58', authMethod: 'OAuth 2.0' },
  { id: 'hubspot', name: 'HubSpot CRM Sync', category: 'CRM', description: 'Two-way lead and company synchronization for enterprise sales team coexistence.', icon: 'users', connected: false, status: 'disconnected', accentColor: '#ff7a59', authMethod: 'Private App Token' },
  { id: 'quickbooks', name: 'QuickBooks Online', category: 'Commerce', description: 'Automate accounting entries, invoice creation, and payment reconciliation.', icon: 'file', connected: false, status: 'disconnected', accentColor: '#2ca01c', authMethod: 'OAuth 2.0' },
  { id: 'discord', name: 'Discord Community Bot', category: 'Communications', description: 'Grant automated role access upon course enrollment and post community milestone alerts.', icon: 'message', connected: false, status: 'disconnected', accentColor: '#5865f2', authMethod: 'Bot Token' },
  { id: 'airtable', name: 'Airtable Relational Bases', category: 'Productivity', description: 'Sync dynamic custom values, client onboarding checklists, and campaign assets with Airtable.', icon: 'database', connected: false, status: 'disconnected', accentColor: '#fcb400', authMethod: 'Personal Access Token' },
  { id: 'notion', name: 'Notion Workspace Docs', category: 'Productivity', description: 'Automatically create client onboarding pages and sync task databases with Notion workspaces.', icon: 'book', connected: false, status: 'disconnected', accentColor: '#000000', authMethod: 'Internal Integration Token' },
  { id: 'mailchimp', name: 'Mailchimp Newsletter Sync', category: 'Marketing', description: 'Bi-directional list sync, segment tagging, and automated unsubscribe reconciliation.', icon: 'megaphone', connected: false, status: 'disconnected', accentColor: '#ffe01b', authMethod: 'API Key' },
  { id: 'zoom', name: 'Zoom Video Conferencing', category: 'Communications', description: 'Automatically generate unique video meeting links for booked appointments and strategy sessions.', icon: 'phone', connected: false, status: 'disconnected', accentColor: '#2d8cff', authMethod: 'Server-to-Server OAuth' },
  { id: 'github', name: 'GitHub Developer Webhooks', category: 'Developer', description: 'Trigger workflow automation runs on code pushes, issue updates, and pull request events.', icon: 'code', connected: false, status: 'disconnected', accentColor: '#24292e', authMethod: 'Fine-grained Token' },
  { id: 'zapier', name: 'Zapier REST Hooks API', category: 'Developer', description: 'Connect Zapier to Operza using a tenant API key with the minimum required scopes.', icon: 'zap', connected: false, status: 'available', accentColor: '#ff4a00', authMethod: 'Tenant Bearer API Key' },
];

export default function Integrations() {
  const [activeTab, setActiveTab] = useState<'connections' | 'marketplace' | 'zapier' | 'webhooks'>('connections');

  // Platform Provider Connections State
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>([]);
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);

  // App Marketplace State
  const [marketplaceApps, setMarketplaceApps] = useState<MarketplaceApp[]>(DEFAULT_MARKETPLACE_APPS);
  const [marketplaceSearch, setMarketplaceSearch] = useState('');
  const [marketplaceCategory, setMarketplaceCategory] = useState('All');
  const [selectedAppForConfig, setSelectedAppForConfig] = useState<MarketplaceApp | null>(null);

  // Zapier Platform State
  const [zapierAuth, setZapierAuth] = useState<any>(null);
  const [zapierSubTab, setZapierSubTab] = useState<'overview' | 'actions' | 'connectors' | 'templates'>('overview');
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
    JSON.stringify(
      {
        firstName: 'Sarah',
        lastName: 'Connor',
        email: 'sarah@skynet-defense.com',
        phone: '+1 555-0199',
        company: 'Cyberdyne Systems',
        tags: ['zapier-inbound', 'enterprise'],
      },
      null,
      2
    )
  );
  const [testActionLoading, setTestActionLoading] = useState(false);
  const [testActionResult, setTestActionResult] = useState<any>(null);

  // Copy indicator
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Connection Creation Modal State
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [selectedProviderKey, setSelectedProviderKey] = useState<string>('sendgrid');
  const [connectionLabelInput, setConnectionLabelInput] = useState('');
  const [secretRefInput, setSecretRefInput] = useState('');
  const [configInputs, setConfigInputs] = useState<Record<string, string>>({});
  const [connectSaving, setConnectSaving] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Connection Verification State
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verificationFeedback, setVerificationFeedback] = useState<{ id: string; code: string; error: string } | null>(null);

  // Connection Revocation State
  const [revokingConnection, setRevokingConnection] = useState<ProviderConnection | null>(null);

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
      if (res?.integrations && res.integrations.length > 0) {
        // Merge with defaults
        const merged = DEFAULT_MARKETPLACE_APPS.map((def) => {
          const remote = res.integrations.find((r: any) => r.id === def.id);
          return remote ? { ...def, ...remote } : def;
        });
        setMarketplaceApps(merged);
      }
    } catch {
      // Keep defaults
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
        tags: ['zapier-inbound', 'enterprise'],
      },
      update_contact: {
        email: 'sarah@skynet-defense.com',
        company: 'Skynet Research Division',
        tags: ['upgraded-tier'],
      },
      create_opportunity: {
        name: 'Enterprise Security Advisory Retainer',
        value: 85000,
        stage: 'Discovery',
        contactEmail: 'sarah@skynet-defense.com',
      },
      update_opportunity: {
        contactEmail: 'sarah@skynet-defense.com',
        stage: 'Proposal Accepted',
        value: 125000,
      },
      create_appointment: {
        contactName: 'Sarah Connor',
        contactEmail: 'sarah@skynet-defense.com',
        title: 'Executive Architecture Consultation',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        durationMin: 45,
      },
      create_task: {
        title: 'Prepare Custom Enterprise SLA Proposal',
        priority: 'high',
        assignedTo: 'Lead Solution Architect',
        dueDate: new Date(Date.now() + 86400000 * 2).toISOString(),
      },
      add_tag: {
        email: 'sarah@skynet-defense.com',
        tag: 'contract-review',
      },
      remove_tag: {
        email: 'sarah@skynet-defense.com',
        tag: 'unresponsive',
      },
      create_note: {
        email: 'sarah@skynet-defense.com',
        note: 'Customer requested multi-region failover architecture overview.',
      },
      trigger_workflow: {
        workflowName: 'Discovery Consultation Workflow',
        mode: 'live',
        payload: { triggeredBy: 'Zapier Test Playground' },
      },
      send_notification: {
        title: 'High-Value Lead Created via Zapier',
        message: 'Sarah Connor at Cyberdyne Systems entered the sales pipeline.',
        channel: 'in_app',
      },
      find_contact: {
        email: 'sarah@skynet-defense.com',
      },
      find_opportunity: {
        contactEmail: 'sarah@skynet-defense.com',
      },
      find_appointment: {
        contactName: 'Sarah',
      },
      find_task: {
        title: 'Enterprise',
      },
    };
    setTestActionData(JSON.stringify(presets[key] || {}, null, 2));
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  useEffect(() => {
    fetchPlatformConnections();
    fetchMarketplace();
    fetchZapierDetails();
    fetchSubscriptions();
    fetchDeliveries();
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

  const handleToggleMarketplaceApp = async (app: MarketplaceApp) => {
    try {
      if (app.connected) {
        const res = await api.integrations.disconnect(app.id);
        if (res?.success) {
          setMarketplaceApps((prev) =>
            prev.map((a) => (a.id === app.id ? { ...a, connected: false, status: 'disconnected', accountName: undefined } : a))
          );
        }
      } else {
        const res = await api.integrations.connect(app.id, {});
        if (res?.success) {
          setMarketplaceApps((prev) =>
            prev.map((a) => (a.id === app.id ? { ...a, connected: true, status: 'connected', accountName: res.integration?.accountName } : a))
          );
        }
      }
    } catch (err: any) {
      alert(err.message || 'Connecting this app requires a verified provider-specific OAuth or API credential flow.');
    } finally {
      if (selectedAppForConfig?.id === app.id) {
        setSelectedAppForConfig(null);
      }
    }
  };

  const selectedCatalogEntry = useMemo(() => {
    return catalog.find((c) => c.providerKey === selectedProviderKey);
  }, [catalog, selectedProviderKey]);

  // Filtered Marketplace Apps
  const filteredMarketplaceApps = useMemo(() => {
    return marketplaceApps
      .filter((app) => (marketplaceCategory === 'All' ? true : app.category.toLowerCase().includes(marketplaceCategory.toLowerCase())))
      .filter((app) => {
        if (!marketplaceSearch.trim()) return true;
        const q = marketplaceSearch.toLowerCase().trim();
        return (
          app.name.toLowerCase().includes(q) ||
          app.description.toLowerCase().includes(q) ||
          app.category.toLowerCase().includes(q)
        );
      });
  }, [marketplaceApps, marketplaceCategory, marketplaceSearch]);

  const categories = ['All', 'Communications', 'Commerce', 'Productivity', 'CRM', 'AI', 'Developer', 'Marketing'];

  return (
    <main className="operza-dashboard atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__heading">
          <div className="atlas-dashboard__breadcrumb">Workspace <span>/</span> App Marketplace &amp; Connectors</div>
          <h1>Integrations, App Marketplace &amp; Connectors</h1>
        </div>
        <div className="atlas-dashboard__toolbar">
          <button
            onClick={() => {
              setConnectError(null);
              setShowConnectModal(true);
            }}
            className="atlas-quick-action-button"
            type="button"
          >
            <Icon name="plus" size={13} /> Connect Provider Account
          </button>
        </div>
      </header>

      <section className="atlas-hero" style={{ marginBottom: 20 }}>
        <div className="atlas-eyebrow">INTEGRATIONS ECOSYSTEM &amp; AUTOMATION CONNECTORS</div>
        <h2>Governed API Connectors &amp; Universal Webhook Event Bus</h2>
        <p>Manage verified server-side provider credentials, communication channels (Twilio, SendGrid, Meta WhatsApp, Stripe), and bi-directional Zapier automation triggers.</p>
      </section>

      <IntegrationsHub2Panel />

      {/* KPI Overview Grid */}
      <section className="atlas-kpis" style={{ marginBottom: 24 }}>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Governed Connections</span>
            <span className="atlas-status atlas-status--healthy">Zero-Secret</span>
          </div>
          <div className="atlas-kpi__value">{connections.length}</div>
          <div className="atlas-kpi__note">Server vault secret references</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">App Marketplace</span>
            <span className="atlas-status atlas-status--healthy">Active</span>
          </div>
          <div className="atlas-kpi__value">{marketplaceApps.filter((a) => a.connected).length}/{marketplaceApps.length}</div>
          <div className="atlas-kpi__note">Verified SaaS connectors ready</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Zapier REST Hooks</span>
            <span className="atlas-status atlas-status--healthy">Certified</span>
          </div>
          <div className="atlas-kpi__value">14 Triggers</div>
          <div className="atlas-kpi__note">12 Inbound actions + 4 searches</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">HMAC Security</span>
            <span className="atlas-status atlas-status--healthy">SHA256</span>
          </div>
          <div className="atlas-kpi__value">Replay Defense</div>
          <div className="atlas-kpi__note">Signed payload verification</div>
        </article>
      </section>

      {/* Primary Tab Navigation */}
      <div className="segmented" style={{ marginBottom: 24, alignSelf: 'flex-start' }}>
        <button
          type="button"
          onClick={() => setActiveTab('connections')}
          className={activeTab === 'connections' ? 'is-active' : ''}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px' }}
        >
          <Icon name="shield" size={14} />
          Governed Provider Connections
          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 99, background: 'var(--surface-3)', fontWeight: 700 }}>
            {connections.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('marketplace')}
          className={activeTab === 'marketplace' ? 'is-active' : ''}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px' }}
        >
          <Icon name="plug" size={14} />
          App Marketplace Ecosystem
          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 99, background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 700 }}>
            {marketplaceApps.length} Apps
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('zapier')}
          className={activeTab === 'zapier' ? 'is-active' : ''}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px' }}
        >
          <Icon name="zap" size={14} />
          Zapier Universal Suite
          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 99, background: 'rgba(249, 115, 22, 0.15)', color: '#ea580c', fontWeight: 700 }}>
            14 Triggers
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('webhooks')}
          className={activeTab === 'webhooks' ? 'is-active' : ''}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px' }}
        >
          <Icon name="webhook" size={14} />
          Webhook Event Bus &amp; Logs
          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 99, background: 'var(--surface-3)', fontWeight: 700 }}>
            {zapierDeliveries.length}
          </span>
        </button>
      </div>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ─── TAB 1: GOVERNED PROVIDER CONNECTIONS ───────────────────── */}
      {/* ═════════════════════════════════════════════════════════════ */}
      {activeTab === 'connections' && (
        <div className="stack" style={{ gap: 20 }}>
          {/* Zero-Secret Security Notice */}
          <div
            style={{
              padding: '16px 20px',
              borderRadius: 12,
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              display: 'flex',
              gap: 14,
              alignItems: 'flex-start',
            }}
          >
            <div style={{ color: '#059669', marginTop: 2 }}>
              <Icon name="lock" size={20} />
            </div>
            <div>
              <strong style={{ fontSize: 13.5, color: 'var(--text)', display: 'block', marginBottom: 4 }}>
                Zero-Secret Browser Exposure Architecture
              </strong>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
                Operza never collects, transmits, or echoes raw API keys or access tokens in the frontend client. Connections bind to an opaque server-side secret reference name (resolved securely via environment variables or secret vaults). Provider verification fails closed until a trusted adapter and verified server credentials are confirmed.
              </p>
            </div>
          </div>

          {/* Configured Connections Card */}
          <div className="card" style={{ padding: 20 }}>
            <div className="row row--between" style={{ marginBottom: 16 }}>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center' }}>
                  <Icon name="shield" size={15} />
                </div>
                <strong style={{ fontSize: 14 }}>Configured Provider Connections ({connections.length})</strong>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  onClick={fetchPlatformConnections}
                  className="btn btn--sm"
                  style={{ gap: 5 }}
                >
                  <Icon name="refresh" size={12} className={connectionsLoading ? 'animate-spin' : ''} />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setShowConnectModal(true)}
                  className="btn btn--primary btn--sm"
                  style={{ gap: 5 }}
                >
                  <Icon name="plus" size={12} /> Add Connection
                </button>
              </div>
            </div>

            {connectionsLoading ? (
              <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                Loading verified provider connections...
              </div>
            ) : connections.length === 0 ? (
              <EmptyState
                icon={<Icon name="plug" size={32} />}
                title="No provider connections configured"
                text="Connect your verified SendGrid, Twilio, Resend, or WhatsApp provider accounts using server-side secret references."
                action={
                  <button
                    onClick={() => setShowConnectModal(true)}
                    className="btn btn--primary btn--sm"
                    type="button"
                  >
                    Add Connection
                  </button>
                }
              />
            ) : (
              <div className="stack" style={{ gap: 12 }}>
                {connections.map((conn) => {
                  const entry = catalog.find((c) => c.providerKey === conn.providerKey);
                  const isVerifying = verifyingId === conn.id;
                  const feedback = verificationFeedback?.id === conn.id ? verificationFeedback : null;

                  return (
                    <div
                      key={conn.id}
                      style={{
                        padding: '14px 18px',
                        background: 'var(--surface-2)',
                        border: '1px solid var(--line)',
                        borderRadius: 10,
                      }}
                    >
                      <div className="row row--between" style={{ flexWrap: 'wrap', gap: 10 }}>
                        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
                          <div
                            style={{
                              width: 38,
                              height: 38,
                              borderRadius: 8,
                              background: 'var(--surface)',
                              border: '1px solid var(--line)',
                              color: 'var(--accent)',
                              display: 'grid',
                              placeItems: 'center',
                              fontWeight: 800,
                              fontSize: 12,
                              fontFamily: 'var(--font-mono)',
                            }}
                          >
                            {conn.providerKey.slice(0, 3).toUpperCase()}
                          </div>
                          <div>
                            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              <strong style={{ fontSize: 13.5 }}>
                                {conn.label || entry?.name || conn.providerKey}
                              </strong>
                              <Badge tone="default">{conn.providerKey}</Badge>
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
                            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 3 }}>
                              ID: <code style={{ fontFamily: 'var(--font-mono)' }}>{conn.id}</code> · Created: {new Date(conn.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                        </div>

                        <div className="row" style={{ gap: 8 }}>
                          {conn.status !== 'revoked' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleVerifyConnection(conn.id)}
                                disabled={isVerifying}
                                className="btn btn--sm"
                                style={{ gap: 5 }}
                                title="Run live verification check against backend adapter"
                              >
                                <Icon name="refresh" size={12} className={isVerifying ? 'animate-spin' : ''} />
                                {isVerifying ? 'Verifying...' : 'Verify Connection'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setRevokingConnection(conn)}
                                className="btn btn--danger btn--sm"
                                style={{ gap: 5 }}
                                title="Revoke this connection"
                              >
                                <Icon name="trash" size={12} />
                                Revoke
                              </button>
                            </>
                          ) : (
                            <Badge tone="red">Revoked (Terminal)</Badge>
                          )}
                        </div>
                      </div>

                      {feedback && (
                        <div
                          style={{
                            marginTop: 12,
                            padding: '10px 14px',
                            background: 'rgba(245, 158, 11, 0.08)',
                            border: '1px solid rgba(245, 158, 11, 0.25)',
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                        >
                          <div style={{ fontWeight: 700, color: '#b45309', marginBottom: 2 }}>
                            ⚠️ Verification Failed Closed: {feedback.code}
                          </div>
                          <div style={{ color: 'var(--text-2)' }}>{feedback.error}</div>
                          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-3)', borderTop: '1px solid rgba(245, 158, 11, 0.15)', paddingTop: 4 }}>
                            Security policy: Operza does not fabricate simulated connection states. Real delivery remains safely blocked until a verified server adapter is installed.
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Supported Provider Catalog Cards */}
          <div>
            <div className="row row--between" style={{ marginBottom: 14 }}>
              <div>
                <strong style={{ fontSize: 14 }}>Supported Provider Catalog</strong>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Pre-built enterprise connectors with fail-closed security rules</div>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
                gap: 14,
              }}
            >
              {catalog.map((cat) => (
                <div
                  key={cat.providerKey}
                  className="card"
                  style={{
                    padding: 18,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 14,
                  }}
                >
                  <div className="stack" style={{ gap: 10 }}>
                    <div className="row row--between">
                      <strong style={{ fontSize: 13.5 }}>{cat.name}</strong>
                      <Badge tone={cat.category === 'payment' ? 'amber' : 'blue'}>
                        {cat.category}
                      </Badge>
                    </div>

                    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                      {cat.capabilities?.map((cap, i) => (
                        <span
                          key={i}
                          style={{
                            fontSize: 10.5,
                            padding: '2px 7px',
                            borderRadius: 4,
                            background: 'var(--surface-2)',
                            border: '1px solid var(--line)',
                            color: 'var(--text-2)',
                          }}
                        >
                          {cap}
                        </span>
                      ))}
                    </div>

                    <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                      Secret Ref: <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{cat.secretRefFormatHint}</code>
                    </div>
                  </div>

                  <div
                    className="row row--between"
                    style={{
                      paddingTop: 12,
                      borderTop: '1px solid var(--line)',
                      fontSize: 12,
                    }}
                  >
                    <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                      {cat.liveDispatch ? '● Live dispatch ready' : '○ Standby'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (cat.providerKey === 'email.microsoft_graph') {
                          window.location.assign('/api/platform/oauth/outlook/start');
                          return;
                        }
                        setSelectedProviderKey(cat.providerKey);
                        setShowConnectModal(true);
                      }}
                      className="btn btn--sm btn--primary"
                    >
                      {cat.providerKey === 'email.microsoft_graph' ? 'Connect Outlook →' : 'Connect →'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ─── TAB 2: APP MARKETPLACE ECOSYSTEM ──────────────────────── */}
      {/* ═════════════════════════════════════════════════════════════ */}
      {activeTab === 'marketplace' && (
        <div className="stack" style={{ gap: 20 }}>
          {/* Marketplace Header Controls: Search & Category Pills */}
          <div
            className="card"
            style={{
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div className="row row--between" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div>
                <strong style={{ fontSize: 14 }}>Verified Application Marketplace &amp; Ecosystem</strong>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  Browse and connect 24+ native integrations to automate your agency operations
                </div>
              </div>
              <div className="row" style={{ gap: 8, flex: '1 1 320px', maxWidth: 420 }}>
                <div className="search" style={{ width: '100%' }}>
                  <Icon name="search" size={14} className="icon" />
                  <input
                    type="text"
                    placeholder="Search integrations by name, stack, or capability..."
                    value={marketplaceSearch}
                    onChange={(e) => setMarketplaceSearch(e.target.value)}
                    className="input"
                    style={{ fontSize: 12.5 }}
                  />
                </div>
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setMarketplaceCategory(cat)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 99,
                    fontSize: 12,
                    fontWeight: 600,
                    border: '1px solid',
                    borderColor: marketplaceCategory === cat ? 'var(--accent)' : 'var(--line)',
                    background: marketplaceCategory === cat ? 'var(--accent-soft)' : 'var(--surface)',
                    color: marketplaceCategory === cat ? 'var(--accent)' : 'var(--text-2)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Marketplace Cards Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))',
              gap: 16,
            }}
          >
            {filteredMarketplaceApps.map((app) => (
              <div
                key={app.id}
                className="card"
                style={{
                  padding: 18,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 14,
                  border: app.connected ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid var(--line)',
                  boxShadow: app.connected ? '0 4px 14px rgba(16, 185, 129, 0.06)' : undefined,
                }}
              >
                <div className="stack" style={{ gap: 10 }}>
                  <div className="row row--between" style={{ alignItems: 'flex-start' }}>
                    <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                      <div
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 9,
                          background: app.accentColor || 'var(--accent)',
                          color: '#ffffff',
                          display: 'grid',
                          placeItems: 'center',
                          boxShadow: `0 4px 12px ${app.accentColor}33`,
                        }}
                      >
                        <Icon name={app.icon || 'plug'} size={18} />
                      </div>
                      <div>
                        <strong style={{ fontSize: 13.5, color: 'var(--text)', display: 'block' }}>
                          {app.name}
                        </strong>
                        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                          {app.authMethod || 'REST API'}
                        </span>
                      </div>
                    </div>
                    <StatusBadge status={app.connected ? 'active' : 'cancelled'} />
                  </div>

                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
                    {app.description}
                  </p>

                  {app.connected && app.accountName && (
                    <div
                      style={{
                        padding: '6px 10px',
                        borderRadius: 6,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--line)',
                        fontSize: 11.5,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--text)',
                      }}
                    >
                      Linked: <strong>{app.accountName}</strong>
                    </div>
                  )}
                </div>

                <div
                  className="row row--between"
                  style={{
                    paddingTop: 12,
                    borderTop: '1px solid var(--line)',
                    alignItems: 'center',
                  }}
                >
                  <Badge tone={app.category === 'Commerce' ? 'amber' : app.category === 'Communications' ? 'blue' : 'default'}>
                    {app.category}
                  </Badge>

                  <div className="row" style={{ gap: 6 }}>
                    {app.connected ? (
                      <>
                        <button
                          type="button"
                          className="btn btn--sm"
                          onClick={() => setSelectedAppForConfig(app)}
                          title="Configure account settings"
                        >
                          <Icon name="sliders" size={12} /> Configure
                        </button>
                        <button
                          type="button"
                          className="btn btn--sm btn--danger"
                          onClick={() => handleToggleMarketplaceApp(app)}
                          title="Disconnect app"
                        >
                          Disconnect
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--sm btn--primary"
                        onClick={() => setSelectedAppForConfig(app)}
                      >
                        Connect App →
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ─── TAB 3: ZAPIER UNIVERSAL PLATFORM SUITE ────────────────── */}
      {/* ═════════════════════════════════════════════════════════════ */}
      {activeTab === 'zapier' && (
        <div className="stack" style={{ gap: 20 }}>
          {/* Zapier Platform Banner & Quick Credentials */}
          <div
            className="card"
            style={{
              padding: '20px 24px',
              background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.08) 0%, rgba(245, 158, 11, 0.05) 100%)',
              border: '1px solid rgba(249, 115, 22, 0.3)',
            }}
          >
            <div className="row row--between" style={{ flexWrap: 'wrap', gap: 14, marginBottom: 16 }}>
              <div>
                <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 4 }}>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 800,
                      background: '#ea580c',
                      color: '#ffffff',
                      padding: '2px 8px',
                      borderRadius: 4,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}
                  >
                    Zapier Platform Certified
                  </span>
                  <strong style={{ fontSize: 16 }}>Universal SaaS Integration &amp; REST Hooks</strong>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', maxWidth: 740, lineHeight: 1.5 }}>
                  Connect Operza to 6,000+ external SaaS tools. Supports 14 real-time REST Hook triggers, 12 inbound actions, 4 search lookups, and HMAC-SHA256 replay defense.
                </p>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  borderRadius: 8,
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  fontSize: 12,
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: zapierAuth?.valid ? '#10b981' : '#3b82f6', boxShadow: `0 0 6px ${zapierAuth?.valid ? '#10b981' : '#3b82f6'}` }} />
                <span style={{ fontWeight: 650 }}>{zapierAuth?.valid ? `API Token Active (${zapierAuth.agencyName || 'Workspace'})` : 'REST Hooks Ready'}</span>
              </div>
            </div>

            {/* Quick Connection Credentials Row */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: 12,
                paddingTop: 14,
                borderTop: '1px solid rgba(249, 115, 22, 0.2)',
              }}
            >
              <div style={{ padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--line)' }}>
                <span style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 800, color: 'var(--text-3)', display: 'block', marginBottom: 3 }}>
                  Zapier API Base URL
                </span>
                <div className="row row--between" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>/api/v1/zapier</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(`${window.location.origin}/api/v1/zapier`, 'url')}
                    style={{ background: 'none', border: 'none', color: '#ea580c', fontWeight: 700, cursor: 'pointer', fontSize: 11 }}
                  >
                    {copiedKey === 'url' ? 'Copied!' : 'Copy URL'}
                  </button>
                </div>
              </div>

              <div style={{ padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--line)' }}>
                <span style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 800, color: 'var(--text-3)', display: 'block', marginBottom: 3 }}>
                  Authentication Header
                </span>
                <div className="row row--between" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Authorization: Bearer opz_...</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard('Authorization: Bearer <YOUR_OPERZA_API_KEY>', 'auth')}
                    style={{ background: 'none', border: 'none', color: '#ea580c', fontWeight: 700, cursor: 'pointer', fontSize: 11 }}
                  >
                    {copiedKey === 'auth' ? 'Copied!' : 'Copy Header'}
                  </button>
                </div>
              </div>

              <div style={{ padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--line)' }}>
                <span style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 800, color: 'var(--text-3)', display: 'block', marginBottom: 3 }}>
                  Webhook HMAC Signature
                </span>
                <div className="row row--between" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  <span>X-Operza-Signature (SHA256)</span>
                  <span style={{ color: '#059669', fontWeight: 700, fontSize: 11 }}>Replay-Protected</span>
                </div>
              </div>
            </div>
          </div>

          {/* Zapier Sub-Tabs */}
          <div className="segmented" style={{ alignSelf: 'flex-start' }}>
            <button
              type="button"
              onClick={() => setZapierSubTab('overview')}
              className={zapierSubTab === 'overview' ? 'is-active' : ''}
            >
              14 Triggers &amp; Schemas
            </button>
            <button
              type="button"
              onClick={() => setZapierSubTab('actions')}
              className={zapierSubTab === 'actions' ? 'is-active' : ''}
            >
              Action &amp; Search Tester
            </button>
            <button
              type="button"
              onClick={() => setZapierSubTab('connectors')}
              className={zapierSubTab === 'connectors' ? 'is-active' : ''}
            >
              Universal Connectors ({UNIVERSAL_CONNECTORS.length})
            </button>
            <button
              type="button"
              onClick={() => setZapierSubTab('templates')}
              className={zapierSubTab === 'templates' ? 'is-active' : ''}
            >
              1-Click Zap Recipes
            </button>
          </div>

          {/* Sub-Tab 1: Triggers & Schema Explorer */}
          {zapierSubTab === 'overview' && (
            <div className="card" style={{ padding: 20 }}>
              <div className="row row--between" style={{ flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                <div>
                  <strong style={{ fontSize: 14 }}>Live Zapier performList Schema &amp; Trigger Samples</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    Select any of the 14 real-time triggers to inspect canonical schemas sent to Zapier.
                  </div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <select
                    value={selectedSampleEvent}
                    onChange={(e) => setSelectedSampleEvent(e.target.value)}
                    className="select"
                    style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}
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
                    className="btn btn--sm"
                    style={{ gap: 4 }}
                  >
                    <Icon name="refresh" size={12} className={sampleLoading ? 'animate-spin' : ''} />
                    Refresh
                  </button>
                </div>
              </div>

              {sampleLoading ? (
                <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                  Loading canonical payload schema...
                </div>
              ) : samplePayload ? (
                <div className="stack" style={{ gap: 8 }}>
                  <div className="row row--between" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    <span>Canonical Zapier performList Data Format:</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(JSON.stringify(samplePayload, null, 2), 'sampleJson')}
                      style={{ background: 'none', border: 'none', color: '#ea580c', fontWeight: 700, cursor: 'pointer', fontSize: 11 }}
                    >
                      {copiedKey === 'sampleJson' ? 'Copied JSON!' : 'Copy Sample Payload'}
                    </button>
                  </div>
                  <pre
                    style={{
                      padding: 14,
                      background: '#0f172a',
                      color: '#34d399',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      borderRadius: 8,
                      overflowX: 'auto',
                      maxHeight: 260,
                      margin: 0,
                    }}
                  >
                    {JSON.stringify(samplePayload, null, 2)}
                  </pre>
                </div>
              ) : (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                  No sample records available.
                </div>
              )}
            </div>
          )}

          {/* Sub-Tab 2: Inbound Action & Search Testing Playground */}
          {zapierSubTab === 'actions' && (
            <div className="card" style={{ padding: 20 }}>
              <div style={{ marginBottom: 16 }}>
                <strong style={{ fontSize: 14 }}>Zapier Inbound Action &amp; Search Testing Playground</strong>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  Simulate live inbound Zapier actions and searches directly against your workspace tenant API.
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                  gap: 18,
                }}
              >
                <div className="stack" style={{ gap: 12 }}>
                  <div className="field">
                    <label>Target Zapier Operation (12 Actions + 4 Searches)</label>
                    <select
                      value={testActionKey}
                      onChange={(e) => handleActionPresetChange(e.target.value)}
                      className="select"
                      style={{ fontSize: 12.5, fontFamily: 'var(--font-mono)' }}
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

                  <div className="field">
                    <label>JSON Input Payload</label>
                    <textarea
                      rows={8}
                      value={testActionData}
                      onChange={(e) => setTestActionData(e.target.value)}
                      className="textarea"
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                    />
                  </div>

                  <button
                    type="button"
                    disabled={testActionLoading}
                    onClick={handleRunTestAction}
                    className="btn btn--primary"
                    style={{ gap: 8, fontWeight: 700 }}
                  >
                    <Icon name="play" size={13} className={testActionLoading ? 'animate-spin' : ''} />
                    {testActionLoading ? 'Executing via Zapier Platform...' : `Execute ${testActionKey}`}
                  </button>
                </div>

                <div className="stack" style={{ gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
                    Execution Response Output
                  </label>
                  {testActionResult ? (
                    <pre
                      style={{
                        padding: 14,
                        background: '#0f172a',
                        color: '#34d399',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12,
                        borderRadius: 8,
                        overflowX: 'auto',
                        minHeight: 220,
                        margin: 0,
                      }}
                    >
                      {JSON.stringify(testActionResult, null, 2)}
                    </pre>
                  ) : (
                    <div
                      style={{
                        padding: 30,
                        border: '1px dashed var(--line)',
                        borderRadius: 8,
                        textAlign: 'center',
                        fontSize: 12.5,
                        color: 'var(--text-3)',
                        minHeight: 220,
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      Select an action preset and click "Execute" to inspect the live response.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Sub-Tab 3: Universal Connectors Catalog */}
          {zapierSubTab === 'connectors' && (
            <div className="stack" style={{ gap: 16 }}>
              <div className="row row--between" style={{ flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <strong style={{ fontSize: 14 }}>Universal App Connectors Catalog ({UNIVERSAL_CONNECTORS.length})</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    Pre-configured app connector schemas ready for visual workflows and Zapier REST hook dispatches.
                  </div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Search connectors..."
                    value={connectorSearch}
                    onChange={(e) => setConnectorSearch(e.target.value)}
                    className="input"
                    style={{ width: 180, fontSize: 12 }}
                  />
                  <select
                    value={connectorCategory}
                    onChange={(e) => setConnectorCategory(e.target.value)}
                    className="select"
                    style={{ fontSize: 12 }}
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

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                  gap: 14,
                }}
              >
                {UNIVERSAL_CONNECTORS
                  .filter((c) => connectorCategory === 'All' || c.category === connectorCategory)
                  .filter((c) => !connectorSearch || c.name.toLowerCase().includes(connectorSearch.toLowerCase()) || c.category.toLowerCase().includes(connectorSearch.toLowerCase()))
                  .map((conn) => (
                    <div key={conn.id} className="card" style={{ padding: 16 }}>
                      <div className="row row--between" style={{ marginBottom: 10 }}>
                        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 6,
                              background: 'rgba(249, 115, 22, 0.12)',
                              color: '#ea580c',
                              display: 'grid',
                              placeItems: 'center',
                              fontWeight: 800,
                              fontSize: 12,
                            }}
                          >
                            {conn.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <strong style={{ fontSize: 13, color: 'var(--text)', display: 'block' }}>{conn.name}</strong>
                            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{conn.category}</span>
                          </div>
                        </div>
                        <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', padding: '2px 6px', borderRadius: 4, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                          {conn.auth}
                        </span>
                      </div>

                      <div className="stack" style={{ gap: 6, fontSize: 11.5 }}>
                        <div>
                          <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 700, display: 'block' }}>Triggers:</span>
                          <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                            {conn.triggers.map((t) => (
                              <span key={t} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'rgba(59, 130, 246, 0.08)', color: '#2563eb' }}>
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 700, display: 'block' }}>Actions:</span>
                          <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                            {conn.actions.map((a) => (
                              <span key={a} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'rgba(16, 185, 129, 0.08)', color: '#059669' }}>
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

          {/* Sub-Tab 4: Pre-Built Zap Recipes */}
          {zapierSubTab === 'templates' && (
            <div className="stack" style={{ gap: 14 }}>
              <div>
                <strong style={{ fontSize: 14 }}>Popular Pre-Built Zapier Recipes</strong>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  Ready-to-deploy Zapier integrations pairing Operza with popular external apps.
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                  gap: 14,
                }}
              >
                <div className="card" style={{ padding: 18, borderLeft: '4px solid #10b981' }}>
                  <div className="row row--between" style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#059669' }}>Google Sheets ➔ Operza</span>
                    <Badge tone="default">Lead Capture</Badge>
                  </div>
                  <strong style={{ fontSize: 13.5, display: 'block', marginBottom: 4 }}>
                    New Spreadsheet Row ➔ Create Contact &amp; Start Onboarding Flow
                  </strong>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
                    When a new row is added to your lead spreadsheet, immediately creates a contact in Operza and launches an email sequence.
                  </p>
                </div>

                <div className="card" style={{ padding: 18, borderLeft: '4px solid #6366f1' }}>
                  <div className="row row--between" style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#4f46e5' }}>Stripe ➔ Operza</span>
                    <Badge tone="default">Sales &amp; Revenue</Badge>
                  </div>
                  <strong style={{ fontSize: 13.5, display: 'block', marginBottom: 4 }}>
                    Payment Succeeded ➔ Move Opportunity to Closed-Won &amp; Issue Portal Access
                  </strong>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
                    When a Stripe payment is processed, updates the sales pipeline deal to Won, grants Client Portal access, and notifies the team.
                  </p>
                </div>

                <div className="card" style={{ padding: 18, borderLeft: '4px solid #ea580c' }}>
                  <div className="row row--between" style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#ea580c' }}>Operza ➔ Slack &amp; Discord</span>
                    <Badge tone="default">Team Alerts</Badge>
                  </div>
                  <strong style={{ fontSize: 13.5, display: 'block', marginBottom: 4 }}>
                    Appointment Booked ➔ Post Rich Slack Notification to #sales
                  </strong>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
                    Dispatches scheduled strategy call details to your internal Slack or Discord channels with one-click contact review links.
                  </p>
                </div>

                <div className="card" style={{ padding: 18, borderLeft: '4px solid #3b82f6' }}>
                  <div className="row row--between" style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#2563eb' }}>Meta Ads ➔ Operza</span>
                    <Badge tone="default">Paid Acquisition</Badge>
                  </div>
                  <strong style={{ fontSize: 13.5, display: 'block', marginBottom: 4 }}>
                    Facebook Lead Ads Submission ➔ Inbound Contact &amp; SMS Confirmation
                  </strong>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
                    Instantly syncs lead form submissions from Instagram and Facebook into Operza contacts with sub-second SMS follow-ups.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ─── TAB 4: WEBHOOK EVENT BUS & DELIVERY LOGS ──────────────── */}
      {/* ═════════════════════════════════════════════════════════════ */}
      {activeTab === 'webhooks' && (
        <div className="stack" style={{ gap: 20 }}>
          {/* Test Hook Ping Dispatcher Card */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ marginBottom: 14 }}>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <Icon name="send" size={16} />
                <strong style={{ fontSize: 14 }}>Send Live Signed Test Ping to Webhook Catch URL</strong>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-2)' }}>
                Dispatches a real-time HMAC-SHA256 signed event payload to verify end-to-end delivery into your Zap catch hook or custom webhook receiver.
              </p>
            </div>

            <form onSubmit={handleTestPing} className="stack" style={{ gap: 12 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: 12,
                }}
              >
                <div className="field">
                  <label htmlFor="test-hook-url">Webhook Catch Endpoint URL (HTTPS required) *</label>
                  <input
                    id="test-hook-url"
                    type="url"
                    required
                    value={testWebhookUrl}
                    onChange={(e) => setTestWebhookUrl(e.target.value)}
                    placeholder="https://hooks.zapier.com/hooks/catch/..."
                    className="input"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="test-hook-event">Trigger Event Schema</label>
                  <select
                    id="test-hook-event"
                    value={testWebhookEvent}
                    onChange={(e) => setTestWebhookEvent(e.target.value)}
                    className="select"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
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
                className="btn btn--primary"
                style={{ alignSelf: 'flex-start', gap: 6 }}
              >
                <Icon name="zap" size={13} className={testWebhookLoading ? 'animate-spin' : ''} />
                {testWebhookLoading ? 'Dispatching...' : 'Send Signed Test Ping'}
              </button>
            </form>

            {testWebhookResult && (
              <div
                style={{
                  marginTop: 14,
                  padding: 12,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
              >
                <strong>Ping Delivery Output:</strong>
                <pre
                  style={{
                    margin: '6px 0 0',
                    color: '#059669',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11.5,
                    overflowX: 'auto',
                  }}
                >
                  {JSON.stringify(testWebhookResult, null, 2)}
                </pre>
              </div>
            )}
          </div>

          {/* Active Subscriptions Table Card */}
          <div className="card" style={{ padding: 20 }}>
            <div className="row row--between" style={{ marginBottom: 14 }}>
              <div>
                <strong style={{ fontSize: 14 }}>Active REST Hook Subscriptions ({zapierSubscriptions.length})</strong>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Registered webhook endpoints receiving live workspace events</div>
              </div>
              <button
                type="button"
                onClick={fetchSubscriptions}
                className="btn btn--sm"
                style={{ gap: 4 }}
              >
                <Icon name="refresh" size={12} className={subsLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>

            {subsLoading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 12.5 }}>
                Loading subscriptions...
              </div>
            ) : zapierSubscriptions.length === 0 ? (
              <div
                style={{
                  padding: 30,
                  border: '1px dashed var(--line)',
                  borderRadius: 8,
                  textAlign: 'center',
                  fontSize: 12.5,
                  color: 'var(--text-3)',
                }}
              >
                No active Zapier REST hook subscriptions yet. Create a Zap using Operza triggers to automatically register subscriptions.
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Subscription ID</th>
                      <th>Event</th>
                      <th>Target Catch URL</th>
                      <th>Status</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zapierSubscriptions.map((sub) => (
                      <tr key={sub.id}>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#ea580c' }}>{sub.id}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{sub.event}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {sub.targetUrl}
                        </td>
                        <td>
                          <Badge tone={sub.status === 'active' ? 'green' : 'default'}>{sub.status}</Badge>
                        </td>
                        <td style={{ color: 'var(--text-3)', fontSize: 11.5 }}>
                          {new Date(sub.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Outbound Event Deliveries Audit Trail */}
          <div className="card" style={{ padding: 20 }}>
            <div className="row row--between" style={{ marginBottom: 14 }}>
              <div>
                <strong style={{ fontSize: 14 }}>Zapier Outbound Event Delivery Logs ({zapierDeliveries.length})</strong>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  Real-time audit log of all REST hook dispatches, HMAC signatures, HTTP status codes, and latency.
                </div>
              </div>
              <button
                type="button"
                onClick={fetchDeliveries}
                className="btn btn--sm"
                style={{ gap: 4 }}
              >
                <Icon name="refresh" size={12} className={deliveriesLoading ? 'animate-spin' : ''} />
                Refresh Logs
              </button>
            </div>

            {deliveriesLoading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 12.5 }}>
                Loading delivery logs...
              </div>
            ) : zapierDeliveries.length === 0 ? (
              <div
                style={{
                  padding: 30,
                  border: '1px dashed var(--line)',
                  borderRadius: 8,
                  textAlign: 'center',
                  fontSize: 12.5,
                  color: 'var(--text-3)',
                }}
              >
                No outbound events delivered yet. Triggers and test pings will appear here immediately.
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Delivery ID</th>
                      <th>Event</th>
                      <th>HTTP Status</th>
                      <th>Delivered At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zapierDeliveries.map((deliv) => (
                      <tr key={deliv.id}>
                        <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{deliv.id}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 600 }}>{deliv.event}</td>
                        <td>
                          <Badge tone={deliv.httpStatus >= 200 && deliv.httpStatus < 300 ? 'green' : 'red'}>
                            HTTP {deliv.httpStatus}
                          </Badge>
                        </td>
                        <td style={{ color: 'var(--text-3)', fontSize: 11.5 }}>
                          {new Date(deliv.deliveredAt).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ─── MODAL 1: CONNECT PROVIDER ACCOUNT (SERVER VAULT) ──────── */}
      {/* ═════════════════════════════════════════════════════════════ */}
      {showConnectModal && (
        <Modal
          title="Connect Governed Provider Account"
          onClose={() => setShowConnectModal(false)}
        >
          <form onSubmit={handleCreateConnection} className="stack" style={{ gap: 14 }}>
            {connectError && (
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  color: '#dc2626',
                  fontSize: 12,
                }}
              >
                {connectError}
              </div>
            )}

            <div className="field">
              <label htmlFor="conn-provider-type">Provider Type *</label>
              <select
                id="conn-provider-type"
                value={selectedProviderKey}
                onChange={(e) => setSelectedProviderKey(e.target.value)}
                className="select"
              >
                {catalog.map((c) => (
                  <option key={c.providerKey} value={c.providerKey}>
                    {c.name} ({c.category})
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="conn-display-label">Display Label</label>
              <input
                id="conn-display-label"
                type="text"
                value={connectionLabelInput}
                onChange={(e) => setConnectionLabelInput(e.target.value)}
                placeholder="e.g. Primary Agency SendGrid Relay"
                className="input"
              />
            </div>

            <div className="field">
              <label htmlFor="conn-secret-ref">Server-Side Secret Reference Name *</label>
              <input
                id="conn-secret-ref"
                type="text"
                required
                value={secretRefInput}
                onChange={(e) => setSecretRefInput(e.target.value)}
                placeholder={selectedCatalogEntry?.secretRefFormatHint || 'e.g. SENDGRID_API_KEY'}
                className="input"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
              <span className="hint" style={{ color: '#b45309', marginTop: 4 }}>
                ⚠️ Security: Enter only the name of the environment variable or vault reference. Never type or paste raw API secrets into this field.
              </span>
            </div>

            {selectedCatalogEntry?.requiredConfigFields && selectedCatalogEntry.requiredConfigFields.length > 0 && (
              <div className="stack" style={{ gap: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>Configuration Fields:</span>
                {selectedCatalogEntry.requiredConfigFields.map((field) => (
                  <div key={field} className="field">
                    <label style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{field}</label>
                    <input
                      type="text"
                      value={configInputs[field] || ''}
                      onChange={(e) => setConfigInputs({ ...configInputs, [field]: e.target.value })}
                      placeholder={`Value for ${field}`}
                      className="input"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
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
                className="btn btn--primary btn--sm"
              >
                {connectSaving ? 'Saving Reference...' : 'Save Provider Reference'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ─── MODAL 2: REVOKE PROVIDER CONNECTION ───────────────────── */}
      {/* ═════════════════════════════════════════════════════════════ */}
      {revokingConnection && (
        <Modal
          title="Revoke Provider Connection"
          onClose={() => setRevokingConnection(null)}
        >
          <div className="stack" style={{ gap: 14 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)' }}>
              Are you sure you want to revoke the connection for{' '}
              <strong>{revokingConnection.label || revokingConnection.providerKey}</strong>?
            </p>
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                color: '#b91c1c',
                fontSize: 12,
              }}
            >
              Revocation is terminal. The connection status will become <code style={{ fontFamily: 'var(--font-mono)' }}>revoked</code> and any workflows relying on this provider will be safely blocked from dispatching.
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
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
                className="btn btn--danger btn--sm"
              >
                {connectSaving ? 'Revoking...' : 'Confirm Revocation'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ─── MODAL 3: MARKETPLACE APP CONFIGURATION & TESTING ──────── */}
      {/* ═════════════════════════════════════════════════════════════ */}
      {selectedAppForConfig && (
        <Modal
          title={`Configure Integration · ${selectedAppForConfig.name}`}
          onClose={() => setSelectedAppForConfig(null)}
        >
          <div className="stack" style={{ gap: 16 }}>
            <div className="row" style={{ gap: 12, alignItems: 'center' }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: selectedAppForConfig.accentColor || 'var(--accent)',
                  color: '#ffffff',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Icon name={selectedAppForConfig.icon || 'plug'} size={22} />
              </div>
              <div>
                <strong style={{ fontSize: 15 }}>{selectedAppForConfig.name}</strong>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {selectedAppForConfig.category} · {selectedAppForConfig.authMethod || 'REST API'}
                </div>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
              {selectedAppForConfig.description}
            </p>

            <div
              style={{
                padding: 14,
                borderRadius: 8,
                background: 'var(--surface-2)',
                border: '1px solid var(--line)',
              }}
            >
              <div className="row row--between" style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>Connection Status</span>
                <StatusBadge status={selectedAppForConfig.connected ? 'active' : 'cancelled'} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {selectedAppForConfig.connected
                  ? `Active account: ${selectedAppForConfig.accountName || 'Primary Workspace'}`
                  : 'Currently disconnected. Click below to authorize or activate.'}
              </div>
            </div>

            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <button
                type="button"
                onClick={() => setSelectedAppForConfig(null)}
                className="btn btn--sm"
              >
                Close
              </button>
              <button
                type="button"
                className={`btn btn--sm ${selectedAppForConfig.connected ? 'btn--danger' : 'btn--primary'}`}
                onClick={() => handleToggleMarketplaceApp(selectedAppForConfig)}
              >
                {selectedAppForConfig.connected ? 'Disconnect App' : 'Authorize & Connect'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
