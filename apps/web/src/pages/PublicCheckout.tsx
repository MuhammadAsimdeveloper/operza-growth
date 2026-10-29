import { useState, useEffect, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';

interface ProductItem {
  id: string;
  name: string;
  price: number;
}

interface PaymentLinkDetails {
  id: string;
  name: string;
  slug: string;
  amount: number;
  currency: string;
  description?: string;
  products?: ProductItem[];
}

export default function PublicCheckout() {
  const { slug } = useParams<{ slug: string }>();
  const [details, setDetails] = useState<PaymentLinkDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Form Fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [zip, setZip] = useState('');

  const [processing, setProcessing] = useState(false);
  const [successReceipt, setSuccessReceipt] = useState<any | null>(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    api.payments
      .getPublic(slug)
      .then((data) => {
        setDetails(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Payment link not found or inactive.');
        setLoading(false);
      });
  }, [slug]);

  const formatCardNumber = (val: string) => {
    const raw = val.replace(/\D/g, '').slice(0, 16);
    return raw.replace(/(\d{4})(?=\d)/g, '$1 ');
  };

  const formatExpiry = (val: string) => {
    const raw = val.replace(/\D/g, '').slice(0, 4);
    if (raw.length > 2) return `${raw.slice(0, 2)}/${raw.slice(2)}`;
    return raw;
  };

  const handleCheckout = async (e: FormEvent) => {
    e.preventDefault();
    if (!slug) return;
    setProcessing(true);
    setError('');

    try {
      const res = await api.payments.checkoutPublic(slug, {
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        billingAddress: { zip }
      });
      setSuccessReceipt(res);
    } catch (err: any) {
      setError(err.message || 'Checkout failed. Please verify your payment details.');
    } finally {
      setProcessing(false);
    }
  };

  const formatPrice = (amount: number, curr = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: curr,
      minimumFractionDigits: 2
    }).format(amount);
  };

  if (loading) {
    return (
      <div style={styles.centerBox}>
        <div style={styles.spinner} />
        <p style={{ color: 'var(--text-3, #94a3b8)', marginTop: 12 }}>Loading secure checkout…</p>
      </div>
    );
  }

  if (error && !details) {
    return (
      <div style={styles.centerBox}>
        <div style={styles.card}>
          <h2 style={{ color: '#ef4444', margin: '0 0 8px 0' }}>Checkout Unavailable</h2>
          <p style={{ color: 'var(--text-3, #94a3b8)', fontSize: 14 }}>{error}</p>
        </div>
      </div>
    );
  }

  if (successReceipt) {
    const { order, invoice } = successReceipt;
    return (
      <div style={styles.centerBox}>
        <div style={{ ...styles.card, maxWidth: 540, textAlign: 'center' }}>
          <div style={styles.checkIcon}>✓</div>
          <h2 style={{ color: 'var(--text-1, #0f172a)', margin: '16px 0 8px 0', fontSize: 24, fontWeight: 700 }}>
            Payment Successful!
          </h2>
          <p style={{ color: 'var(--text-2, #475569)', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
            Thank you, <strong>{name}</strong>! Your payment for <strong>{details?.name}</strong> has been processed. A receipt has been emailed to <strong>{email}</strong>.
          </p>

          <div style={styles.detailsBox}>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Order Number:</span>
              <strong style={styles.detailValue}>{order?.orderNumber}</strong>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Invoice Reference:</span>
              <strong style={styles.detailValue}>{invoice?.number}</strong>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Total Paid:</span>
              <strong style={{ ...styles.detailValue, color: '#16a34a' }}>
                {formatPrice(order?.amount || details?.amount || 0, order?.currency || details?.currency)}
              </strong>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Status:</span>
              <strong style={{ ...styles.detailValue, color: '#16a34a', textTransform: 'uppercase' }}>
                Paid in Full
              </strong>
            </div>
          </div>

          <div style={{ marginTop: 24, padding: '12px 16px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
            <span style={{ fontSize: 13, color: '#166534', fontWeight: 500 }}>
              ⚡ Your account access is active and onboarding automation has commenced.
            </span>
          </div>

          <div style={{ marginTop: 24 }}>
            <span style={{ fontSize: 12, color: 'var(--text-3, #94a3b8)' }}>
              Operza Autonomous Enterprise Commerce
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.pageContainer}>
      <div style={styles.checkoutWrapper}>
        {/* Left Side: Order Summary */}
        <div style={styles.summaryPane}>
          <span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3, #64748b)', fontWeight: 700 }}>
            Operza Checkout
          </span>

          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-1, #0f172a)', margin: '8px 0 12px 0' }}>
            {details?.name}
          </h1>

          {details?.description && (
            <p style={{ color: 'var(--text-2, #64748b)', fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>
              {details.description}
            </p>
          )}

          <div style={{ borderTop: '1px solid var(--border, #e2e8f0)', paddingTop: 16, marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
              <span style={{ fontSize: 14, color: 'var(--text-3, #64748b)' }}>Amount Due</span>
              <strong style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-1, #0f172a)' }}>
                {formatPrice(details?.amount || 0, details?.currency)}
              </strong>
            </div>

            {details?.products && details.products.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3, #64748b)', textTransform: 'uppercase' }}>
                  Included Items
                </span>
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {details.products.map((p) => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-2, #334155)' }}>• {p.name}</span>
                      <strong style={{ color: 'var(--text-1, #0f172a)' }}>{formatPrice(p.price)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: 'auto', paddingTop: 24, borderTop: '1px solid var(--border, #e2e8f0)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-3, #64748b)' }}>
              <span>🛡️</span>
              <span>Encrypted with TLS 1.3 & 256-bit security</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-3, #64748b)' }}>
              <span>⚡</span>
              <span>Instant automated provisioning & email confirmation</span>
            </div>
          </div>
        </div>

        {/* Right Side: Payment Form */}
        <div style={styles.formPane}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-1, #0f172a)', margin: '0 0 16px 0' }}>
            Payment & Billing
          </h2>

          {error && (
            <div style={styles.errorBanner}>
              ⚠️ {error}
            </div>
          )}

          <form onSubmit={handleCheckout} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={styles.label}>Full Name *</label>
              <input
                type="text"
                required
                placeholder="Jane Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={styles.input}
              />
            </div>

            <div>
              <label style={styles.label}>Email Address *</label>
              <input
                type="email"
                required
                placeholder="jane@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={styles.input}
              />
            </div>

            <div>
              <label style={styles.label}>Phone Number</label>
              <input
                type="tel"
                placeholder="+1 (555) 000-0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={styles.input}
              />
            </div>

            <div style={{ borderTop: '1px solid var(--border, #e2e8f0)', paddingTop: 14 }}>
              <label style={styles.label}>Card Information *</label>
              <input
                type="text"
                required
                placeholder="4242 •••• •••• 4242"
                value={cardNumber}
                onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                style={styles.input}
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                <input
                  type="text"
                  required
                  placeholder="MM / YY"
                  value={expiry}
                  onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                  style={styles.input}
                />
                <input
                  type="text"
                  required
                  placeholder="CVC"
                  maxLength={4}
                  value={cvc}
                  onChange={(e) => setCvc(e.target.value.replace(/\D/g, ''))}
                  style={styles.input}
                />
              </div>
            </div>

            <div>
              <label style={styles.label}>Postal / ZIP Code</label>
              <input
                type="text"
                placeholder="90210"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                style={styles.input}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <button
                type="submit"
                disabled={processing}
                style={{
                  ...styles.submitBtn,
                  opacity: processing ? 0.7 : 1,
                  cursor: processing ? 'not-allowed' : 'pointer'
                }}
              >
                {processing ? 'Processing Payment…' : `Pay ${formatPrice(details?.amount || 0, details?.currency)}`}
              </button>
            </div>
          </form>

          <p style={{ fontSize: 11, color: 'var(--text-3, #94a3b8)', marginTop: 16, textAlign: 'center' }}>
            By clicking Pay, you authorize Operza to charge your card according to our terms of service.
          </p>
        </div>
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
  checkoutWrapper: {
    width: '100%',
    maxWidth: 880,
    background: 'var(--card-bg, #ffffff)',
    borderRadius: 12,
    border: '1px solid var(--border, #e2e8f0)',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
    overflow: 'hidden'
  },
  summaryPane: {
    padding: '36px 32px',
    borderRight: '1px solid var(--border, #e2e8f0)',
    background: 'var(--surface, #ffffff)',
    display: 'flex',
    flexDirection: 'column'
  },
  formPane: {
    padding: '36px 32px',
    background: 'var(--surface-alt, #fafbfc)'
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
    maxWidth: 480,
    background: 'var(--card-bg, #ffffff)',
    borderRadius: 12,
    padding: '36px 32px',
    border: '1px solid var(--border, #e2e8f0)',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
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
    padding: '13px 16px',
    borderRadius: 6,
    border: 'none',
    background: '#10b981',
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 700,
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
    background: '#dcfce7',
    color: '#16a34a',
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
    borderTopColor: '#10b981',
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
    padding: '6px 0',
    fontSize: 13
  },
  detailLabel: {
    color: 'var(--text-3, #64748b)'
  },
  detailValue: {
    color: 'var(--text-1, #0f172a)'
  }
};
