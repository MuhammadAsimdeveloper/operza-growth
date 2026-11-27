import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { num, pct, relative } from '../lib/format';
import { Icon } from './Icon';
import { Avatar, Badge, EmptyState } from './ui';

const INBOX_VIEWS = [
  { id: 'all', label: 'All Conversations' },
  { id: 'assigned_to_me', label: 'Assigned to Me' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'open', label: 'Open' },
  { id: 'pending', label: 'Pending' },
  { id: 'waiting_on_customer', label: 'Waiting on Customer' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'closed', label: 'Closed' },
  { id: 'high_priority', label: 'High Priority' },
  { id: 'overdue_sla', label: 'Overdue SLA' },
] as const;

const PRIORITY_TONE: Record<string, 'default' | 'blue' | 'amber' | 'red'> = {
  low: 'default',
  normal: 'blue',
  high: 'amber',
  urgent: 'red',
};

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'default'> = {
  open: 'blue',
  pending: 'amber',
  waiting_on_customer: 'amber',
  waiting_on_internal: 'amber',
  resolved: 'green',
  closed: 'default',
};

export function SupportInbox2Panel({ fallbackConversations = [] }: { fallbackConversations?: any[] }) {
  const [view, setView] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [offset, setOffset] = useState<number>(0);
  const limit = 20;

  const [metrics, setMetrics] = useState<any | null>(null);
  const [channels, setChannels] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [savedReplies, setSavedReplies] = useState<any[]>([]);
  const [listData, setListData] = useState<{ items: any[]; total: number }>({ items: [], total: 0 });
  const [loadingList, setLoadingList] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [customer360, setCustomer360] = useState<any | null>(null);
  const [composerMode, setComposerMode] = useState<'public_reply' | 'internal_note'>('public_reply');
  const [composerBody, setComposerBody] = useState<string>('');
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'green' | 'amber' | 'red'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ticketSubject, setTicketSubject] = useState('');

  const loadWorkspace = async () => {
    setLoadingList(true);
    try {
      const [mRes, cRes, tRes, rRes, listRes] = await Promise.all([
        api.support.getMetrics(),
        api.support.getChannelsStatus(),
        api.support.listTeams(),
        api.support.listSavedReplies(),
        api.support.listConversations({
          view,
          priority: priorityFilter !== 'all' ? priorityFilter : undefined,
          channel: channelFilter !== 'all' ? channelFilter : undefined,
          search: search.trim() || undefined,
          limit,
          offset,
        }),
      ]);
      setMetrics(mRes);
      setChannels(cRes.channels || []);
      setTeams(tRes.teams || []);
      setSavedReplies(rRes.replies || []);
      setListData({ items: listRes.items || [], total: listRes.total ?? (listRes.items || []).length });
    } catch {
      // keep existing state cleanly
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadWorkspace();
  }, [view, priorityFilter, channelFilter, offset]);

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setAiNotice(null);
    setFeedback(null);
    try {
      const d = await api.support.getConversation(id);
      setDetail(d);
      if (d?.conversation?.contactId) {
        api.support.getCustomer360(d.conversation.contactId).then(setCustomer360).catch(() => setCustomer360(null));
      } else {
        setCustomer360(null);
      }
    } catch (err: any) {
      setFeedback({ tone: 'red', text: err?.message || 'Failed to load conversation thread.' });
    }
  };

  const handleSend = async () => {
    if (!detail?.conversation?.id || !composerBody.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      if (composerMode === 'internal_note') {
        await api.support.addNote(detail.conversation.id, composerBody.trim());
        setFeedback({ tone: 'amber', text: 'Internal note saved (never visible to customer).' });
      } else {
        const res = await api.support.reply(detail.conversation.id, {
          body: composerBody.trim(),
          channel: detail.conversation.channel,
        });
        const chState = res?.channelConnection?.status;
        setFeedback({
          tone: chState === 'connected' ? 'green' : 'amber',
          text: chState === 'connected' ? 'Reply sent.' : `Reply recorded as queued (channel status: ${chState || 'not_configured'}).`,
        });
      }
      setComposerBody('');
      await openDetail(detail.conversation.id);
      await loadWorkspace();
    } catch (err: any) {
      setFeedback({ tone: 'red', text: err?.message || 'Failed to submit message.' });
    } finally {
      setBusy(false);
    }
  };

  const handleAiAssist = async () => {
    if (!detail?.conversation?.id) return;
    setBusy(true);
    setAiNotice(null);
    try {
      const res = await api.support.aiSuggest(detail.conversation.id, {
        messages: detail.messages || [],
        contact: customer360?.contact || null,
      });
      if (!res.aiAvailable) {
        setAiNotice(res.message || 'AI drafting unavailable: no live AI provider configured.');
      } else if (res.draftReply) {
        setComposerMode('public_reply');
        setComposerBody(res.draftReply);
        setAiNotice('AI draft inserted for human review. Agents must approve before sending.');
      }
    } catch (err: any) {
      setAiNotice(err?.message || 'AI suggestion request failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateTicket = async () => {
    if (!detail?.conversation?.id || !ticketSubject.trim()) return;
    setBusy(true);
    try {
      await api.support.createTicket({
        conversationId: detail.conversation.id,
        contactId: detail.conversation.contactId || undefined,
        subject: ticketSubject.trim(),
        priority: detail.conversation.priority || 'normal',
      });
      setTicketSubject('');
      setFeedback({ tone: 'green', text: 'Support ticket created and linked to conversation.' });
      await openDetail(detail.conversation.id);
    } catch (err: any) {
      setFeedback({ tone: 'red', text: err?.message || 'Failed to create ticket.' });
    } finally {
      setBusy(false);
    }
  };

  const items = listData.items.length > 0 ? listData.items : (offset === 0 && view === 'all' ? fallbackConversations : []);

  return (
    <div className="stack" style={{ gap: 14 }}>
      {/* Support Performance & Channel Status Strip */}
      <div className="card" style={{ padding: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <div><span className="cell-sub">Open: </span><strong>{num(metrics?.openCount || 0)}</strong></div>
            <div><span className="cell-sub">Unassigned: </span><strong>{num(metrics?.unassignedCount || 0)}</strong></div>
            <div><span className="cell-sub">Overdue SLA: </span><strong>{num(metrics?.overdueCount || 0)}</strong></div>
            <div>
              <span className="cell-sub">SLA Compliance: </span>
              <strong>{metrics ? pct((metrics.slaComplianceRate || 0) * 100, 100) : '—'}</strong>
            </div>
            <div>
              <span className="cell-sub">SLA Policy: </span>
              <Badge tone={metrics?.slaPolicyConfigured ? 'green' : 'default'}>
                {metrics?.slaPolicyConfigured ? 'Configured' : 'No policy configured'}
              </Badge>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {channels.map(ch => (
              <Badge key={ch.channel} tone={ch.status === 'connected' ? 'green' : 'default'}>
                {ch.channel}: {ch.status}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Main 4-Region Support Workspace */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12, alignItems: 'start' }}>
        {/* Left: Inbox Views & Filters */}
        <aside className="card" style={{ padding: 12 }} aria-label="Inbox views and filters">
          <div className="card__title" style={{ fontSize: 13, marginBottom: 8 }}>Inbox Views</div>
          <div className="stack" style={{ gap: 4 }}>
            {INBOX_VIEWS.map(v => (
              <button
                key={v.id}
                type="button"
                className={`btn btn--sm ${view === v.id ? 'btn--primary' : 'btn--subtle'}`}
                style={{ justifyContent: 'flex-start' }}
                onClick={() => { setOffset(0); setView(v.id); }}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div className="stack" style={{ gap: 8, marginTop: 12 }}>
            <input
              type="search"
              aria-label="Search support inbox"
              className="input"
              placeholder="Search customer, text, or TKT-..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setOffset(0); loadWorkspace(); } }}
            />
            <select
              aria-label="Filter by priority"
              className="input"
              value={priorityFilter}
              onChange={(e) => { setOffset(0); setPriorityFilter(e.target.value); }}
            >
              <option value="all">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
            <select
              aria-label="Filter by channel"
              className="input"
              value={channelFilter}
              onChange={(e) => { setOffset(0); setChannelFilter(e.target.value); }}
            >
              <option value="all">All Channels</option>
              <option value="webchat">Web Chat</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </div>
        </aside>

        {/* Middle: Conversation List */}
        <section className="card" style={{ padding: 12 }} aria-label="Conversation queue">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="card__title" style={{ fontSize: 13 }}>Conversations ({listData.total || items.length})</div>
            <button type="button" className="btn btn--xs" onClick={loadWorkspace} disabled={loadingList}>Refresh</button>
          </div>
          {items.length === 0 ? (
            <EmptyState
              icon={<Icon name="message" size={18} />}
              title="No matching conversations"
              text="Adjust inbox filters or wait for customer messages."
            />
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {items.map((c: any) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => openDetail(c.id)}
                  className="card"
                  style={{
                    padding: 10,
                    textAlign: 'left',
                    border: selectedId === c.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Avatar name={c.contactName || 'Customer'} size="xs" />
                      <strong style={{ fontSize: 13 }}>{c.contactName || 'Customer'}</strong>
                    </div>
                    <Badge tone={PRIORITY_TONE[c.priority || 'normal'] || 'default'}>{c.priority || 'normal'}</Badge>
                  </div>
                  <div className="cell-sub" style={{ marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.lastMessage || c.subject || 'No messages yet'}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11 }}>
                    <Badge tone={STATUS_TONE[c.status || 'open'] || 'default'}>{c.status || 'open'}</Badge>
                    <span className="cell-sub">{c.channel} · {relative(c.lastMessageAt || c.createdAt || new Date().toISOString())}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
          {listData.total > limit && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
              <button type="button" className="btn btn--xs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Prev</button>
              <button type="button" className="btn btn--xs" disabled={offset + limit >= listData.total} onClick={() => setOffset(offset + limit)}>Next</button>
            </div>
          )}
        </section>

        {/* Main: Thread & Composer */}
        <section className="card" style={{ padding: 12 }} aria-label="Conversation thread and composer">
          {!detail?.conversation ? (
            <EmptyState
              icon={<Icon name="mail" size={18} />}
              title="Select a conversation"
              text="Open a conversation from the queue to inspect messages, internal notes, Customer 360, and tickets."
            />
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong style={{ fontSize: 14 }}>{detail.conversation.contactName}</strong>
                  <div className="cell-sub">
                    {detail.conversation.channel} · {detail.channelConnection?.detail || 'Channel status checked'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <select
                    aria-label="Conversation status"
                    className="input"
                    value={detail.conversation.status}
                    onChange={async (e) => {
                      await api.support.updateLifecycle(detail.conversation.id, {
                        status: e.target.value,
                        expectedVersion: detail.conversation.version,
                      });
                      await openDetail(detail.conversation.id);
                      await loadWorkspace();
                    }}
                  >
                    <option value="open">Open</option>
                    <option value="pending">Pending</option>
                    <option value="waiting_on_customer">Waiting on Customer</option>
                    <option value="waiting_on_internal">Waiting on Internal</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>
                  <button
                    type="button"
                    className="btn btn--xs"
                    onClick={async () => {
                      await api.support.assign(detail.conversation.id, {
                        assignedTo: detail.conversation.assignedTo ? null : 'me',
                        assignedAgentName: detail.conversation.assignedTo ? null : 'Me',
                        expectedVersion: detail.conversation.version,
                      });
                      await openDetail(detail.conversation.id);
                      await loadWorkspace();
                    }}
                  >
                    {detail.conversation.assignedTo ? 'Unassign' : 'Claim'}
                  </button>
                </div>
              </div>

              {feedback && <Badge tone={feedback.tone}>{feedback.text}</Badge>}

              {/* Messages + Internal Notes */}
              <div className="stack" style={{ gap: 8, maxHeight: 300, overflowY: 'auto', padding: 6, border: '1px solid var(--border)', borderRadius: 6 }}>
                {(detail.messages || []).map((m: any) => (
                  <div key={m.id} style={{ padding: 8, borderRadius: 6, background: 'var(--surface)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                      <strong>{m.senderName || m.senderType} ({m.direction})</strong>
                      <span className="cell-sub">{m.deliveryStatus}</span>
                    </div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>{m.body}</div>
                  </div>
                ))}
                {(detail.internalNotes || []).map((n: any) => (
                  <div key={n.id} style={{ padding: 8, borderRadius: 6, border: '1px dashed var(--amber)', background: 'rgba(245, 158, 11, 0.08)' }}>
                    <div style={{ fontSize: 11, fontWeight: 600 }}>Internal Note — {n.authorName} (Staff Only)</div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>{n.body}</div>
                  </div>
                ))}
              </div>

              {/* Composer */}
              <div className="stack" style={{ gap: 8 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    type="button"
                    className={`btn btn--xs ${composerMode === 'public_reply' ? 'btn--primary' : 'btn--subtle'}`}
                    onClick={() => setComposerMode('public_reply')}
                  >
                    Public Reply
                  </button>
                  <button
                    type="button"
                    className={`btn btn--xs ${composerMode === 'internal_note' ? 'btn--primary' : 'btn--subtle'}`}
                    onClick={() => setComposerMode('internal_note')}
                  >
                    Internal Note (Private)
                  </button>
                  <button type="button" className="btn btn--xs" onClick={handleAiAssist} disabled={busy}>
                    <Icon name="sparkles" size={12} /> AI Draft
                  </button>
                  {savedReplies.length > 0 && (
                    <select
                      aria-label="Insert saved reply"
                      className="input"
                      value=""
                      onChange={(e) => {
                        const found = savedReplies.find(r => r.id === e.target.value);
                        if (found) setComposerBody(prev => (prev ? `${prev}\n${found.body}` : found.body));
                      }}
                    >
                      <option value="">Insert Saved Reply...</option>
                      {savedReplies.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                    </select>
                  )}
                </div>

                {aiNotice && <div className="cell-sub">{aiNotice}</div>}

                <textarea
                  aria-label="Reply or internal note composer"
                  className="input"
                  rows={3}
                  placeholder={composerMode === 'internal_note' ? 'Write a private internal note for your team...' : 'Write a reply to the customer...'}
                  value={composerBody}
                  onChange={(e) => setComposerBody(e.target.value)}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn--sm btn--primary" onClick={handleSend} disabled={busy || !composerBody.trim()}>
                    {composerMode === 'internal_note' ? 'Save Internal Note' : 'Send Reply'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Right: Customer 360 & Tickets */}
        <aside className="card" style={{ padding: 12 }} aria-label="Customer 360 and support tickets">
          <div className="card__title" style={{ fontSize: 13, marginBottom: 8 }}>Customer 360 & Tickets</div>
          {!detail?.conversation ? (
            <div className="cell-sub">Open a conversation to inspect CRM context and linked support tickets.</div>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {customer360?.contact ? (
                <div style={{ fontSize: 12 }} className="stack">
                  <div><strong>{customer360.contact.first_name} {customer360.contact.last_name}</strong></div>
                  <div className="cell-sub">{customer360.contact.company || 'No company'} · {customer360.contact.status || 'active'}</div>
                  <div className="cell-sub">Opportunities: {(customer360.opportunities || []).length} · Appointments: {(customer360.appointments || []).length}</div>
                  {customer360.financials?.authorized && (
                    <div className="cell-sub">Invoices: {(customer360.financials.invoices || []).length}</div>
                  )}
                </div>
              ) : (
                <div className="cell-sub">No linked CRM contact record.</div>
              )}

              <div>
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Linked Tickets ({(detail.tickets || []).length})</div>
                <div className="stack" style={{ gap: 6 }}>
                  {(detail.tickets || []).map((t: any) => (
                    <div key={t.id} style={{ padding: 6, border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <strong>{t.ticketNumber}</strong>
                        <Badge tone={STATUS_TONE[t.status] || 'default'}>{t.status}</Badge>
                      </div>
                      <div>{t.subject}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <input
                    type="text"
                    aria-label="New ticket subject"
                    className="input"
                    placeholder="New ticket subject..."
                    value={ticketSubject}
                    onChange={(e) => setTicketSubject(e.target.value)}
                  />
                  <button type="button" className="btn btn--xs btn--primary" onClick={handleCreateTicket} disabled={busy || ticketSubject.trim().length < 2}>
                    Create
                  </button>
                </div>
              </div>

              {teams.length > 0 && (
                <div className="cell-sub">Active Teams: {teams.map(t => t.name).join(', ')}</div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
