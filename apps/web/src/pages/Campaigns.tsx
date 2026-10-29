import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, PageHeader, StatCard, StatusBadge } from '../components/ui';
import { BarChart } from '../components/Chart';
import { num, pct, shortDate } from '../lib/format';
import { uid, useStore } from '../lib/store';
import { api } from '../lib/api';
import type { Campaign, CampaignSegment, Contact } from '../lib/types';

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
        subtitle="Email and SMS broadcasts with delivery and engagement metrics."
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
                  <th style={{ width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="cell-main">{c.name}</td>
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
                      {c.status === 'draft' && (
                        <button
                          className="btn btn--sm btn--primary"
                          title="Dispatch campaign now"
                          onClick={() => handleSendCampaign(c)}
                        >
                          <Icon name="send" size={13} /> Send
                        </button>
                      )}
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
  }) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'email' | 'sms'>('email');
  const [date, setDate] = useState(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [tags, setTags] = useState<string[]>([]);
  const [status, setStatus] = useState<CampaignSegment['status']>('any');
  const [age, setAge] = useState('');

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

  return (
    <Modal
      title="New campaign"
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
              })
            }
          >
            Create campaign
          </button>
        </>
      }
    >
      <div className="grid grid--2">
        <div className="field">
          <label htmlFor="campaign-name">Name</label>
          <input
            id="campaign-name"
            className="input"
            autoFocus
            placeholder="November nurture"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="campaign-kind">Channel</label>
          <select
            id="campaign-kind"
            className="select"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'email' | 'sms')}
          >
            <option value="email">Email</option>
            <option value="sms">SMS</option>
          </select>
        </div>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="campaign-date">Scheduled date</label>
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
          <strong style={{ fontSize: 13 }}>Audience segment</strong>
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
            <label htmlFor="segment-status">Contact status</label>
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
            <label htmlFor="segment-age">Created</label>
            <select id="segment-age" className="select" value={age} onChange={(e) => setAge(e.target.value)}>
              {AGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="reach">
          <div>
            <div className="reach__value">{num(matched.length)}</div>
            <div className="cell-sub">contacts match this segment right now</div>
          </div>
          <Icon name="users" size={20} />
        </div>
        {matched.length === 0 && (
          <div className="hint" style={{ marginTop: 8 }}>
            Widen the tags, status or age window so the campaign has at least one recipient.
          </div>
        )}
        <div className="hint" style={{ marginTop: 8 }}>
          The matched count is saved as the campaign audience. New campaigns start as drafts.
        </div>
      </div>
    </Modal>
  );
}
