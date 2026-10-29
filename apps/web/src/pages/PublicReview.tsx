import { useState, useEffect, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';

interface ReviewInfo {
  locationId: string;
  locationName: string;
  agencyName: string;
  prompt: string;
}

const RATING_LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Exceptional!'];

export default function PublicReview() {
  const { id } = useParams<{ id: string }>();
  const [info, setInfo] = useState<ReviewInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Form Fields
  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [text, setText] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submittedReview, setSubmittedReview] = useState<any | null>(null);

  useEffect(() => {
    const locId = id || 'main';
    setLoading(true);
    api.reviews
      .getPublic(locId)
      .then((data) => {
        setInfo(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Review portal unavailable.');
        setLoading(false);
      });
  }, [id]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const locId = id || 'main';
    setSubmitting(true);
    setError('');

    try {
      const res = await api.reviews.submitPublic(locId, {
        contactName: name,
        email,
        rating,
        text,
        source: 'Client Review Portal'
      });
      setSubmittedReview(res.review);
    } catch (err: any) {
      setError(err.message || 'Failed to submit review. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.centerBox}>
        <div style={styles.spinner} />
        <p style={{ color: 'var(--text-3, #94a3b8)', marginTop: 12 }}>Loading review portal…</p>
      </div>
    );
  }

  if (submittedReview) {
    const isPromoter = submittedReview.rating >= 4;

    return (
      <div style={styles.centerBox}>
        <div style={{ ...styles.card, maxWidth: 520, textAlign: 'center' }}>
          <div style={{ ...styles.checkIcon, background: isPromoter ? '#dcfce7' : '#fef3c7', color: isPromoter ? '#16a34a' : '#b45309' }}>
            {isPromoter ? '★' : '✓'}
          </div>

          <h2 style={{ color: 'var(--text-1, #0f172a)', margin: '16px 0 8px 0', fontSize: 24, fontWeight: 700 }}>
            {isPromoter ? 'Thank You for Your Feedback!' : 'Thank You for Your Honesty'}
          </h2>

          <p style={{ color: 'var(--text-2, #475569)', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
            {isPromoter
              ? `We are thrilled you had an exceptional experience with ${info?.agencyName || 'our team'}! Your feedback motivates our specialists to continue delivering top results.`
              : `We take your feedback seriously. A high-priority review ticket has been assigned to our customer success lead to address your feedback directly.`}
          </p>

          <div style={styles.detailsBox}>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Rating:</span>
              <strong style={{ ...styles.detailValue, color: '#eab308' }}>
                {'★'.repeat(submittedReview.rating)}{'☆'.repeat(5 - submittedReview.rating)} ({submittedReview.rating}/5)
              </strong>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Reviewer:</span>
              <strong style={styles.detailValue}>{submittedReview.contactName}</strong>
            </div>
            {submittedReview.text && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border, #e2e8f0)', textAlign: 'left' }}>
                <span style={{ fontSize: 12, color: 'var(--text-3, #64748b)', fontStyle: 'italic' }}>
                  "{submittedReview.text}"
                </span>
              </div>
            )}
          </div>

          {isPromoter && (
            <div style={{ marginTop: 20, padding: '12px 16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: 13, color: '#334155', fontWeight: 500 }}>
                💡 Would you mind taking 30 seconds to copy your review to Google?
              </span>
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            <span style={{ fontSize: 12, color: 'var(--text-3, #94a3b8)' }}>
              Operza Reputation Management
            </span>
          </div>
        </div>
      </div>
    );
  }

  const effectiveRating = hoverRating || rating;

  return (
    <div style={styles.pageContainer}>
      <div style={styles.card}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3, #64748b)', fontWeight: 700 }}>
            {info?.agencyName || 'Client Experience'}
          </span>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-1, #0f172a)', margin: '8px 0 6px 0' }}>
            {info?.prompt || 'How was your experience?'}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-2, #64748b)', margin: 0 }}>
            Your feedback helps us constantly refine our automation and client results.
          </p>
        </div>

        {error && (
          <div style={styles.errorBanner}>
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Star Rating Selector */}
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{ display: 'inline-flex', gap: 8 }}>
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(star)}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: 32,
                    cursor: 'pointer',
                    color: star <= effectiveRating ? '#eab308' : '#cbd5e1',
                    padding: 4,
                    transition: 'transform 0.1s ease',
                    transform: star <= effectiveRating ? 'scale(1.1)' : 'scale(1)'
                  }}
                  aria-label={`Rate ${star} stars`}
                >
                  ★
                </button>
              ))}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#eab308', height: 20, marginTop: 4 }}>
              {RATING_LABELS[effectiveRating] || ''}
            </div>
          </div>

          <div>
            <label style={styles.label}>Your Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. Alex Morgan"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={styles.input}
            />
          </div>

          <div>
            <label style={styles.label}>Email Address (optional)</label>
            <input
              type="email"
              placeholder="alex@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
            />
          </div>

          <div>
            <label style={styles.label}>Your Review *</label>
            <textarea
              rows={4}
              required
              placeholder="Share what worked well or areas we can improve..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              style={{ ...styles.input, resize: 'vertical' }}
            />
          </div>

          <div style={{ marginTop: 8 }}>
            <button
              type="submit"
              disabled={submitting}
              style={{
                ...styles.submitBtn,
                opacity: submitting ? 0.7 : 1,
                cursor: submitting ? 'not-allowed' : 'pointer'
              }}
            >
              {submitting ? 'Submitting Review…' : 'Submit Review'}
            </button>
          </div>
        </form>

        <p style={{ fontSize: 12, color: 'var(--text-3, #94a3b8)', marginTop: 20, textAlign: 'center' }}>
          🔒 Verified feedback portal. Your comments are reviewed by leadership.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageContainer: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    background: 'var(--bg, #f8fafc)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },
  centerBox: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    background: 'var(--bg, #f8fafc)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },
  card: {
    width: '100%',
    maxWidth: 500,
    background: 'var(--card-bg, #ffffff)',
    borderRadius: 12,
    padding: '36px 32px',
    border: '1px solid var(--border, #e2e8f0)',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)'
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-1, #1e293b)',
    marginBottom: 6
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 6,
    border: '1px solid var(--border, #cbd5e1)',
    background: 'var(--surface, #ffffff)',
    color: 'var(--text-1, #0f172a)',
    fontSize: 14,
    outline: 'none',
    transition: 'border-color 0.15s ease'
  },
  submitBtn: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 6,
    border: 'none',
    background: 'var(--primary, #6366f1)',
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 600,
    transition: 'background 0.15s ease'
  },
  errorBanner: {
    background: '#fef2f2',
    color: '#b91c1c',
    padding: '10px 14px',
    borderRadius: 6,
    fontSize: 13,
    marginBottom: 14,
    border: '1px solid #fecaca'
  },
  checkIcon: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 28,
    fontWeight: 'bold'
  },
  spinner: {
    width: 32,
    height: 32,
    border: '3px solid var(--border, #e2e8f0)',
    borderTopColor: 'var(--primary, #6366f1)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite'
  },
  detailsBox: {
    background: 'var(--surface-alt, #f8fafc)',
    borderRadius: 8,
    border: '1px solid var(--border, #e2e8f0)',
    padding: '16px 20px',
    textAlign: 'left'
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '4px 0',
    fontSize: 13
  },
  detailLabel: {
    color: 'var(--text-3, #64748b)'
  },
  detailValue: {
    color: 'var(--text-1, #0f172a)'
  }
};
