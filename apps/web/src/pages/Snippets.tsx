import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, PageHeader, StatCard } from '../components/ui';
import { num } from '../lib/format';
import { CHANNEL_META, uid, useStore } from '../lib/store';
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

  const q = query.trim().toLowerCase();
  const rows = state.snippets.filter((s) => {
    if (filter !== 'all' && s.channel !== filter) return false;
    if (!q) return true;
    return `${s.label} ${s.body}`.toLowerCase().includes(q);
  });

  const uses = state.snippets.reduce((sum, s) => sum + s.uses, 0);
  const shared = state.snippets.filter((s) => !s.channel).length;
  const mostUsed = [...state.snippets].sort((a, b) => b.uses - a.uses)[0];

  return (
    <div className="content">
      <PageHeader
        title="Snippets"
        subtitle="Reusable replies that fill merge tokens from the contact and custom values."
        actions={
          <button className="btn btn--primary" onClick={() => setCreating(true)}>
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
                <button className="btn btn--sm" onClick={() => setCreating(true)}>
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
                  <th style={{ width: 52 }} />
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
                      <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                        <button className="icon-btn" aria-label={`Edit ${snippet.label}`} onClick={() => setEditing(snippet)}>
                          <Icon name="edit" size={15} />
                        </button>
                        <button
                          className="icon-btn"
                          aria-label={`Delete ${snippet.label}`}
                          onClick={() => dispatch({ type: 'snippet/delete', id: snippet.id })}
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
        Merge tokens resolve when a snippet is inserted: <span className="mono-cell">{'{{contact.first_name}}'}</span>,{' '}
        <span className="mono-cell">{'{{contact.company}}'}</span> and{' '}
        <span className="mono-cell">{'{{custom_values.<name>}}'}</span>. Unknown tokens are left as written.
      </div>

      {(creating || editing) && (
        <SnippetModal
          snippet={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={(draft) => {
            if (editing) {
              dispatch({ type: 'snippet/update', id: editing.id, patch: draft });
            } else {
              dispatch({ type: 'snippet/add', snippet: { ...draft, id: uid('sn'), uses: 0 } });
            }
            setCreating(false);
            setEditing(null);
          }}
        />
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
          placeholder={`Hi {{contact.first_name}}, thanks for meeting with us…`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="hint">
          Use merge tokens like {'{{contact.first_name}}'} or {'{{custom_values.booking_url}}'} — they resolve when inserted.
        </div>
      </div>
    </Modal>
  );
}
