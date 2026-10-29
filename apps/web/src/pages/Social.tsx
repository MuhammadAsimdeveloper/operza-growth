import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, PageHeader, StatCard, StatusBadge } from '../components/ui';
import { useStore, uid } from '../lib/store';
import { num, shortDate, timeOf, toDateTimeInput } from '../lib/format';
import type { SocialPost } from '../lib/types';

const PLATFORMS: Array<SocialPost['platforms'][number]> = ['facebook', 'instagram', 'linkedin', 'tiktok', 'google'];
const COLUMNS: Array<{ status: SocialPost['status']; title: string }> = [
  { status: 'draft', title: 'Drafts' },
  { status: 'scheduled', title: 'Scheduled' },
  { status: 'published', title: 'Published' },
];

export default function Social() {
  const { state, dispatch } = useStore();
  const [composing, setComposing] = useState(false);

  const published = state.posts.filter((p) => p.status === 'published');
  const engagement = published.reduce((s, p) => s + p.likes + p.comments, 0);

  return (
    <div className="content">
      <PageHeader
        title="Social Planner"
        subtitle="Plan, schedule and review posts across every connected channel."
        actions={
          <button className="btn btn--primary" onClick={() => setComposing(true)}>
            <Icon name="plus" size={16} /> New post
          </button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Scheduled" value={String(state.posts.filter((p) => p.status === 'scheduled').length)} icon={<Icon name="clock" size={15} />} meta="upcoming posts" />
        <StatCard label="Published" value={String(published.length)} icon={<Icon name="check" size={15} />} meta="this month" />
        <StatCard label="Engagement" value={num(engagement)} icon={<Icon name="sparkles" size={15} />} meta="likes + comments" />
        <StatCard label="Channels" value={String(new Set(state.posts.flatMap((p) => p.platforms)).size)} icon={<Icon name="share" size={15} />} meta="connected networks" />
      </div>

      <div className="board">
        {COLUMNS.map((col) => {
          const posts = state.posts
            .filter((p) => p.status === col.status)
            .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
          return (
            <div className="column" key={col.status} style={{ flex: '1 1 300px' }}>
              <div className="column__head">
                <span className="column__name">{col.title}</span>
                <span className="column__count">{posts.length}</span>
              </div>
              <div className="column__list" style={{ minHeight: 120 }}>
                {posts.length === 0 && (
                  <div className="empty" style={{ padding: '28px 12px' }}>
                    <span className="hint">Nothing here</span>
                  </div>
                )}
                {posts.map((p) => (
                  <article key={p.id} className="deal" style={{ cursor: 'default' }}>
                    <div className="row" style={{ gap: 5, marginBottom: 7 }}>
                      {p.platforms.map((pl) => (
                        <span
                          key={pl}
                          className="nav__icon"
                          title={pl}
                          style={{ background: 'var(--surface-3)', borderRadius: 5, padding: 3, color: 'var(--text-2)' }}
                        >
                          <Icon name={pl} size={13} />
                        </span>
                      ))}
                      <span className="spacer" />
                      {p.status !== 'published' ? (
                        <button
                          className="btn btn--ghost btn--sm"
                          style={{ height: 22, padding: '0 6px' }}
                          onClick={() =>
                            dispatch({
                              type: 'post/status',
                              id: p.id,
                              status: p.status === 'draft' ? 'scheduled' : 'published',
                            })
                          }
                        >
                          {p.status === 'draft' ? 'Schedule' : 'Publish'}
                        </button>
                      ) : (
                        <StatusBadge status="published" />
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>{p.body}</div>
                    <div className="deal__foot" style={{ marginTop: 9 }}>
                      <span className="cell-sub">
                        {shortDate(p.scheduledAt)} · {timeOf(p.scheduledAt)}
                      </span>
                      {p.status === 'published' && (
                        <span className="row" style={{ gap: 8, fontSize: 11.5, color: 'var(--text-3)' }}>
                          <span className="row" style={{ gap: 3 }}>
                            <Icon name="star" size={12} /> {p.likes}
                          </span>
                          <span className="row" style={{ gap: 3 }}>
                            <Icon name="message" size={12} /> {p.comments}
                          </span>
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__head">
          <div className="card__title">Connected channels</div>
          <div className="card__actions">
            <button className="btn btn--ghost btn--sm">Manage</button>
          </div>
        </div>
        <div className="card__body row row--wrap" style={{ gap: 10 }}>
          {PLATFORMS.map((p) => (
            <span key={p} className="tag" style={{ height: 28, padding: '0 11px', gap: 7, textTransform: 'capitalize' }}>
              <Icon name={p} size={14} /> {p}
            </span>
          ))}
        </div>
      </div>

      {composing && (
        <Composer
          onClose={() => setComposing(false)}
          onSave={(post) => {
            dispatch({ type: 'post/add', post });
            setComposing(false);
          }}
        />
      )}
    </div>
  );
}

function Composer({ onClose, onSave }: { onClose: () => void; onSave: (post: SocialPost) => void }) {
  const [body, setBody] = useState('');
  const [selected, setSelected] = useState<SocialPost['platforms']>(['facebook']);
  const [when, setWhen] = useState(toDateTimeInput(new Date(Date.now() + 86_400_000)));

  const toggle = (platform: SocialPost['platforms'][number]) =>
    setSelected((prev) => (prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]));

  return (
    <Modal
      title="Create post"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            disabled={!body.trim() || selected.length === 0}
            onClick={() =>
              onSave({
                id: uid('post'),
                body: body.trim(),
                platforms: selected,
                status: 'draft',
                scheduledAt: new Date(when).toISOString(),
                likes: 0,
                comments: 0,
              })
            }
          >
            Save draft
          </button>
          <button
            className="btn btn--primary"
            disabled={!body.trim() || selected.length === 0}
            onClick={() =>
              onSave({
                id: uid('post'),
                body: body.trim(),
                platforms: selected,
                status: 'scheduled',
                scheduledAt: new Date(when).toISOString(),
                likes: 0,
                comments: 0,
              })
            }
          >
            Schedule
          </button>
        </>
      }
    >
      <div className="field">
        <label>Post copy</label>
        <textarea
          className="textarea"
          placeholder="What do you want to share?"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          style={{ minHeight: 110 }}
          autoFocus
        />
        <span className="hint">{body.length} characters</span>
      </div>
      <div className="field">
        <label>Channels</label>
        <div className="row row--wrap" style={{ gap: 6 }}>
          {PLATFORMS.map((p) => {
            const on = selected.includes(p);
            return (
              <button
                key={p}
                type="button"
                className="btn btn--sm"
                onClick={() => toggle(p)}
                style={{
                  textTransform: 'capitalize',
                  borderColor: on ? 'var(--accent)' : undefined,
                  background: on ? 'var(--accent-soft)' : undefined,
                  color: on ? 'var(--accent-ink)' : undefined,
                }}
              >
                <Icon name={p} size={13} /> {p}
              </button>
            );
          })}
        </div>
      </div>
      <div className="field">
        <label>Schedule for</label>
        <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </div>
      {selected.length > 0 && (
        <div className="note">
          <div className="note__body">{body || 'Your post preview appears here.'}</div>
          <div className="note__meta">
            {selected.map((s) => `#${s}`).join(' ')} · {shortDate(new Date(when).toISOString())}
          </div>
        </div>
      )}
      <Badge tone="accent">Tip: drafts can be scheduled from the board later.</Badge>
    </Modal>
  );
}
