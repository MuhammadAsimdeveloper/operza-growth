import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, uid } from '../lib/store';
import { api } from '../lib/api';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState } from '../components/ui';
import { relative } from '../lib/format';

type NotificationCategory = 'all' | 'unread' | 'workflow' | 'copilot' | 'telephony' | 'security';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  read: boolean;
  at: string;
  category?: 'workflow' | 'copilot' | 'telephony' | 'security' | 'general';
  link?: string;
  metadata?: Record<string, any>;
}

export default function NotificationCenter() {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const [selectedCategory, setSelectedCategory] = useState<NotificationCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [inspectingItem, setInspectingItem] = useState<NotificationItem | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Sync with backend notification endpoints on load
  useEffect(() => {
    api.notifications
      .list()
      .then((res) => {
        const items = res?.data || [];
        if (Array.isArray(items) && items.length > 0) {
          for (const item of items) {
            dispatch({
              type: 'notification/add',
              notification: {
                id: item.id,
                title: item.title,
                body: item.message,
                read: Boolean(item.read),
                at: item.createdAt || new Date().toISOString(),
              },
            });
          }
        }
      })
      .catch(() => {});
  }, [dispatch]);

  // Infer rich category and link if not already stored
  const notifications: NotificationItem[] = useMemo(() => {
    return state.notifications.map((n) => {
      const titleLower = (n.title || '').toLowerCase();
      const bodyLower = (n.body || '').toLowerCase();

      let category: NotificationItem['category'] = 'general';
      let link: string | undefined;

      if (titleLower.includes('workflow') || bodyLower.includes('workflow') || bodyLower.includes('step') || bodyLower.includes('trigger')) {
        category = 'workflow';
        link = '/workflows';
      } else if (titleLower.includes('copilot') || titleLower.includes('ai') || bodyLower.includes('proposal') || bodyLower.includes('swarm')) {
        category = 'copilot';
        link = '/copilot-inbox';
      } else if (titleLower.includes('call') || titleLower.includes('sms') || titleLower.includes('phone') || bodyLower.includes('voip') || bodyLower.includes('webrtc')) {
        category = 'telephony';
        link = '/phone';
      } else if (titleLower.includes('security') || titleLower.includes('rls') || titleLower.includes('auth') || bodyLower.includes('isolation') || bodyLower.includes('audit')) {
        category = 'security';
        link = '/audit-log';
      }

      return {
        ...n,
        category,
        link,
      };
    });
  }, [state.notifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const workflowCount = notifications.filter((n) => n.category === 'workflow').length;
  const copilotCount = notifications.filter((n) => n.category === 'copilot').length;
  const telephonyCount = notifications.filter((n) => n.category === 'telephony').length;
  const securityCount = notifications.filter((n) => n.category === 'security').length;

  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => {
      // Category filter
      if (selectedCategory === 'unread' && n.read) return false;
      if (selectedCategory === 'workflow' && n.category !== 'workflow') return false;
      if (selectedCategory === 'copilot' && n.category !== 'copilot') return false;
      if (selectedCategory === 'telephony' && n.category !== 'telephony') return false;
      if (selectedCategory === 'security' && n.category !== 'security') return false;

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = (n.title || '').toLowerCase().includes(query);
        const matchesBody = (n.body || '').toLowerCase().includes(query);
        return matchesTitle || matchesBody;
      }

      return true;
    });
  }, [notifications, selectedCategory, searchQuery]);

  const handleMarkAllRead = () => {
    dispatch({ type: 'notifications/readAll' });
    setFeedback('All notifications marked as read.');
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleClearRead = () => {
    dispatch({ type: 'notifications/clearRead' });
    setFeedback('All read notifications cleared.');
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleSimulateAlert = () => {
    const alertId = uid('notif');
    const alerts = [
      {
        title: 'Workflow Trigger Executed',
        body: 'Lead Nurture Flow executed successfully for Alice Morgan (24ms duration, Redis queue green).',
        category: 'workflow' as const,
        link: '/workflows',
      },
      {
        title: 'AI Copilot Proposal Ready',
        body: 'Copilot generated an automated email response to inquiry regarding Enterprise Tier SLA.',
        category: 'copilot' as const,
        link: '/copilot-inbox',
      },
      {
        title: 'Inbound WebRTC Call Queued',
        body: 'New voice caller connected to Softphone routing queue: +1 (555) 019-2834.',
        category: 'telephony' as const,
        link: '/phone',
      },
      {
        title: 'PostgreSQL RLS Audit Verified',
        body: 'Row-Level Security boundary check verified across 14 tenant sub-accounts. 0 leaks detected.',
        category: 'security' as const,
        link: '/audit-log',
      },
    ];

    const chosen = alerts[Math.floor(Math.random() * alerts.length)];
    dispatch({
      type: 'notification/add',
      notification: {
        id: alertId,
        title: chosen.title,
        body: chosen.body,
        read: false,
        at: new Date().toISOString(),
      },
    });
    setFeedback(`Simulated new ${chosen.category} alert.`);
    setTimeout(() => setFeedback(null), 3000);
  };

  const getCategoryIcon = (category?: string) => {
    switch (category) {
      case 'workflow':
        return 'zap';
      case 'copilot':
        return 'sparkles';
      case 'telephony':
        return 'phone';
      case 'security':
        return 'shield';
      default:
        return 'bell';
    }
  };

  const getCategoryTone = (category?: string): 'green' | 'amber' | 'red' | 'default' => {
    switch (category) {
      case 'workflow':
        return 'green';
      case 'copilot':
        return 'default';
      case 'telephony':
        return 'amber';
      case 'security':
        return 'green';
      default:
        return 'default';
    }
  };

  return (
    <main className="operza-dashboard atlas-dashboard">
      {/* Top Banner Feedback */}
      {feedback && (
        <div className="atlas-workflow-feedback" role="status">
          {feedback}
        </div>
      )}

      {/* Header */}
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__heading">
          <div className="atlas-dashboard__breadcrumb">Workspace <span>/</span> Real-Time Feeds</div>
          <h1>Notification Center</h1>
        </div>
        <div className="atlas-dashboard__toolbar">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={handleSimulateAlert}
            title="Dispatch a live test notification"
          >
            <Icon name="plus" size={13} /> Simulate Test Alert
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={handleClearRead}
            disabled={notifications.filter((n) => n.read).length === 0}
            title="Remove all notifications that have been read"
          >
            <Icon name="trash" size={13} /> Clear Read
          </button>
          <button
            type="button"
            className="atlas-quick-action-button"
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
          >
            <Icon name="check-circle" size={13} /> Mark All Read
          </button>
        </div>
      </header>

      {/* Hero Overview */}
      <section className="atlas-hero">
        <div className="atlas-eyebrow">COMMAND TELEMETRY &amp; ALERT STREAM</div>
        <h2>Enterprise Notification &amp; Activity Center</h2>
        <p>
          Real-time event stream monitoring automation executions, AI agent proposals, inbound
          telephony lines, tenant isolation audits, and customer communication status.
        </p>
      </section>

      {/* KPIs Bar */}
      <section className="atlas-kpis" aria-label="Notification statistics">
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Unread Alerts</span>
            <span className={`atlas-status ${unreadCount > 0 ? 'atlas-status--warning' : 'atlas-status--healthy'}`}>
              {unreadCount > 0 ? `${unreadCount} Action Required` : 'Clear'}
            </span>
          </div>
          <div className="atlas-kpi__value">{unreadCount}</div>
          <div className="atlas-kpi__note">Pending operator attention</div>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Total Notifications</span>
            <span className="atlas-status atlas-status--healthy">Tracked</span>
          </div>
          <div className="atlas-kpi__value">{notifications.length}</div>
          <div className="atlas-kpi__note">Historical event records</div>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Workflow Events</span>
            <span className="atlas-status atlas-status--healthy">Automated</span>
          </div>
          <div className="atlas-kpi__value">{workflowCount}</div>
          <div className="atlas-kpi__note">Durable state machine alerts</div>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">AI &amp; Security</span>
            <span className="atlas-status atlas-status--healthy">Isolated</span>
          </div>
          <div className="atlas-kpi__value">{copilotCount + securityCount}</div>
          <div className="atlas-kpi__note">Copilot proposals &amp; RLS shields</div>
        </article>
      </section>

      {/* Filter and Search Bar */}
      <div
        className="card"
        style={{
          marginTop: 22,
          padding: '12px 16px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        {/* Category Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn btn--sm ${selectedCategory === 'all' ? 'btn--primary' : 'btn--subtle'}`}
            onClick={() => setSelectedCategory('all')}
          >
            All ({notifications.length})
          </button>
          <button
            type="button"
            className={`btn btn--sm ${selectedCategory === 'unread' ? 'btn--primary' : 'btn--subtle'}`}
            onClick={() => setSelectedCategory('unread')}
          >
            Unread ({unreadCount})
          </button>
          <button
            type="button"
            className={`btn btn--sm ${selectedCategory === 'workflow' ? 'btn--primary' : 'btn--subtle'}`}
            onClick={() => setSelectedCategory('workflow')}
          >
            <Icon name="zap" size={13} /> Workflows ({workflowCount})
          </button>
          <button
            type="button"
            className={`btn btn--sm ${selectedCategory === 'copilot' ? 'btn--primary' : 'btn--subtle'}`}
            onClick={() => setSelectedCategory('copilot')}
          >
            <Icon name="sparkles" size={13} /> AI Copilot ({copilotCount})
          </button>
          <button
            type="button"
            className={`btn btn--sm ${selectedCategory === 'telephony' ? 'btn--primary' : 'btn--subtle'}`}
            onClick={() => setSelectedCategory('telephony')}
          >
            <Icon name="phone" size={13} /> Comms ({telephonyCount})
          </button>
          <button
            type="button"
            className={`btn btn--sm ${selectedCategory === 'security' ? 'btn--primary' : 'btn--subtle'}`}
            onClick={() => setSelectedCategory('security')}
          >
            <Icon name="shield" size={13} /> Security ({securityCount})
          </button>
        </div>

        {/* Live Search Input */}
        <div style={{ position: 'relative', width: 260 }}>
          <input
            type="text"
            className="input"
            style={{ width: '100%', paddingLeft: 30, fontSize: 12.5 }}
            placeholder="Search alerts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', opacity: 0.5, pointerEvents: 'none' }}>
            <Icon name="search" size={13} />
          </span>
          {searchQuery && (
            <button
              type="button"
              className="icon-btn"
              style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', padding: 2 }}
              onClick={() => setSearchQuery('')}
            >
              <Icon name="x" size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Main Notifications Stream */}
      <section style={{ marginTop: 14 }}>
        {filteredNotifications.length === 0 ? (
          <div className="card" style={{ padding: 48, textAlign: 'center' }}>
            <EmptyState
              icon={<Icon name="bell" size={28} />}
              title="No notifications in this view"
              text={
                searchQuery
                  ? `No alerts match your filter "${searchQuery}".`
                  : selectedCategory === 'unread'
                  ? "You're all caught up! No unread notifications require attention."
                  : 'No notification telemetry recorded for this channel.'
              }
            />
          </div>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {filteredNotifications.map((item) => {
              const iconName = getCategoryIcon(item.category);
              const badgeTone = getCategoryTone(item.category);

              return (
                <div
                  key={item.id}
                  className="card"
                  style={{
                    padding: '16px 20px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 16,
                    borderLeft: item.read ? undefined : '4px solid var(--accent, #6366f1)',
                    background: item.read ? 'var(--surface)' : 'var(--accent-soft, rgba(99, 102, 241, 0.05))',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {/* Left Icon */}
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      background: item.read ? 'var(--surface-2)' : 'rgba(99, 102, 241, 0.15)',
                      color: item.read ? 'var(--text-3)' : 'var(--accent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      border: '1px solid var(--border)',
                    }}
                  >
                    <Icon name={iconName} size={18} />
                  </div>

                  {/* Body Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
                        {item.title}
                      </span>
                      {!item.read && (
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: 'var(--accent, #6366f1)',
                            boxShadow: '0 0 6px var(--accent)',
                          }}
                        />
                      )}
                      <Badge tone={badgeTone}>
                        {item.category ? item.category.toUpperCase() : 'ALERT'}
                      </Badge>
                      <span className="cell-sub" style={{ fontSize: 11.5, marginLeft: 'auto' }}>
                        {relative(item.at)}
                      </span>
                    </div>

                    <div
                      style={{
                        fontSize: 13,
                        color: 'var(--text-2)',
                        marginTop: 6,
                        lineHeight: 1.5,
                      }}
                    >
                      {item.body}
                    </div>

                    {/* Quick Destination Link & Context Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                      {item.link && (
                        <button
                          type="button"
                          className="btn btn--subtle btn--xs"
                          style={{ fontSize: 11.5, fontWeight: 600 }}
                          onClick={() => navigate(item.link!)}
                        >
                          <Icon name="share" size={11} /> Open Destination ({item.link})
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--ghost btn--xs"
                        style={{ fontSize: 11.5 }}
                        onClick={() => setInspectingItem(item)}
                      >
                        <Icon name="search" size={11} /> Inspect Event Payload
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--xs"
                        style={{ fontSize: 11.5 }}
                        onClick={() => {
                          if (item.read) {
                            dispatch({ type: 'notification/unread', id: item.id });
                          } else {
                            dispatch({ type: 'notifications/read', id: item.id });
                          }
                        }}
                      >
                        {item.read ? 'Mark Unread' : 'Mark as Read'}
                      </button>
                    </div>
                  </div>

                  {/* Right Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Dismiss notification"
                      onClick={() => dispatch({ type: 'notifications/delete', id: item.id })}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Inspect Notification Detail Modal */}
      {inspectingItem && (
        <Modal
          title={inspectingItem.title}
          onClose={() => setInspectingItem(null)}
        >
          <div className="stack" style={{ gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Badge tone={getCategoryTone(inspectingItem.category)}>
                {inspectingItem.category?.toUpperCase() || 'GENERAL'} EVENT
              </Badge>
              <span className="cell-sub" style={{ fontSize: 12 }}>
                {new Date(inspectingItem.at).toLocaleString()}
              </span>
            </div>

            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontWeight: 650, fontSize: 13, marginBottom: 4 }}>Message Content</div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
                {inspectingItem.body}
              </p>
            </div>

            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontWeight: 650, fontSize: 13, marginBottom: 6, color: 'var(--accent)' }}>
                TELEMETRY &amp; EVENT METADATA
              </div>
              <pre
                style={{
                  margin: 0,
                  fontSize: 11.5,
                  fontFamily: 'monospace',
                  background: 'var(--bg-subtle, rgba(0,0,0,0.04))',
                  padding: 10,
                  borderRadius: 6,
                  maxHeight: 180,
                  overflowY: 'auto',
                }}
              >
                {JSON.stringify(
                  {
                    eventId: inspectingItem.id,
                    channel: inspectingItem.category || 'system',
                    status: inspectingItem.read ? 'read' : 'delivered',
                    timestamp: inspectingItem.at,
                    destinationRoute: inspectingItem.link || null,
                    telemetryNode: 'us-east-cluster-01',
                    rlsTenantScope: 'tenant_agency_primary',
                    durableQueue: 'bullmq_notifications',
                  },
                  null,
                  2
                )}
              </pre>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              {inspectingItem.link && (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    const l = inspectingItem.link!;
                    setInspectingItem(null);
                    navigate(l);
                  }}
                >
                  <Icon name="share" size={13} /> Navigate to {inspectingItem.link}
                </button>
              )}
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setInspectingItem(null)}
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
