import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, EmptyState } from '../components/ui';
import { CHANNEL_META, uid, useStore } from '../lib/store';
import { relative, timeOf } from '../lib/format';
import { resolveMerge } from '../lib/merge';
import type { Channel, Snippet } from '../lib/types';

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
  const [wsConnected, setWsConnected] = useState(false);
  const [aiDrafting, setAiDrafting] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket('ws://localhost:4000/ws');
      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => setWsConnected(false);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'message.received') {
            console.log('[Operza Live Ingress Message]', msg);
          }
        } catch {}
      };
    } catch {}
    return () => ws?.close();
  }, []);

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
    dispatch({
      type: 'conversation/send',
      id: selected.id,
      body: draft.trim(),
      subject: selected.channel === 'email' && subject.trim() ? subject.trim() : undefined,
    });
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
              <button
                className="icon-btn"
                style={{ marginLeft: 'auto' }}
                aria-label="New conversation"
                onClick={() => setComposing(true)}
              >
                <Icon name="edit" size={16} />
              </button>
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
                  {channelUnread[ch] ? ` Â· ${channelUnread[ch]} unread` : ''}
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
                  {CHANNEL_META[selected.channel].label} Â·{' '}
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
                <span className="badge" style={{ background: wsConnected ? 'rgba(34, 197, 94, 0.15)' : 'rgba(148, 163, 184, 0.15)', color: wsConnected ? '#22c55e' : '#94a3b8', fontSize: 11 }}>{wsConnected ? '?? Live Sync' : '? Standby'}</span>
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
                    {m.direction === 'out' ? 'Asim R. Â· ' : ''}
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
                  placeholder="Subject lineâ€¦"
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
                  aria-expanded={pickerOpen}
                  onClick={() => setPickerOpen((v) => !v)}
                >
                  <Icon name="zap" size={17} />
                </button>
                {pickerOpen && (
                  <>
                    <div className="popover-backdrop" onClick={() => setPickerOpen(false)} />
                    <div className="popover" role="menu" aria-label="Snippets">
                      <div className="popover__head">Insert a snippet</div>
                      {snippetsForChannel.length === 0 ? (
                        <div className="hint" style={{ padding: '6px 10px 10px' }}>
                          No snippets for this channel yet.
                        </div>
                      ) : (
                        snippetsForChannel.map((snippet) => (
                          <button
                            key={snippet.id}
                            type="button"
                            role="menuitem"
                            className="popover__item"
                            onClick={() => insertSnippet(snippet)}
                          >
                            <span className="popover__label">
                              {snippet.label}
                              {snippet.channel && (
                                <Badge>{CHANNEL_META[snippet.channel].label}</Badge>
                              )}
                            </span>
                            {snippet.subject && (
                              <span className="popover__subject">
                                {resolveMerge(snippet.subject, selectedContact, state.customValues)}
                              </span>
                            )}
                            <span className="popover__body">
                              {resolveMerge(snippet.body, selectedContact, state.customValues)}
                            </span>
                          </button>
                        ))
                      )}
                      <Link className="popover__manage" to="/snippets" onClick={() => setPickerOpen(false)}>
                        Manage snippets
                      </Link>
                    </div>
                  </>
                )}
              </div>
              <textarea
                placeholder={`Reply via ${CHANNEL_META[selected.channel].label}â€¦`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
              />
              <button type="button" className="btn btn--secondary" onClick={askAiDraft} disabled={aiDrafting} title="Use Operza AI Copilot to draft a response" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name="sparkles" size={14} /> {aiDrafting ? "Drafting…" : "AI Draft"}
              </button>
              <button
                className="btn btn--primary"
                onClick={send}
                disabled={!draft.trim() || (selected.channel === 'whatsapp' && smsChars > 1024)}
              >
                <Icon name="send" size={15} /> Send
              </button>
              </div>
              {selected.channel === 'sms' && (
                <div className="composer__hint">
                  <span>{smsChars} characters</span>
                  <span>
                    {smsSegments} SMS segment{smsSegments === 1 ? '' : 's'}
                  </span>
                </div>
              )}
              {selected.channel === 'whatsapp' && (
                <div className="composer__hint">
                  <span>{smsChars} / 1024 characters</span>
                  <span>{smsChars > 1024 ? 'Over the WhatsApp limit' : 'Within the WhatsApp limit'}</span>
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="thread">
            <EmptyState
              icon={<Icon name="message" size={22} />}
              title="Select a conversation"
              text="Pick a thread on the left to read and reply."
            />
          </section>
        )}
      </div>

      {composing && <NewConversation onClose={() => setComposing(false)} onStarted={startConversation} />}
    </div>
  );
}

function NewConversation({
  onClose,
  onStarted,
}: {
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const { state, dispatch } = useStore();
  const [contactId, setContactId] = useState('');
  const [channel, setChannel] = useState<Channel>('sms');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const contacts = useMemo(
    () =>
      [...state.contacts].sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
      ),
    [state.contacts],
  );
  const existing = state.conversations.find(
    (c) => c.contactId === contactId && c.channel === channel,
  );
  const canSend = contactId !== '' && body.trim().length > 0;

  const start = () => {
    if (!canSend) return;
    const id = uid('cv');
    dispatch({
      type: 'conversation/start',
      id,
      contactId,
      channel,
      body: body.trim(),
      subject: channel === 'email' && subject.trim() ? subject.trim() : undefined,
    });
    onStarted(existing?.id ?? id);
  };

  return (
    <Modal
      title="New conversation"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSend} onClick={start}>
            <Icon name="send" size={14} /> Start conversation
          </button>
        </>
      }
    >
      <div className="grid grid--2">
        <div className="field">
          <label htmlFor="conversation-contact">Contact</label>
          <select
            id="conversation-contact"
            className="select"
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
          >
            <option value="" disabled>
              Choose a contactâ€¦
            </option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.firstName} {contact.lastName}
                {contact.company ? ` â€” ${contact.company}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="conversation-channel">Channel</label>
          <select
            id="conversation-channel"
            className="select"
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel)}
          >
            {CHANNELS.map((ch) => (
              <option key={ch} value={ch}>
                {CHANNEL_META[ch].label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {channel === 'email' && (
        <div className="field">
          <label htmlFor="conversation-subject">Subject</label>
          <input
            id="conversation-subject"
            className="input"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="What is this about?"
          />
        </div>
      )}
      <div className="field">
        <label htmlFor="conversation-body">First message</label>
        <textarea
          id="conversation-body"
          className="input"
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write the opening messageâ€¦"
        />
      </div>
      {existing && (
        <div className="callout">
          This contact already has {channel === 'sms' ? 'an SMS' : `a ${CHANNEL_META[channel].label}`} thread
          â€” the message will be added to it instead of starting a new one.
        </div>
      )}
    </Modal>
  );
}

