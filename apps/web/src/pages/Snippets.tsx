import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, PageHeader, StatCard } from '../components/ui';
import { num } from '../lib/format';
import { CHANNEL_META, uid, useStore } from '../lib/store';
import { api } from '../lib/api';
import type { Channel, Snippet } from '../lib/types';

const CHANNELS = Object.keys(CHANNEL_META) as Channel[];
const FILTERS = ['all', ...CHANNELS] as const;
type Filter = (typeof FILTERS)[number];

export default function Snippets() {
  const { state, dispatch } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Snippet | null>(null);
  const [resolvedPreview, setResolvedPreview] = useState<{ label: string; subject?: string; body: string; tokensResolved: number } | null>(null);

  // Sync snippets with backend database
  useEffect(() => {
    let active = true;
    api.crm.list<Snippet>('snippets')
      .then((res) => {
        if (!active || !res || !Array.isArray(res)) return;
        for (const item of res) {
          if (!state.snippets.some((s) => s.id === item.id)) {
            dispatch({ type: 'snippet/add', snippet: item });
          }
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [dispatch, state.snippets]);

  const q = query.trim().toLowerCase();
  const rows = state.snippets.filter((s) => {
    if (filter !== 'all' && s.channel !== filter) return false;
    if (!q) return true;
    return `${s.label} ${s.body}`.toLowerCase().includes(q);
  });

  const uses = state.snippets.reduce((sum, s) => sum + s.uses, 0);
  const shared = state.snippets.filter((s) => !s.channel).length;
  const mostUsed = [...state.snippets].sort((a, b) => b.uses - a.uses)[0];

  async function handleTestUse(snippet: Snippet) {
    const contactId = state.contacts[0]?.id;
    try {
      const res = await api.snippets.use(snippet.id, contactId);
      if (res?.success) {
        setResolvedPreview({
          label: snippet.label,
          subject: res.resolvedSubject,
          body: res.resolvedBody,
          tokensResolved: res.tokensResolved,
        });
        dispatch({ type: 'snippet/use', id: snippet.id });
      }
    } catch {
      // Local fallback
      dispatch({ type: 'snippet/use', id: snippet.id });
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.crm.delete('snippets', id);
    } catch {
      /* fallback */
    }
    dispatch({ type: 'snippet/delete', id });
  }

  return (
    <div className="content">
      <PageHeader
        title="Snippets"
        subtitle="Reusable replies that fill merge tokens from the contact and custom values."
        actions={
          <button className="btn btn--primary" type="button" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> New snippet
          </button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Snippets" value={num(state.snippets.length)} icon={<Icon name="zap" size={15} />} meta="saved replies" />
        <StatCard label="Inserts" value={num(uses)} icon={<Icon name="send" size={15} />} meta="across all channels" />
        <StatCard label="Any channel" value={num(shared)} icon={<Icon name="globe" size={15} />} meta="not channel-locked" />
        <StatCard
          label="Most used"
          value={mostUsed ? num(mostUsed.uses) : '0'}
          icon={<Icon name="chart" size={15} />}
          meta={mostUsed?.label ?? 'no snippets yet'}
        />
      </div>

      <div className="card">
        <div className="card__head">
          <div>
            <div className="card__title">Reply library</div>
            <div className="card__sub">{rows.length} of {state.snippets.length}</div>
          </div>
          <div className="card__actions">
            <div className="search" style={{ width: 220 }}>
              <Icon name="search" size={15} />
              <input
                className="input"
                placeholder="Search snippets"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="segmented" style={{ margin: '0 16px 12px' }}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={filter === f ? 'is-active' : ''}
              onClick={() => setFilter(f)}
              style={{ textTransform: 'capitalize' }}
            >
              {f === 'all' ? 'All' : CHANNEL_META[f].label}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Icon name="zap" size={22} />}
            title={state.snippets.length === 0 ? 'No snippets yet' : 'No matches'}
            text={
              state.snippets.length === 0
                ? 'Save a reply once and reuse it from the conversation composer.'
                : 'Try another channel filter or search term.'
            }
            action={
              state.snippets.length === 0 ? (
                <button className="btn btn--sm" type="button" onClick={() => setCreating(true)}>
                  New snippet
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Snippet</th>
                  <th style={{ width: 120 }}>Channel</th>
                  <th style={{ width: 80 }}>Uses</th>
                  <th style={{ width: 110 }} className="cell-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((snippet) => (
                  <tr key={snippet.id}>
                    <td>
                      <div style={{ fontSize: 13, fontWeight: 550 }}>{snippet.label}</div>
                      {snippet.subject && (
                        <div className="cell-sub" style={{ fontStyle: 'italic' }}>
                          {snippet.subject}
                        </div>
                      )}
                      <div className="cell-sub" style={{ maxWidth: 560, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {snippet.body}
                      </div>
                    </td>
                    <td>
                      {snippet.channel ? (
                        <Badge>
                          {CHANNEL_META[snippet.channel].label}
                        </Badge>
                      ) : (
                        <Badge tone="blue">Any channel</Badge>
                      )}
                    </td>
                    <td className="cell-sub">{num(snippet.uses)}</td>
                    <td className="cell-right">
                      <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn--sm"
                          title="Simulate insertion and token resolution"
                          onClick={() => handleTestUse(snippet)}
                        >
                          <Icon name="zap" size={12} /> Test
                        </button>
                        <button className="icon-btn" aria-label={`Edit ${snippet.label}`} onClick={() => setEditing(snippet)}>
                          <Icon name="edit" size={15} />
                        </button>
                        <button
                          className="icon-btn"
                          aria-label={`Delete ${snippet.label}`}
                          onClick={() => handleDelete(snippet.id)}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="hint" style={{ marginTop: 10 }}>
        Merge tokens resolve dynamically when inserted: <span className="mono-cell">{'{{contact.firstName}}'}</span>,{' '}
        <span className="mono-cell">{'{{contact.company}}'}</span>,{' '}
        <span className="mono-cell">{'{{agency.name}}'}</span> and{' '}
        <span className="mono-cell">{'{{custom_values.<name>}}'}</span>.
      </div>

      {(creating || editing) && (
        <SnippetModal
          snippet={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={async (draft) => {
            if (editing) {
              try {
                await api.crm.update('snippets', editing.id, draft);
              } catch {
                /* fallback */
              }
              dispatch({ type: 'snippet/update', id: editing.id, patch: draft });
            } else {
              const newSnippet: Snippet = { ...draft, id: uid('sn'), uses: 0 };
              try {
                const res = await api.crm.create<Snippet>('snippets', newSnippet);
                dispatch({ type: 'snippet/add', snippet: res || newSnippet });
              } catch {
                dispatch({ type: 'snippet/add', snippet: newSnippet });
              }
            }
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {resolvedPreview && (
        <Modal
          title={`Snippet Resolution Preview · ${resolvedPreview.label}`}
          onClose={() => setResolvedPreview(null)}
          footer={
            <button className="btn btn--primary" type="button" onClick={() => setResolvedPreview(null)}>
              Done
            </button>
          }
        >
          <div className="stack" style={{ gap: 12 }}>
            <div className="row row--between">
              <Badge tone="green">{resolvedPreview.tokensResolved} dynamic tokens resolved</Badge>
              {state.contacts[0] && (
                <span className="hint">Previewed with {state.contacts[0].firstName} {state.contacts[0].lastName}</span>
              )}
            </div>

            {resolvedPreview.subject && (
              <div className="field">
                <label>Resolved subject</label>
                <div className="template__subject">{resolvedPreview.subject}</div>
              </div>
            )}

            <div className="field">
              <label>Resolved body</label>
              <div
                style={{
                  padding: '12px 14px',
                  background: 'var(--surface-2)',
                  borderRadius: 'var(--radius)',
                  fontSize: 13,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {resolvedPreview.body}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SnippetModal({
  snippet,
  onClose,
  onSave,
}: {
  snippet?: Snippet;
  onClose: () => void;
  onSave: (draft: Omit<Snippet, 'id' | 'uses'>) => void;
}) {
  const [label, setLabel] = useState(snippet?.label ?? '');
  const [subject, setSubject] = useState(snippet?.subject ?? '');
  const [body, setBody] = useState(snippet?.body ?? '');
  const [channel, setChannel] = useState<Channel | ''>(snippet?.channel ?? '');

  const canSave = label.trim().length > 0 && body.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    onSave({
      label: label.trim(),
      subject: subject.trim() ? subject.trim() : undefined,
      body: body.trim(),
      channel: channel === '' ? undefined : channel,
    });
  };

  return (
    <Modal
      title={snippet ? `Edit ${snippet.label}` : 'New snippet'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSave} onClick={save}>
            {snippet ? 'Save changes' : 'Create snippet'}
          </button>
        </>
      }
    >
      <div className="grid grid--2">
        <div className="field">
          <label htmlFor="snippet-label">Label</label>
          <input
            id="snippet-label"
            className="input"
            autoFocus
            placeholder="Follow-up after discovery"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="snippet-channel">Channel</label>
          <select
            id="snippet-channel"
            className="select"
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel | '')}
          >
            <option value="">Any channel</option>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_META[c].label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="snippet-subject">Email subject (optional)</label>
        <input
          id="snippet-subject"
          className="input"
          placeholder="Following up from today"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <div className="hint">Filled into the subject line when this snippet is inserted into an email thread.</div>
      </div>
      <div className="field">
        <label htmlFor="snippet-body">Body</label>
        <textarea
          id="snippet-body"
          className="input"
          rows={5}
          placeholder={`Hi {{contact.firstName}}, thanks for meeting with us…`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="hint">
          Use merge tokens like {'{{contact.firstName}}'} or {'{{custom_values.booking_url}}'} — they resolve when inserted.
        </div>
      </div>
    </Modal>
  );
}