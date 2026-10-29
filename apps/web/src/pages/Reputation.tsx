import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, EmptyState, PageHeader, StatCard, Switch } from '../components/ui';
import { useStore, uid } from '../lib/store';
import { resolveMerge } from '../lib/merge';
import { fullDate, num, relative, shortDate, timeOf, toDateTimeInput } from '../lib/format';
import type { ReviewRequest, ReviewRequestChannel } from '../lib/types';

const REVIEW_LINK = 'https://g.page/r/asim-growth/review';
const DEFAULT_MESSAGE =
  'Hi {{contact.first_name}}, thanks for working with us! Would you leave a quick review? {{custom_values.review_link}}';

const SOURCE_META = {
  google: { label: 'Google', icon: 'google' },
  facebook: { label: 'Facebook', icon: 'facebook' },
  yelp: { label: 'Yelp', icon: 'star' },
} as const;

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <span className="stars" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= rating ? 'stars__on' : 'stars__off'}>
          <Icon name="star" size={size} />
        </span>
      ))}
    </span>
  );
}

type Filter = 'all' | 'new' | 'replied' | 'flagged';

export default function Reputation() {
  const { state, dispatch } = useStore();
  const { reviews, listings, reviewRequests } = state;
  const [filter, setFilter] = useState<Filter>('all');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const replied = reviews.filter((r) => r.status === 'replied').length;
  const pending = reviews.filter((r) => r.status === 'new').length;
  const sentRequests = reviewRequests.filter((r) => r.sentAt).length;
  const queuedRequests = reviewRequests.length - sentRequests;

  const copyReviewLink = async () => {
    let copied: boolean;
    try {
      await navigator.clipboard.writeText(REVIEW_LINK);
      copied = true;
    } catch {
      const el = document.createElement('textarea');
      el.value = REVIEW_LINK;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      try {
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      }
      el.remove();
    }
    setLinkCopied(copied);
    if (copied) setTimeout(() => setLinkCopied(false), 2000);
  };

  const distribution = useMemo(
    () =>
      [5, 4, 3, 2, 1].map((rating) => ({
        rating,
        count: reviews.filter((r) => r.rating === rating).length,
      })),
    [reviews],
  );
  const maxBucket = Math.max(...distribution.map((d) => d.count), 1);

  const visible = reviews.filter((r) => (filter === 'all' ? true : r.status === filter));

  const contactName = (id: string) => {
    const c = state.contacts.find((x) => x.id === id);
    return c ? `${c.firstName} ${c.lastName}` : 'Unknown contact';
  };

  function submitReply(id: string) {
    const body = draft.trim();
    if (!body) return;
    dispatch({ type: 'review/reply', id, reply: body });
    setReplyingTo(null);
    setDraft('');
  }

  return (
    <div className="content">
      <PageHeader
        title="Reputation"
        subtitle="Collect reviews, reply to feedback and watch your listings."
        actions={
          <>
            <button className="btn" onClick={copyReviewLink}>
              <Icon name={linkCopied ? 'check' : 'link'} size={15} /> {linkCopied ? 'Link copied' : 'Review link'}
            </button>
            <button className="btn btn--primary" onClick={() => setRequesting(true)}>
              <Icon name="send" size={15} /> Request reviews
            </button>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard
          label="Average rating"
          value={avg.toFixed(1)}
          icon={<Icon name="star" size={15} />}
          meta={`${reviews.length} reviews`}
        />
        <StatCard
          label="Awaiting reply"
          value={num(pending)}
          icon={<Icon name="message" size={15} />}
          meta="respond within 24h"
        />
        <StatCard
          label="Response rate"
          value={`${Math.round((replied / Math.max(reviews.length, 1)) * 100)}%`}
          icon={<Icon name="check" size={15} />}
          meta={`${replied} replied`}
        />
        <StatCard
          label="Requests sent"
          value={num(sentRequests)}
          icon={<Icon name="send" size={15} />}
          meta={`${queuedRequests} scheduled`}
        />
      </div>

      <div className="grid grid--3" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card__head">
            <div className="card__title">Rating breakdown</div>
          </div>
          <div className="card__body stack" style={{ gap: 10 }}>
            {distribution.map((row) => (
              <div key={row.rating} className="row" style={{ gap: 10 }}>
                <span className="hint" style={{ width: 34 }}>
                  {row.rating} ★
                </span>
                <div className="meter" style={{ flex: 1 }}>
                  <div
                    className="meter__fill"
                    style={{
                      width: `${(row.count / maxBucket) * 100}%`,
                      background: row.rating >= 4 ? 'var(--green)' : row.rating === 3 ? '#f59e0b' : 'var(--red)',
                    }}
                  />
                </div>
                <span className="cell-num" style={{ width: 22, textAlign: 'right' }}>
                  {row.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ gridColumn: 'span 2' }}>
          <div className="card__head">
            <div>
              <div className="card__title">Connected listings</div>
              <div className="card__sub">Reviews sync from each source</div>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Listing</th>
                  <th>Source</th>
                  <th className="cell-right">Rating</th>
                  <th className="cell-right">Reviews</th>
                  <th className="cell-right">Sync</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((l) => (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600 }}>{l.name}</td>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        <Icon name={SOURCE_META[l.source].icon} size={14} />
                        {SOURCE_META[l.source].label}
                      </span>
                    </td>
                    <td className="cell-right cell-num">{l.rating.toFixed(1)}</td>
                    <td className="cell-right cell-num">{l.reviews}</td>
                    <td className="cell-right">
                      <span style={{ display: 'inline-flex' }}>
                        <Switch
                          on={l.connected}
                          label={`Toggle ${l.source} sync`}
                          onChange={() => dispatch({ type: 'listing/toggle', id: l.id })}
                        />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <div>
            <div className="card__title">Review requests</div>
            <div className="card__sub">
              {sentRequests} sent · {queuedRequests} scheduled
            </div>
          </div>
          <div className="card__actions">
            <button className="btn btn--sm" onClick={() => setRequesting(true)}>
              <Icon name="plus" size={14} /> New request
            </button>
          </div>
        </div>
        {reviewRequests.length === 0 ? (
          <div className="card__body">
            <EmptyState
              icon={<Icon name="send" size={22} />}
              title="No requests yet"
              text="Ask a happy customer for a review."
            />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Channel</th>
                  <th>Message</th>
                  <th>Scheduled</th>
                  <th>Status</th>
                  <th className="cell-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...reviewRequests]
                  .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))
                  .map((request) => {
                    const contact = state.contacts.find((c) => c.id === request.contactId);
                    const preview = resolveMerge(request.message, contact, state.customValues);
                    const recipient = contact ? `${contact.firstName} ${contact.lastName}` : 'Unknown contact';
                    return (
                      <tr key={request.id}>
                        <td style={{ fontWeight: 600 }}>{recipient}</td>
                        <td>
                          <span className="row" style={{ gap: 6 }}>
                            <Icon name={request.channel === 'email' ? 'mail' : 'message'} size={14} />
                            {request.channel === 'email' ? 'Email' : 'SMS'}
                          </span>
                        </td>
                        <td className="cell-sub" style={{ maxWidth: 300 }}>
                          <span title={preview}>
                            {preview.length > 64 ? `${preview.slice(0, 64)}…` : preview}
                          </span>
                        </td>
                        <td className="cell-sub">
                          {shortDate(request.scheduledAt)} · {timeOf(request.scheduledAt)}
                        </td>
                        <td>
                          {request.sentAt ? (
                            <Badge tone="green" dot>
                              Sent
                            </Badge>
                          ) : (
                            <Badge tone="violet" dot>
                              Scheduled
                            </Badge>
                          )}
                        </td>
                        <td className="cell-right">
                          <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                            {!request.sentAt && (
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() => dispatch({ type: 'reviewRequest/send', id: request.id })}
                              >
                                <Icon name="send" size={13} /> Send now
                              </button>
                            )}
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={`Delete request for ${recipient}`}
                              onClick={() => dispatch({ type: 'reviewRequest/delete', id: request.id })}
                            >
                              <Icon name="trash" size={14} />
                            </button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card__head">
          <div>
            <div className="card__title">Reviews</div>
            <div className="card__sub">{visible.length} shown</div>
          </div>
          <div className="card__actions">
            <div className="tabs" style={{ margin: 0 }}>
              {(['all', 'new', 'replied', 'flagged'] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`tab${filter === f ? ' is-active' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="card__body">
            <EmptyState
              icon={<Icon name="star" size={22} />}
              title="No reviews here"
              text="Nothing matches this filter yet."
            />
          </div>
        ) : (
          <div className="card__body stack" style={{ gap: 14 }}>
            {visible.map((review) => (
              <div key={review.id} className="review">
                <div className="review__head">
                  <Avatar name={contactName(review.contactId)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <strong style={{ fontSize: 13.5 }}>{contactName(review.contactId)}</strong>
                      <Badge>{SOURCE_META[review.source].label}</Badge>
                      {review.status === 'new' && <Badge tone="amber">New</Badge>}
                      {review.status === 'flagged' && <Badge tone="red">Flagged</Badge>}
                    </div>
                    <div className="row" style={{ gap: 8, marginTop: 3 }}>
                      <Stars rating={review.rating} />
                      <span className="cell-sub" title={fullDate(review.at)}>
                        {relative(review.at)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() =>
                      dispatch({
                        type: 'review/status',
                        id: review.id,
                        status: review.status === 'flagged' ? 'new' : 'flagged',
                      })
                    }
                  >
                    <Icon name={review.status === 'flagged' ? 'refresh' : 'x'} size={14} />
                    {review.status === 'flagged' ? 'Unflag' : 'Flag'}
                  </button>
                </div>

                <p className="review__body">{review.body}</p>

                {review.reply ? (
                  <div className="review__reply">
                    <div className="review__reply-label">
                      <Icon name="message" size={13} /> Your reply
                    </div>
                    <div>{review.reply}</div>
                  </div>
                ) : replyingTo === review.id ? (
                  <div className="stack" style={{ gap: 8 }}>
                    <textarea
                      className="input"
                      rows={3}
                      autoFocus
                      placeholder="Write a public reply…"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn btn--primary btn--sm" type="button" onClick={() => submitReply(review.id)}>
                        <Icon name="send" size={13} /> Post reply
                      </button>
                      <button
                        className="btn btn--sm"
                        type="button"
                        onClick={() => {
                          setReplyingTo(null);
                          setDraft('');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="btn btn--sm"
                    type="button"
                    onClick={() => {
                      setReplyingTo(review.id);
                      setDraft('');
                    }}
                  >
                    <Icon name="message" size={13} /> Reply
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {requesting && <RequestModal onClose={() => setRequesting(false)} />}
    </div>
  );
}

function RequestModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const contacts = state.contacts;
  const [contactId, setContactId] = useState(
    contacts.find((c) => c.status === 'customer')?.id ?? contacts[0]?.id ?? '',
  );
  const [channel, setChannel] = useState<ReviewRequestChannel>('email');
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [timing, setTiming] = useState<'now' | 'later'>('later');
  const [when, setWhen] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return toDateTimeInput(d);
  });

  const contact = contacts.find((c) => c.id === contactId);
  const preview = resolveMerge(message, contact, state.customValues);
  const scheduleValid = timing === 'now' || !Number.isNaN(new Date(when).getTime());
  const canSend = Boolean(contact) && message.trim().length > 0 && scheduleValid;

  const submit = () => {
    if (!canSend) return;
    const request: ReviewRequest = {
      id: uid('rr'),
      contactId,
      channel,
      message: message.trim(),
      scheduledAt: timing === 'now' ? new Date().toISOString() : new Date(when).toISOString(),
    };
    dispatch({ type: 'reviewRequest/add', request });
    if (timing === 'now') dispatch({ type: 'reviewRequest/send', id: request.id });
    onClose();
  };

  return (
    <Modal
      title="Request a review"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSend} onClick={submit}>
            <Icon name="send" size={14} /> {timing === 'now' ? 'Send request' : 'Schedule request'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="rr-contact">Recipient</label>
          <select
            id="rr-contact"
            className="select"
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
          >
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName} — {c.email}
              </option>
            ))}
          </select>
        </div>

        <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Channel</label>
            <div className="segmented">
              {(['email', 'sms'] as ReviewRequestChannel[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={channel === c ? 'is-active' : ''}
                  onClick={() => setChannel(c)}
                >
                  {c === 'email' ? 'Email' : 'SMS'}
                </button>
              ))}
            </div>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>When</label>
            <div className="segmented">
              {(['later', 'now'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={timing === t ? 'is-active' : ''}
                  onClick={() => setTiming(t)}
                >
                  {t === 'now' ? 'Send now' : 'Schedule'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {timing === 'later' && (
          <div className="field">
            <label htmlFor="rr-when">Send at</label>
            <input
              id="rr-when"
              className="input"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="rr-message">Message</label>
          <textarea
            id="rr-message"
            className="input"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="hint">
            Tokens resolve per recipient: <code>{'{{contact.first_name}}'}</code>,{' '}
            <code>{'{{custom_values.review_link}}'}</code>
          </div>
        </div>

        <div className="callout" style={{ fontSize: 12.5 }}>
          <strong style={{ display: 'block', marginBottom: 4 }}>Preview</strong>
          {preview}
        </div>
      </div>
    </Modal>
  );
}
