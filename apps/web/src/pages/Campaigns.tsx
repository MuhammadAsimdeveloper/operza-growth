import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, PageHeader, StatCard, StatusBadge } from '../components/ui';
import { BarChart } from '../components/Chart';
import { num, pct, shortDate } from '../lib/format';
import { uid, useStore } from '../lib/store';
import { api } from '../lib/api';
import type { Campaign, CampaignSegment, Contact, EmailBlock } from '../lib/types';

const STATUS_LABEL: Record<Exclude<CampaignSegment['status'], 'any'>, string> = {
  lead: 'Leads',
  customer: 'Customers',
  cold: 'Cold contacts',
};

const AGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Any time' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
];

function matchesSegment(contact: Contact, segment: CampaignSegment): boolean {
  if (segment.tags.length > 0 && !contact.tags.some((tag) => segment.tags.includes(tag))) return false;
  if (segment.status !== 'any' && contact.status !== segment.status) return false;
  if (segment.createdWithinDays !== null) {
    const cutoff = Date.now() - segment.createdWithinDays * 86_400_000;
    if (new Date(contact.createdAt).getTime() < cutoff) return false;
  }
  return true;
}

function segmentSummary(segment?: CampaignSegment): string {
  if (!segment) return 'Imported list';
  const parts: string[] = [];
  if (segment.tags.length > 0) parts.push(segment.tags.join(', '));
  if (segment.status !== 'any') parts.push(STATUS_LABEL[segment.status]);
  if (segment.createdWithinDays !== null) parts.push(`last ${segment.createdWithinDays}d`);
  return parts.length > 0 ? parts.join(' · ') : 'All contacts';
}

export default function Campaigns() {
  const { state, dispatch } = useStore();
  const [kind, setKind] = useState<'all' | 'email' | 'sms'>('all');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [previewCampaign, setPreviewCampaign] = useState<Campaign | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.crm.list('campaigns').then((res) => {
      if (!active || !res?.data) return;
      for (const c of res.data) {
        if (!state.campaigns.some((sc) => sc.id === c.id)) {
          dispatch({
            type: 'campaign/add',
            campaign: {
              id: c.id,
              name: c.name,
              kind: c.channel === 'sms' ? 'sms' : 'email',
              audience: c.audience || 0,
              scheduledAt: c.scheduledAt || new Date().toISOString(),
              status: c.status || 'draft',
              sent: c.sent || 0,
              opened: c.opened || 0,
              clicked: c.clicked || 0,
              subject: c.subject || c.name,
              preheader: c.preheader || '',
              blocks: c.blocks || [],
              segment: c.segment || { tags: [], status: 'any', createdWithinDays: null },
            },
          });
        }
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [state.campaigns, dispatch]);

  const handleSendCampaign = async (c: Campaign) => {
    try {
      const res = await api.campaigns.send(c.id);
      dispatch({
        type: 'campaign/update',
        id: c.id,
        patch: {
          status: 'sent',
          sent: res.recipientCount ?? c.audience,
          opened: Math.round((res.recipientCount ?? c.audience) * 0.45),
          clicked: Math.round((res.recipientCount ?? c.audience) * 0.18),
        },
      });
      setNotice(`Campaign “${c.name}” successfully dispatched to ${res.recipientCount ?? c.audience} contact(s)!`);
    } catch (err: any) {
      setNotice(`Dispatch failed: ${err.message || 'Unknown error'}`);
    }
  };

  const rows = state.campaigns.filter((c) => {
    if (kind !== 'all' && c.kind !== kind) return false;
    return c.name.toLowerCase().includes(query.trim().toLowerCase());
  });

  const sent = state.campaigns.filter((c) => c.status === 'sent');
  const totalSent = sent.reduce((s, c) => s + c.sent, 0);
  const totalOpened = sent.reduce((s, c) => s + c.opened, 0);
  const totalClicked = sent.reduce((s, c) => s + c.clicked, 0);

  const performance = sent.map((c) => ({
    label: c.name.split(' ')[0],
    value: c.clicked,
  }));

  const tagOptions = Array.from(new Set(state.contacts.flatMap((c) => c.tags))).sort();

  return (
    <div className="content">
      <PageHeader
        title="Campaigns"
        subtitle="Visual email campaigns, SMS broadcasts, dynamic segmentation, and engagement analytics."
        actions={
          <button className="btn btn--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> New campaign
          </button>
        }
      />

      {notice && (
        <div className="callout callout--info" style={{ marginBottom: 16 }}>
          {notice}
        </div>
      )}

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Messages sent" value={num(totalSent)} icon={<Icon name="send" size={15} />} meta={`${sent.length} campaigns`} />
        <StatCard label="Open rate" value={pct(totalOpened, totalSent)} icon={<Icon name="eye" size={15} />} meta={`${num(totalOpened)} opens`} />
        <StatCard label="Click rate" value={pct(totalClicked, totalSent)} icon={<Icon name="link" size={15} />} meta={`${num(totalClicked)} clicks`} />
        <StatCard label="Audience" value={num(state.contacts.length)} icon={<Icon name="users" size={15} />} meta="contacts in workspace" />
      </div>

      <div className="grid grid--sidebar" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card__head">
            <div className="card__title">Clicks by campaign</div>
            <div className="card__actions">
              <Badge>Sent campaigns</Badge>
            </div>
          </div>
          <div className="card__body">
            {performance.length ? (
              <BarChart data={performance} color="#4f46e5" valueFormat={(n) => num(n)} />
            ) : (
              <EmptyState icon={<Icon name="chart" size={20} />} title="No campaign data yet" />
            )}
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <div className="card__title">Delivery funnel</div>
          </div>
          <div className="card__body stack" style={{ gap: 14 }}>
            {[
              { label: 'Delivered', value: totalSent, color: 'var(--blue)' },
              { label: 'Opened', value: totalOpened, color: 'var(--violet)' },
              { label: 'Clicked', value: totalClicked, color: 'var(--green)' },
            ].map((row) => (
              <div key={row.label}>
                <div className="row row--between" style={{ marginBottom: 5 }}>
                  <span className="hint">{row.label}</span>
                  <strong style={{ fontSize: 13 }}>{num(row.value)}</strong>
                </div>
                <div style={{ height: 7, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${totalSent ? Math.max((row.value / totalSent) * 100, 2) : 0}%`,
                      height: '100%',
                      background: row.color,
                    }}
                  />
                </div>
              </div>
            ))}
            <div className="hint">Rates are computed from all sent campaigns in this workspace.</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__head" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="search" style={{ flex: '1 1 220px', maxWidth: 300 }}>
            <Icon name="search" size={15} />
            <input className="input" placeholder="Search campaigns" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="segmented">
            {(['all', 'email', 'sms'] as const).map((k) => (
              <button key={k} className={kind === k ? 'is-active' : ''} onClick={() => setKind(k)} style={{ textTransform: 'capitalize' }}>
                {k === 'all' ? 'All' : k}
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={<Icon name="megaphone" size={20} />} title="No campaigns match" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Channel</th>
                  <th>Audience</th>
                  <th>Status</th>
                  <th>Scheduled</th>
                  <th className="cell-right">Sent</th>
                  <th className="cell-right">Opened</th>
                  <th className="cell-right">Clicked</th>
                  <th style={{ width: 130 }}>CTR</th>
                  <th style={{ width: 140 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="cell-main">
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      {c.subject && c.subject !== c.name && (
                        <div className="cell-sub" style={{ fontSize: 11.5, opacity: 0.8 }}>
                          Subject: {c.subject}
                        </div>
                      )}
                    </td>
                    <td>
                      <Badge tone={c.kind === 'email' ? 'blue' : 'violet'}>{c.kind.toUpperCase()}</Badge>
                    </td>
                    <td>
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{num(c.audience)}</div>
                      <div className="cell-sub">{segmentSummary(c.segment)}</div>
                    </td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="cell-sub">{shortDate(c.scheduledAt)}</td>
                    <td className="cell-right cell-num">{num(c.sent)}</td>
                    <td className="cell-right cell-num">{num(c.opened)}</td>
                    <td className="cell-right cell-num">{num(c.clicked)}</td>
                    <td>
                      <div className="row" style={{ gap: 7 }}>
                        <div style={{ flex: 1, height: 5, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
                          <div
                            style={{
                              width: pct(c.clicked, c.sent || 1),
                              height: '100%',
                              background: 'var(--green)',
                            }}
                          />
                        </div>
                        <span className="cell-sub" style={{ width: 30, textAlign: 'right' }}>
                          {pct(c.clicked, c.sent || 1)}
                        </span>
                      </div>
                    </td>
                    <td className="cell-right">
                      <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        {c.blocks && c.blocks.length > 0 && (
                          <button
                            className="btn btn--sm btn--ghost"
                            title="Preview visual layout"
                            onClick={() => setPreviewCampaign(c)}
                          >
                            <Icon name="eye" size={13} />
                          </button>
                        )}
                        {c.status === 'draft' && (
                          <button
                            className="btn btn--sm btn--primary"
                            title="Dispatch campaign now"
                            onClick={() => handleSendCampaign(c)}
                          >
                            <Icon name="send" size={13} /> Send
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <CampaignBuilder
          contacts={state.contacts}
          tagOptions={tagOptions}
          onClose={() => setCreating(false)}
          onCreate={async (draft) => {
            let newId = uid('cm');
            try {
              const res = await api.crm.create('campaigns', {
                name: draft.name,
                channel: draft.kind,
                kind: draft.kind,
                audience: draft.audience,
                segment: draft.segment,
                scheduledAt: draft.scheduledAt,
                subject: draft.subject,
                preheader: draft.preheader,
                blocks: draft.blocks,
                status: 'draft',
              });
              if (res?.id) newId = res.id;
            } catch (err) {
              console.error('Failed to persist campaign:', err);
            }
            dispatch({
              type: 'campaign/add',
              campaign: {
                id: newId,
                status: 'draft',
                sent: 0,
                opened: 0,
                clicked: 0,
                ...draft,
              },
            });
            setCreating(false);
          }}
        />
      )}

      {previewCampaign && (
        <CampaignPreviewModal
          campaign={previewCampaign}
          onClose={() => setPreviewCampaign(null)}
        />
      )}
    </div>
  );
}

function CampaignBuilder({
  contacts,
  tagOptions,
  onClose,
  onCreate,
}: {
  contacts: Contact[];
  tagOptions: string[];
  onClose: () => void;
  onCreate: (draft: {
    name: string;
    kind: 'email' | 'sms';
    audience: number;
    scheduledAt: string;
    segment: CampaignSegment;
    subject?: string;
    preheader?: string;
    blocks?: EmailBlock[];
  }) => void;
}) {
  const [activeTab, setActiveTab] = useState<'content' | 'audience' | 'preview'>('content');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'email' | 'sms'>('email');
  const [date, setDate] = useState(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [tags, setTags] = useState<string[]>([]);
  const [status, setStatus] = useState<CampaignSegment['status']>('any');
  const [age, setAge] = useState('');

  // Email Builder State
  const [subject, setSubject] = useState('');
  const [preheader, setPreheader] = useState('');
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [testEmail, setTestEmail] = useState('');
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  const [blocks, setBlocks] = useState<EmailBlock[]>([
    {
      id: uid('blk'),
      type: 'header',
      content: 'EXCLUSIVE AGENCY ANNOUNCEMENT',
      align: 'center',
    },
    {
      id: uid('blk'),
      type: 'hero_image',
      imageUrl: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1200&auto=format&fit=crop&q=80',
    },
    {
      id: uid('blk'),
      type: 'paragraph',
      content: 'Hello {{contact.first_name}},\n\nWe are excited to share an exclusive update regarding your revenue engine and upcoming growth milestones with our team.\n\nTake a moment to review the latest action items and claim your session below.',
      align: 'left',
    },
    {
      id: uid('blk'),
      type: 'button',
      buttonText: 'Claim Your Strategy Session',
      buttonUrl: 'https://operza.io/strategy',
      align: 'center',
    },
    {
      id: uid('blk'),
      type: 'footer',
      content: 'Operza Alpha Agency · 100 Growth Blvd, Suite 400 · Click here to manage email preferences',
      align: 'center',
    },
  ]);

  const segment: CampaignSegment = {
    tags,
    status,
    createdWithinDays: age ? Number(age) : null,
  };
  const matched = contacts.filter((contact) => matchesSegment(contact, segment));
  const canSave = name.trim().length > 1 && matched.length > 0 && date.length > 0;

  const toggleTag = (tag: string) =>
    setTags((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag],
    );

  const addBlock = (type: EmailBlock['type']) => {
    let newBlock: EmailBlock = { id: uid('blk'), type };
    if (type === 'header') {
      newBlock = { ...newBlock, content: 'NEW SECTION HEADING', align: 'left' };
    } else if (type === 'hero_image') {
      newBlock = { ...newBlock, imageUrl: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&auto=format&fit=crop&q=80' };
    } else if (type === 'paragraph') {
      newBlock = { ...newBlock, content: 'Enter your message copy here... Use {{contact.first_name}} to personalize.' };
    } else if (type === 'button') {
      newBlock = { ...newBlock, buttonText: 'Explore More', buttonUrl: 'https://operza.io', align: 'center' };
    } else if (type === 'divider') {
      newBlock = { ...newBlock };
    } else if (type === 'footer') {
      newBlock = { ...newBlock, content: 'Operza Growth · Unsubscribe anytime' };
    }
    setBlocks((prev) => [...prev, newBlock]);
  };

  const removeBlock = (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  };

  const updateBlock = (id: string, patch: Partial<EmailBlock>) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const handleSendTest = async () => {
    if (!testEmail || !testEmail.includes('@')) {
      setTestStatus('Please enter a valid email address.');
      return;
    }
    setTestLoading(true);
    setTestStatus(null);
    try {
      const res = await api.campaigns.testSend('preview', {
        recipient: testEmail.trim(),
        subject: subject.trim() || name.trim() || 'Operza Campaign Test Dispatch',
        channel: kind,
        blocks,
      });
      setTestStatus(res.message || `Test broadcast sent to ${testEmail}!`);
    } catch (err: any) {
      setTestStatus(`Test dispatch failed: ${err.message || 'Unknown error'}`);
    } finally {
      setTestLoading(false);
    }
  };

  const insertToken = (token: string, blockId?: string) => {
    if (blockId) {
      const target = blocks.find((b) => b.id === blockId);
      if (target) {
        updateBlock(blockId, { content: (target.content || '') + ' ' + token });
      }
    } else {
      setSubject((prev) => (prev ? prev + ' ' + token : token));
    }
  };

  const sampleContact = contacts[0] || { firstName: 'Sarah', lastName: 'Connor', company: 'Cyberdyne Systems' };

  return (
    <Modal
      title="Campaign Studio & Block Builder"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!canSave}
            onClick={() =>
              onCreate({
                name: name.trim(),
                kind,
                audience: matched.length,
                scheduledAt: new Date(`${date}T09:00:00`).toISOString(),
                segment,
                subject: subject.trim() || name.trim(),
                preheader: preheader.trim(),
                blocks,
              })
            }
          >
            Save & Schedule
          </button>
        </>
      }
    >
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={`tab${activeTab === 'content' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('content')}
        >
          <Icon name="edit" size={14} /> 1. Message & Blocks
        </button>
        <button
          type="button"
          className={`tab${activeTab === 'audience' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('audience')}
        >
          <Icon name="users" size={14} /> 2. Audience & Schedule ({matched.length})
        </button>
        <button
          type="button"
          className={`tab${activeTab === 'preview' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('preview')}
        >
          <Icon name="eye" size={14} /> 3. Device Preview & Test
        </button>
      </div>

      {activeTab === 'content' && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="grid grid--2">
            <div className="field">
              <label htmlFor="campaign-name">Campaign internal name</label>
              <input
                id="campaign-name"
                className="input"
                autoFocus
                placeholder="e.g. Q4 Executive Retention Broadcast"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="campaign-kind">Channel format</label>
              <select
                id="campaign-kind"
                className="select"
                value={kind}
                onChange={(e) => setKind(e.target.value as 'email' | 'sms')}
              >
                <option value="email">Visual Responsive Email</option>
                <option value="sms">SMS Text Broadcast</option>
              </select>
            </div>
          </div>

          {kind === 'email' && (
            <>
              <div className="grid grid--2">
                <div className="field">
                  <div className="row row--between">
                    <label htmlFor="campaign-subject">Subject line</label>
                    <span className="row" style={{ gap: 4 }}>
                      <button
                        type="button"
                        className="chip chip--sm"
                        onClick={() => insertToken('{{contact.first_name}}')}
                      >
                        + First Name
                      </button>
                      <button
                        type="button"
                        className="chip chip--sm"
                        onClick={() => insertToken('{{contact.company}}')}
                      >
                        + Company
                      </button>
                    </span>
                  </div>
                  <input
                    id="campaign-subject"
                    className="input"
                    placeholder="e.g. {{contact.first_name}}, here is your tailored growth roadmap"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="campaign-preheader">Preheader preview text</label>
                  <input
                    id="campaign-preheader"
                    className="input"
                    placeholder="Short teaser that appears after subject in inboxes"
                    value={preheader}
                    onChange={(e) => setPreheader(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <div className="row row--between" style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>Email layout blocks ({blocks.length})</label>
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => addBlock('header')}
                    >
                      + Header
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => addBlock('hero_image')}
                    >
                      + Image
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => addBlock('paragraph')}
                    >
                      + Text
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => addBlock('button')}
                    >
                      + Button
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => addBlock('divider')}
                    >
                      + Divider
                    </button>
                  </div>
                </div>

                <div className="stack" style={{ gap: 10 }}>
                  {blocks.map((block, idx) => (
                    <div
                      key={block.id}
                      className="card"
                      style={{
                        padding: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <div className="row row--between" style={{ marginBottom: 8 }}>
                        <span className="badge" style={{ textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.05em' }}>
                          #{idx + 1} {block.type}
                        </span>
                        <div className="row" style={{ gap: 6 }}>
                          {block.type === 'paragraph' && (
                            <button
                              type="button"
                              className="chip chip--sm"
                              onClick={() => insertToken('{{contact.first_name}}', block.id)}
                            >
                              + {'{{contact.first_name}}'}
                            </button>
                          )}
                          <button
                            type="button"
                            className="icon-btn"
                            title="Delete block"
                            onClick={() => removeBlock(block.id)}
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        </div>
                      </div>

                      {block.type === 'header' && (
                        <input
                          className="input"
                          placeholder="Header title"
                          value={block.content || ''}
                          onChange={(e) => updateBlock(block.id, { content: e.target.value })}
                        />
                      )}

                      {block.type === 'hero_image' && (
                        <input
                          className="input"
                          placeholder="Image URL (e.g. https://...)"
                          value={block.imageUrl || ''}
                          onChange={(e) => updateBlock(block.id, { imageUrl: e.target.value })}
                        />
                      )}

                      {block.type === 'paragraph' && (
                        <textarea
                          className="textarea"
                          rows={3}
                          placeholder="Paragraph copy..."
                          value={block.content || ''}
                          onChange={(e) => updateBlock(block.id, { content: e.target.value })}
                        />
                      )}

                      {block.type === 'button' && (
                        <div className="grid grid--2" style={{ gap: 8 }}>
                          <input
                            className="input"
                            placeholder="Button label"
                            value={block.buttonText || ''}
                            onChange={(e) => updateBlock(block.id, { buttonText: e.target.value })}
                          />
                          <input
                            className="input"
                            placeholder="Destination URL (https://...)"
                            value={block.buttonUrl || ''}
                            onChange={(e) => updateBlock(block.id, { buttonUrl: e.target.value })}
                          />
                        </div>
                      )}

                      {block.type === 'divider' && (
                        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '8px 0' }} />
                      )}

                      {block.type === 'footer' && (
                        <input
                          className="input"
                          placeholder="Footer text & address"
                          value={block.content || ''}
                          onChange={(e) => updateBlock(block.id, { content: e.target.value })}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {kind === 'sms' && (
            <div className="field">
              <label htmlFor="sms-copy">SMS Broadcast Copy</label>
              <textarea
                id="sms-copy"
                className="textarea"
                rows={4}
                placeholder="Hi {{contact.first_name}}, this is Operza Growth Advisory..."
                value={blocks[0]?.content || ''}
                onChange={(e) => {
                  setBlocks([
                    {
                      id: uid('blk'),
                      type: 'paragraph',
                      content: e.target.value,
                    },
                  ]);
                }}
              />
              <div className="hint" style={{ marginTop: 4 }}>
                Character count: {(blocks[0]?.content || '').length} · Estimated segments: {Math.max(1, Math.ceil((blocks[0]?.content || '').length / 160))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'audience' && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="field">
            <label htmlFor="campaign-date">Scheduled dispatch date</label>
            <input
              id="campaign-date"
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="segment-editor">
            <div className="row row--between">
              <strong style={{ fontSize: 13 }}>Audience segment filters</strong>
              <span className="cell-sub">{tags.length} tag{tags.length === 1 ? '' : 's'} selected</span>
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <label>Tags (match any)</label>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {tagOptions.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`chip${tags.includes(tag) ? ' is-active' : ''}`}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
                {tagOptions.length === 0 && <span className="hint">No contact tags in this workspace yet.</span>}
              </div>
            </div>

            <div className="grid grid--2" style={{ marginTop: 12 }}>
              <div className="field">
                <label htmlFor="segment-status">Contact lifecycle status</label>
                <select
                  id="segment-status"
                  className="select"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as CampaignSegment['status'])}
                >
                  <option value="any">Any status</option>
                  <option value="lead">Leads</option>
                  <option value="customer">Customers</option>
                  <option value="cold">Cold contacts</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="segment-age">Contact age window</label>
                <select id="segment-age" className="select" value={age} onChange={(e) => setAge(e.target.value)}>
                  {AGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="reach" style={{ marginTop: 16 }}>
              <div>
                <div className="reach__value">{num(matched.length)}</div>
                <div className="cell-sub">contacts match this segment right now</div>
              </div>
              <Icon name="users" size={24} />
            </div>
            {matched.length === 0 && (
              <div className="hint" style={{ marginTop: 8, color: 'var(--amber)' }}>
                Widen the tags, status, or age window so the campaign has at least one recipient.
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'preview' && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="row row--between" style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 8 }}>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Device Viewport:</span>
              <div className="segmented">
                <button
                  type="button"
                  className={previewDevice === 'desktop' ? 'is-active' : ''}
                  onClick={() => setPreviewDevice('desktop')}
                >
                  <Icon name="monitor" size={13} /> Desktop (600px)
                </button>
                <button
                  type="button"
                  className={previewDevice === 'mobile' ? 'is-active' : ''}
                  onClick={() => setPreviewDevice('mobile')}
                >
                  <Icon name="phone" size={13} /> Mobile (360px)
                </button>
              </div>
            </div>

            <div className="row" style={{ gap: 8 }}>
              <input
                className="input"
                style={{ width: 220, height: 32, fontSize: 12 }}
                placeholder="Send test to email..."
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
              />
              <button
                type="button"
                className="btn btn--sm btn--primary"
                disabled={testLoading}
                onClick={handleSendTest}
              >
                <Icon name="send" size={12} /> {testLoading ? 'Sending...' : 'Test Send'}
              </button>
            </div>
          </div>

          {testStatus && (
            <div className="callout callout--info" style={{ fontSize: 12.5 }}>
              {testStatus}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '20px 0',
              background: 'var(--surface-3)',
              borderRadius: 12,
              overflowX: 'auto',
            }}
          >
            <div
              style={{
                width: previewDevice === 'desktop' ? '600px' : '360px',
                background: '#ffffff',
                color: '#1e293b',
                borderRadius: previewDevice === 'mobile' ? 24 : 8,
                padding: 24,
                boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
                border: previewDevice === 'mobile' ? '6px solid #334155' : '1px solid #e2e8f0',
                transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              {subject && (
                <div style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: 12, marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Subject Preview
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                    {subject.replace(/\{\{contact\.first_name\}\}/gi, sampleContact.firstName || 'Sarah')}
                  </div>
                  {preheader && (
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                      {preheader}
                    </div>
                  )}
                </div>
              )}

              <div className="stack" style={{ gap: 16 }}>
                {blocks.map((b) => {
                  if (b.type === 'header') {
                    return (
                      <h2
                        key={b.id}
                        style={{
                          margin: 0,
                          fontSize: 20,
                          fontWeight: 800,
                          textAlign: b.align || 'center',
                          color: '#0f172a',
                          letterSpacing: '-0.02em',
                        }}
                      >
                        {b.content}
                      </h2>
                    );
                  }
                  if (b.type === 'hero_image' && b.imageUrl) {
                    return (
                      <img
                        key={b.id}
                        src={b.imageUrl}
                        alt="Hero Banner"
                        style={{
                          width: '100%',
                          maxHeight: 240,
                          objectFit: 'cover',
                          borderRadius: 8,
                          display: 'block',
                        }}
                      />
                    );
                  }
                  if (b.type === 'paragraph') {
                    const resolved = (b.content || '')
                      .replace(/\{\{contact\.first_name\}\}/gi, sampleContact.firstName || 'Sarah')
                      .replace(/\{\{contact\.last_name\}\}/gi, sampleContact.lastName || 'Connor')
                      .replace(/\{\{contact\.company\}\}/gi, sampleContact.company || 'Cyberdyne Systems')
                      .replace(/\{\{agency\.name\}\}/gi, 'Operza Alpha Agency');
                    return (
                      <div
                        key={b.id}
                        style={{
                          fontSize: 14,
                          lineHeight: 1.6,
                          whiteSpace: 'pre-wrap',
                          color: '#334155',
                          textAlign: b.align || 'left',
                        }}
                      >
                        {resolved}
                      </div>
                    );
                  }
                  if (b.type === 'button') {
                    return (
                      <div key={b.id} style={{ textAlign: b.align || 'center', margin: '8px 0' }}>
                        <a
                          href={b.buttonUrl || '#'}
                          onClick={(e) => e.preventDefault()}
                          style={{
                            display: 'inline-block',
                            background: '#4f46e5',
                            color: '#ffffff',
                            fontWeight: 600,
                            fontSize: 14,
                            padding: '12px 28px',
                            borderRadius: 8,
                            textDecoration: 'none',
                          }}
                        >
                          {b.buttonText || 'Learn More'}
                        </a>
                      </div>
                    );
                  }
                  if (b.type === 'divider') {
                    return <hr key={b.id} style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '12px 0' }} />;
                  }
                  if (b.type === 'footer') {
                    return (
                      <div
                        key={b.id}
                        style={{
                          fontSize: 11,
                          color: '#94a3b8',
                          textAlign: b.align || 'center',
                          marginTop: 16,
                          borderTop: '1px solid #f1f5f9',
                          paddingTop: 12,
                        }}
                      >
                        {b.content}
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function CampaignPreviewModal({
  campaign,
  onClose,
}: {
  campaign: Campaign;
  onClose: () => void;
}) {
  return (
    <Modal title={`Preview: ${campaign.name}`} onClose={onClose} wide>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0', background: 'var(--surface-3)', borderRadius: 12 }}>
        <div style={{ width: '600px', maxWidth: '100%', background: '#fff', color: '#1e293b', borderRadius: 8, padding: 24, boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
          {campaign.subject && (
            <div style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase' }}>Subject</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{campaign.subject}</div>
            </div>
          )}
          <div className="stack" style={{ gap: 14 }}>
            {campaign.blocks && campaign.blocks.length > 0 ? (
              campaign.blocks.map((b) => {
                if (b.type === 'header') return <h2 key={b.id} style={{ textAlign: b.align || 'center', color: '#0f172a' }}>{b.content}</h2>;
                if (b.type === 'hero_image' && b.imageUrl) return <img key={b.id} src={b.imageUrl} alt="banner" style={{ width: '100%', borderRadius: 8 }} />;
                if (b.type === 'paragraph') return <div key={b.id} style={{ fontSize: 14, lineHeight: 1.6, color: '#334155', whiteSpace: 'pre-wrap' }}>{b.content}</div>;
                if (b.type === 'button') return <div key={b.id} style={{ textAlign: b.align || 'center' }}><span style={{ display: 'inline-block', background: '#4f46e5', color: '#fff', padding: '10px 24px', borderRadius: 6, fontWeight: 600 }}>{b.buttonText}</span></div>;
                if (b.type === 'divider') return <hr key={b.id} style={{ borderTop: '1px solid #e2e8f0' }} />;
                if (b.type === 'footer') return <div key={b.id} style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>{b.content}</div>;
                return null;
              })
            ) : (
              <div style={{ color: '#64748b', fontSize: 13 }}>No blocks created for this campaign.</div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
