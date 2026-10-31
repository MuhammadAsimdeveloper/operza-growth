import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, EmptyState } from '../components/ui';
import { CHANNEL_META, uid, useStore } from '../lib/store';
import { relative, timeOf } from '../lib/format';
import { resolveMerge } from '../lib/merge';
import type { Channel, Contact, Snippet } from '../lib/types';

const FILTERS = ['all', 'unread', 'starred'] as const;
type Filter = (typeof FILTERS)[number];
const CHANNELS = Object.keys(CHANNEL_META) as Channel[];

export default function Conversations() {
  const { state, dispatch } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [channelFilter, setChannelFilter] = useState<Channel | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(state.conversations[0]?.id ?? null);
  const [draft, setDraft] = useState('');
  const [subject, setSubject] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [widgetModalOpen, setWidgetModalOpen] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [aiDrafting, setAiDrafting] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    try {
      const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = typeof window !== 'undefined' && window.location.host ? window.location.host : 'localhost:4005';
      ws = new WebSocket(`${protocol}//${host}/ws`);
      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => setWsConnected(false);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'message.received' || msg.type === 'crm.conversation.message_received') {
            const data = msg.data || msg;
            if (data.contactName && data.content) {
              const matchedContact = state.contacts.find((ct) => `${ct.firstName} ${ct.lastName}`.trim().toLowerCase() === data.contactName.trim().toLowerCase());
              const existingConv = matchedContact ? state.conversations.find((c) => c.contactId === matchedContact.id) : null;
              if (existingConv) {
                dispatch({
                  type: 'conversation/send',
                  id: existingConv.id,
                  body: data.content,
                  subject: data.subject,
                });
              }
            }
          }
        } catch {}
      };
    } catch {}
    return () => ws?.close();
  }, [state.conversations, dispatch]);

  const askAiDraft = () => {
    if (!selected) return;
    setAiDrafting(true);
    const lastMsg = selected.messages[selected.messages.length - 1]?.body || 'Inquiry';
    const prompt = `Draft a concise, professional 1-2 sentence response to this customer: "${lastMsg}".`;
    let responseText = '';
    api.copilot.stream(
      prompt,
      (delta) => {
        responseText += delta;
        setDraft(responseText.trim());
      },
      () => {
        setAiDrafting(false);
      }
    );
  };

  const contactOf = (id: string) => state.contacts.find((c) => c.id === id);

  const channelUnread = useMemo(() => {
    const counts: Partial<Record<Channel, number>> = {};
    for (const c of state.conversations) {
      if (c.unread > 0) counts[c.channel] = (counts[c.channel] ?? 0) + c.unread;
    }
    return counts;
  }, [state.conversations]);

  const conversations = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.conversations
      .filter((c) => {
        if (filter === 'unread' && c.unread === 0) return false;
        if (filter === 'starred' && !c.starred) return false;
        if (channelFilter !== 'all' && c.channel !== channelFilter) return false;
        if (!q) return true;
        const contact = contactOf(c.contactId);
        const text = `${contact?.firstName ?? ''} ${contact?.lastName ?? ''} ${contact?.company ?? ''}`.toLowerCase();
        return text.includes(q);
      })
      .sort((a, b) => {
        const aLast = a.messages[a.messages.length - 1]?.at ?? '';
        const bLast = b.messages[b.messages.length - 1]?.at ?? '';
        return bLast.localeCompare(aLast);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.conversations, state.contacts, filter, channelFilter, query]);

  const selected = state.conversations.find((c) => c.id === selectedId) ?? null;
  const selectedContact = selected ? contactOf(selected.contactId) : undefined;
  const selectedVisible = !!selected && conversations.some((c) => c.id === selected.id);

  const openConversation = (id: string) => {
    setSelectedId(id);
    setDraft('');
    setSubject('');
    setPickerOpen(false);
    dispatch({ type: 'conversation/read', id });
  };

  const startConversation = (id: string) => {
    setFilter('all');
    setChannelFilter('all');
    setQuery('');
    setComposing(false);
    openConversation(id);
  };

  const send = () => {
    if (!selected || !draft.trim()) return;
    if (selected.channel === 'whatsapp' && draft.trim().length > 1024) return;
    const bodyText = draft.trim();
    const subj = selected.channel === 'email' && subject.trim() ? subject.trim() : undefined;
    dispatch({
      type: 'conversation/send',
      id: selected.id,
      body: bodyText,
      subject: subj,
    });
    api.conversations.sendMessage(selected.id, {
      content: bodyText,
      channel: selected.channel,
      subject: subj,
    }).catch((err) => console.error('Failed to sync outbound message:', err));
    setDraft('');
    setSubject('');
  };

  const insertSnippet = (snippet: Snippet) => {
    if (!selected) return;
    const text = resolveMerge(snippet.body, selectedContact, state.customValues);
    setDraft((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text));
    if (selected.channel === 'email' && snippet.subject) {
      const line = resolveMerge(snippet.subject, selectedContact, state.customValues);
      setSubject((prev) => (prev.trim() ? prev : line));
    }
    dispatch({ type: 'snippet/use', id: snippet.id });
    setPickerOpen(false);
  };

  const snippetsForChannel = selected
    ? state.snippets.filter((s) => !s.channel || s.channel === selected.channel)
    : [];
  const smsChars = draft.trim().length;
  const smsSegments = Math.max(1, Math.ceil(smsChars / 160));

  return (
    <div className="content content--flush">
      <div className="inbox">
        <section className={`inbox__list${selected ? ' is-hidden-mobile' : ''}`}>
          <div className="inbox__list-head">
            <div className="row">
              <strong style={{ fontSize: 14 }}>Inbox</strong>
              <Badge tone="accent">
                {state.conversations.reduce((s, c) => s + c.unread, 0)} unread
              </Badge>
              <div className="row" style={{ marginLeft: 'auto', gap: 4 }}>
                <button
                  className="icon-btn"
                  title="Webchat Widget Setup"
                  aria-label="Webchat Widget Setup"
                  onClick={() => setWidgetModalOpen(true)}
                >
                  <Icon name="globe" size={15} />
                </button>
                <button
                  className="icon-btn"
                  aria-label="New conversation"
                  onClick={() => setComposing(true)}
                >
                  <Icon name="edit" size={16} />
                </button>
              </div>
            </div>
            <div className="search">
              <Icon name="search" size={15} />
              <input
                className="input"
                placeholder="Search conversations"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              className="select"
              aria-label="Filter by channel"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as Channel | 'all')}
            >
              <option value="all">All channels</option>
              {CHANNELS.map((ch) => (
                <option key={ch} value={ch}>
                  {CHANNEL_META[ch].label}
                  {channelUnread[ch] ? ` · ${channelUnread[ch]} unread` : ''}
                </option>
              ))}
            </select>
            <div className="segmented">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  className={filter === f ? 'is-active' : ''}
                  onClick={() => setFilter(f)}
                  style={{ textTransform: 'capitalize' }}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="inbox__scroll">
            {conversations.length === 0 && (
              <EmptyState icon={<Icon name="message" size={20} />} title="No conversations" text="Nothing matches this filter." />
            )}
            {conversations.map((c) => {
              const contact = contactOf(c.contactId);
              if (!contact) return null;
              const last = c.messages[c.messages.length - 1];
              const meta = CHANNEL_META[c.channel];
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`conv${c.id === selectedId ? ' is-active' : ''}`}
                  onClick={() => openConversation(c.id)}
                >
                  <Avatar name={`${contact.firstName} ${contact.lastName}`} size="md" />
                  <span className="conv__body">
                    <span className="conv__top">
                      <span className="conv__name">
                        {contact.firstName} {contact.lastName}
                      </span>
                      <span className="conv__time">{last ? relative(last.at) : ''}</span>
                      {c.unread > 0 && <span className="conv__badge">{c.unread}</span>}
                    </span>
                    <span className="conv__preview" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                      <Icon name={meta.icon} size={12} />
                      {last?.body}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {selected && selectedContact && selectedVisible ? (
          <section className="thread">
            <div className="thread__head">
              <button
                className="icon-btn"
                aria-label="Back"
                onClick={() => setSelectedId(null)}
                style={{ display: 'none' }}
              >
                <Icon name="chevron-left" size={17} />
              </button>
              <Avatar name={`${selectedContact.firstName} ${selectedContact.lastName}`} size="md" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 650 }}>
                  {selectedContact.firstName} {selectedContact.lastName}
                </div>
                <div className="cell-sub">
                  {CHANNEL_META[selected.channel].label} ·{' '}
                  {selected.channel === 'email'
                    ? selectedContact.email
                    : selected.channel === 'sms' || selected.channel === 'whatsapp'
                      ? selectedContact.phone
                      : selectedContact.company || selectedContact.email}
                </div>
              </div>
              <div className="card__actions">
                <button
                  className="icon-btn"
                  aria-label="Star"
                  onClick={() => dispatch({ type: 'conversation/star', id: selected.id })}
                  style={{ color: selected.starred ? '#f59e0b' : undefined }}
                >
                  <Icon name="star" size={16} />
                </button>
                <span className="badge" style={{ background: wsConnected ? 'rgba(34, 197, 94, 0.15)' : 'rgba(148, 163, 184, 0.15)', color: wsConnected ? '#22c55e' : '#94a3b8', fontSize: 11 }}>
                  {wsConnected ? '● Live Sync' : '○ Standby'}
                </span>
                <Link className="btn btn--sm" to={`/contacts/${selectedContact.id}`}>
                  <Icon name="user" size={14} /> View contact
                </Link>
                <button className="icon-btn" aria-label="More">
                  <Icon name="dots" size={16} />
                </button>
              </div>
            </div>

            <div className="thread__scroll">
              {selected.messages.map((m) => (
                <div key={m.id} className={`bubble bubble--${m.direction}`}>
                  {m.subject && <div className="bubble__subject">{m.subject}</div>}
                  {m.body}
                  <div className="bubble__meta">
                    {m.direction === 'out' ? 'Operza Agent · ' : ''}
                    {timeOf(m.at)}
                  </div>
                </div>
              ))}
            </div>

            <div
              className={`thread__composer${selected.channel === 'email' ? ' thread__composer--stack' : ''}`}
            >
              {selected.channel === 'email' && (
                <input
                  className="composer__subject"
                  placeholder="Subject line..."
                  aria-label="Email subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              )}
              <div className="composer__row">
                <div className="composer__snippets">
                  <button
                    className="icon-btn"
                    aria-label="Insert snippet"
                    title="Insert saved snippet"
                    onClick={() => setPickerOpen((o) => !o)}
                  >
                    <Icon name="lightning" size={16} />
                  </button>
                  {pickerOpen && (
                    <div className="snippet-picker">
                      <div className="snippet-picker__title">Insert snippet</div>
                      {snippetsForChannel.length === 0 ? (
                        <div className="cell-sub" style={{ padding: '8px 12px' }}>
                          No snippets for this channel.
                        </div>
                      ) : (
                        snippetsForChannel.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className="snippet-picker__item"
                            onClick={() => insertSnippet(s)}
                          >
                            <span className="snippet-picker__label">{s.label}</span>
                            <span className="snippet-picker__preview">{s.body}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <textarea
                  className="composer__input"
                  rows={2}
                  placeholder={`Reply via ${CHANNEL_META[selected.channel].label}...`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />

                <div className="row" style={{ gap: 6 }}>
                  <button
                    className="btn btn--sm btn--ghost"
                    title="Generate AI reply draft"
                    disabled={aiDrafting}
                    onClick={askAiDraft}
                  >
                    <Icon name="sparkles" size={14} /> {aiDrafting ? 'Drafting...' : 'AI Draft'}
                  </button>
                  <button
                    className="btn btn--primary"
                    disabled={!draft.trim()}
                    onClick={send}
                  >
                    <Icon name="send" size={14} /> Send
                  </button>
                </div>
              </div>

              {selected.channel === 'sms' && (
                <div className="composer__footer row row--between">
                  <span className="cell-sub">
                    {smsChars} chars · {smsSegments} segment{smsSegments === 1 ? '' : 's'}
                  </span>
                  <span className="cell-sub">Press Ctrl+Enter to send</span>
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="thread thread--empty">
            <EmptyState
              icon={<Icon name="message" size={24} />}
              title="Select a conversation"
              text="Choose a thread from the list or start a new conversation."
              action={
                <button className="btn btn--sm btn--primary" onClick={() => setComposing(true)}>
                  New conversation
                </button>
              }
            />
          </section>
        )}
      </div>

      {composing && (
        <NewConversationModal
          contacts={state.contacts}
          onClose={() => setComposing(false)}
          onStart={startConversation}
        />
      )}

      {widgetModalOpen && (
        <WebchatWidgetModal onClose={() => setWidgetModalOpen(false)} />
      )}
    </div>
  );
}

function WebchatWidgetModal({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [visitorName, setVisitorName] = useState('Alex Mercer');
  const [visitorEmail, setVisitorEmail] = useState('alex@ventureflow.io');
  const [testMsg, setTestMsg] = useState('Hello! We need automated lead routing for our 12-person agency.');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const scriptCode = `<script src="${window.location.origin}/widget/operza.js"></script>`;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(scriptCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleSimulateVisitor = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/widget/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorName,
          visitorEmail,
          message: testMsg,
        }),
      });
      const data = await res.json();
      if (data.reply) {
        setTestResult(`Success! Lead created. AI Copilot auto-replied: "${data.reply}"`);
      } else {
        setTestResult('Success! Inbound lead received and synced to inbox.');
      }
    } catch (err: any) {
      setTestResult(`Test error: ${err.message || 'Failed'}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal title="Embeddable Webchat Lead Capture Widget" wide onClose={onClose}>
      <div className="stack" style={{ gap: 14 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-sub)', lineHeight: 1.5 }}>
          Convert website visitors into paying CRM clients automatically. Add this single lightweight script tag before the closing <code>&lt;/body&gt;</code> tag on any website, Webflow, WordPress, Shopify, or React application.
        </p>

        <div className="card" style={{ padding: 12, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <div className="row row--between" style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Embed Script Tag</span>
            <button className="btn btn--sm btn--primary" onClick={copyCode}>
              <Icon name="copy" size={13} /> {copied ? 'Copied to Clipboard!' : 'Copy Snippet'}
            </button>
          </div>
          <pre
            style={{
              margin: 0,
              padding: '10px 14px',
              background: '#090d16',
              color: '#38bdf8',
              borderRadius: 6,
              fontSize: 12,
              fontFamily: 'monospace',
              overflowX: 'auto',
            }}
          >
            {scriptCode}
          </pre>
        </div>

        <div className="card" style={{ padding: 14, background: 'var(--surface-2)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Simulate Inbound Visitor Test
          </div>
          <div className="grid grid--2" style={{ gap: 10 }}>
            <div className="field">
              <label>Visitor Name</label>
              <input
                className="input"
                value={visitorName}
                onChange={(e) => setVisitorName(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Visitor Email</label>
              <input
                className="input"
                value={visitorEmail}
                onChange={(e) => setVisitorEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Inquiry Message</label>
            <input
              className="input"
              value={testMsg}
              onChange={(e) => setTestMsg(e.target.value)}
            />
          </div>
          <div className="row row--between" style={{ marginTop: 12 }}>
            <button
              className="btn btn--sm btn--primary"
              disabled={testing || !testMsg.trim()}
              onClick={handleSimulateVisitor}
            >
              <Icon name="send" size={13} /> {testing ? 'Sending...' : 'Test Inbound Lead Capture'}
            </button>
            {testResult && (
              <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 550 }}>
                {testResult}
              </span>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function NewConversationModal({
  contacts,
  onClose,
  onStart,
}: {
  contacts: Contact[];
  onClose: () => void;
  onStart: (id: string) => void;
}) {
  const { dispatch } = useStore();
  const [contactId, setContactId] = useState(contacts[0]?.id ?? '');
  const [channel, setChannel] = useState<Channel>('sms');
  const [message, setMessage] = useState('');

  const contact = contacts.find((c) => c.id === contactId);
  const canSend = Boolean(contact && message.trim());

  const handleStart = () => {
    if (!contact || !canSend) return;
    const newId = uid('conv');
    dispatch({
      type: 'conversation/start',
      id: newId,
      contactId: contact.id,
      channel,
      body: message.trim(),
    });
    api.conversations.sendMessage(newId, {
      content: message.trim(),
      channel,
    }).catch(() => {});
    onStart(newId);
  };

  return (
    <Modal
      title="New Conversation"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!canSend}
            onClick={handleStart}
          >
            Start Conversation
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="new-conv-contact">Contact</label>
        <select
          id="new-conv-contact"
          className="select"
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
        >
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.firstName} {c.lastName} — {c.company || c.email}
            </option>
          ))}
        </select>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="new-conv-channel">Channel</label>
        <select
          id="new-conv-channel"
          className="select"
          value={channel}
          onChange={(e) => setChannel(e.target.value as Channel)}
        >
          <option value="sms">SMS Text</option>
          <option value="email">Email</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="webchat">Webchat</option>
        </select>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="new-conv-msg">First Message</label>
        <textarea
          id="new-conv-msg"
          className="textarea"
          rows={3}
          placeholder="Hi there, thanks for connecting with us..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>
    </Modal>
  );
}
