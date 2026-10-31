import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Badge } from '../components/ui';
import { api } from '../lib/api';
import type { FunnelBlock } from '../components/VisualPageBuilder';

export default function PublicFunnel() {
  const { slug } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [funnel, setFunnel] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Opt-in form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [bumpAccepted, setBumpAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<any>(null);

  // Live countdown state
  const [timeLeft, setTimeLeft] = useState({ hours: 1, minutes: 42, seconds: 18 });

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev.seconds > 0) return { ...prev, seconds: prev.seconds - 1 };
        if (prev.minutes > 0) return { ...prev, minutes: prev.minutes - 1, seconds: 59 };
        if (prev.hours > 0) return { hours: prev.hours - 1, minutes: 59, seconds: 59 };
        return prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    api.funnels.getPublic(slug)
      .then((res) => {
        setFunnel(res);
      })
      .catch((err) => {
        console.error('Funnel fetch error:', err);
        setError('This funnel or landing page is unavailable or unpublished.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [slug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug) return;
    setSubmitting(true);
    try {
      const res = await api.funnels.optin(slug, {
        firstName,
        lastName,
        email,
        phone,
        bumpAccepted
      });
      setSubmitted(res);
    } catch (err: any) {
      alert(`Submission error: ${err.message || 'Please try again'}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#f8fafc' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Loading Page...</div>
          <div style={{ color: '#94a3b8', fontSize: 14 }}>Connecting to Operza Edge Ingress</div>
        </div>
      </div>
    );
  }

  if (error || !funnel) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#f8fafc', padding: 20 }}>
        <div style={{ maxWidth: 460, textAlign: 'center', background: '#1e293b', padding: 36, borderRadius: 16, border: '1px solid #334155' }}>
          <Icon name="alert-triangle" size={40} />
          <h2 style={{ fontSize: 22, marginTop: 16, marginBottom: 8 }}>Page Not Found</h2>
          <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 20 }}>{error || 'The requested funnel step does not exist or has been archived.'}</p>
          <Link to="/" style={{ color: '#38bdf8', textDecoration: 'none', fontWeight: 600 }}>Return to Home</Link>
        </div>
      </div>
    );
  }

  const activePage = funnel.pages?.[0] || {};
  const blocks: FunnelBlock[] = activePage.blocks && activePage.blocks.length > 0
    ? activePage.blocks
    : (activePage.elements || [
        {
          id: 'h1',
          type: 'headline',
          content: funnel.name || 'Transform Your Business with Autonomous Growth',
          align: 'center'
        },
        {
          id: 'p1',
          type: 'paragraph',
          content: 'Deploy automated client acquisition, unified CRM smart lists, and autonomous AI agents in one unified operating system.',
          align: 'center'
        },
        {
          id: 'cd1',
          type: 'countdown',
          content: 'Limited Time Strategy Offer — Closes Tonight:',
          countdownMinutes: 120
        },
        {
          id: 'ob1',
          type: 'order_bump',
          content: 'VIP Implementation Blueprint (+ $37): Receive our turn-key n8n automation snapshots and GoHighLevel migration playbook.',
          bumpPrice: 37,
          bumpTitle: 'VIP Implementation Blueprint'
        }
      ]);

  const basePrice = funnel.checkout?.price || 197;
  const bumpPrice = funnel.checkout?.bumpPrice || 37;
  const totalPrice = bumpAccepted ? basePrice + bumpPrice : basePrice;

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', color: '#0f172a', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Top Banner */}
      <header style={{ background: '#0f172a', color: '#fff', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #38bdf8, #818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#0f172a', fontSize: 15 }}>
            ⚡
          </div>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{funnel.name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge tone="green">Verified Secure Ingress</Badge>
        </div>
      </header>

      {/* Main Container */}
      <main style={{ maxWidth: 880, margin: '40px auto', padding: '0 20px 80px' }}>
        {submitted ? (
          <div style={{ background: '#fff', borderRadius: 20, padding: 48, boxShadow: '0 20px 40px -15px rgba(0,0,0,0.07)', textAlign: 'center', border: '1px solid #e2e8f0' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#dcfce7', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 32 }}>
              ✓
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', marginBottom: 12 }}>You're In! Welcome Aboard.</h1>
            <p style={{ color: '#475569', fontSize: 16, maxWidth: 540, margin: '0 auto 24px', lineHeight: 1.6 }}>
              Thank you, <strong>{submitted.contact?.name || firstName || 'Partner'}</strong>! We've received your registration and assigned you to our priority onboarding queue.
            </p>
            {submitted.order && (
              <div style={{ background: '#f8fafc', padding: 20, borderRadius: 12, border: '1px solid #e2e8f0', maxWidth: 440, margin: '0 auto 24px', textAlign: 'left' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>ORDER CONFIRMATION</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
                  <span>{submitted.order.orderNumber}</span>
                  <span style={{ color: '#059669' }}>${submitted.order.amount} USD</span>
                </div>
                {bumpAccepted && (
                  <div style={{ fontSize: 13, color: '#0284c7', marginTop: 6 }}>
                    ✓ VIP Implementation Blueprint Included
                  </div>
                )}
              </div>
            )}
            <Link to="/" className="btn btn--primary" style={{ display: 'inline-flex', padding: '12px 28px', fontSize: 15, textDecoration: 'none' }}>
              Access Operza Client Portal
            </Link>
          </div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 20, padding: '40px 36px', boxShadow: '0 20px 40px -15px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0' }}>
            {/* Dynamic Element Rendering */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginBottom: 36 }}>
              {blocks.map((el) => {
                if (el.type === 'headline') {
                  return (
                    <h1 key={el.id} style={{ fontSize: '32px', fontWeight: 800, textAlign: el.align || 'center', color: '#0f172a', margin: 0, lineHeight: 1.25 }}>
                      {el.content}
                    </h1>
                  );
                }
                if (el.type === 'subheadline') {
                  return (
                    <h2 key={el.id} style={{ fontSize: '20px', fontWeight: 600, textAlign: el.align || 'center', color: '#334155', margin: 0 }}>
                      {el.content}
                    </h2>
                  );
                }
                if (el.type === 'paragraph') {
                  return (
                    <p key={el.id} style={{ fontSize: '17px', textAlign: el.align || 'center', color: '#475569', margin: 0, lineHeight: 1.6 }}>
                      {el.content}
                    </p>
                  );
                }
                if (el.type === 'hero_image') {
                  return (
                    <div key={el.id} style={{ textAlign: el.align || 'center', margin: '10px 0' }}>
                      <img src={el.imageUrl || el.content || 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?w=1200&auto=format&fit=crop&q=80'} alt="Funnel preview" style={{ maxWidth: '100%', maxHeight: 380, borderRadius: 14, boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }} />
                    </div>
                  );
                }
                if (el.type === 'two_columns') {
                  return (
                    <div key={el.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, margin: '14px 0' }}>
                      <div style={{ background: '#f8fafc', padding: 20, borderRadius: 12, border: '1px solid #e2e8f0' }}>
                        <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>Features & Included Modules</div>
                        <div style={{ fontSize: 14, color: '#475569', lineHeight: 1.6 }}>{el.columnA || el.content}</div>
                      </div>
                      <div style={{ background: '#f8fafc', padding: 20, borderRadius: 12, border: '1px solid #e2e8f0' }}>
                        <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>Deliverables & Timeline</div>
                        <div style={{ fontSize: 14, color: '#475569', lineHeight: 1.6 }}>{el.columnB || el.subcontent}</div>
                      </div>
                    </div>
                  );
                }
                if (el.type === 'countdown') {
                  return (
                    <div key={el.id} style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '16px 20px', textAlign: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                        {el.content || 'Limited Time Strategy Offer — Closes Tonight:'}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: 14, fontFamily: 'monospace', fontSize: 24, fontWeight: 800, color: '#991b1b' }}>
                        <div><span>{String(timeLeft.hours).padStart(2, '0')}</span><span style={{ fontSize: 11, display: 'block', fontWeight: 600 }}>HRS</span></div>
                        <span>:</span>
                        <div><span>{String(timeLeft.minutes).padStart(2, '0')}</span><span style={{ fontSize: 11, display: 'block', fontWeight: 600 }}>MIN</span></div>
                        <span>:</span>
                        <div><span>{String(timeLeft.seconds).padStart(2, '0')}</span><span style={{ fontSize: 11, display: 'block', fontWeight: 600 }}>SEC</span></div>
                      </div>
                    </div>
                  );
                }
                if (el.type === 'testimonials') {
                  return (
                    <div key={el.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20, textAlign: 'center' }}>
                      <div style={{ color: '#f59e0b', fontSize: 18, marginBottom: 6 }}>★★★★★</div>
                      <div style={{ fontStyle: 'italic', color: '#334155', fontSize: 15, marginBottom: 8 }}>"{el.content}"</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>{el.authorName || 'Marcus Vance'} · {el.authorRole || 'Founder & CEO'}</div>
                    </div>
                  );
                }
                return null;
              })}
            </div>

            {/* Interactive Opt-In & Order Bump Form */}
            <form onSubmit={handleSubmit} style={{ background: '#f8fafc', padding: 28, borderRadius: 16, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, color: '#0f172a' }}>
                Complete Your Registration
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>First Name</label>
                  <input
                    className="input"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Marcus"
                    required
                    style={{ width: '100%', background: '#fff' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Last Name</label>
                  <input
                    className="input"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Vance"
                    required
                    style={{ width: '100%', background: '#fff' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Email Address</label>
                  <input
                    type="email"
                    className="input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="marcus@vancegrowth.io"
                    required
                    style={{ width: '100%', background: '#fff' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Phone Number</label>
                  <input
                    type="tel"
                    className="input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 (555) 019-9000"
                    required
                    style={{ width: '100%', background: '#fff' }}
                  />
                </div>
              </div>

              {/* 1-Click Order Bump Component */}
              <div
                style={{
                  background: bumpAccepted ? '#f0fdf4' : '#fff',
                  border: bumpAccepted ? '2px solid #22c55e' : '1px dashed #cbd5e1',
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 20,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                onClick={() => setBumpAccepted(!bumpAccepted)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <input
                    type="checkbox"
                    checked={bumpAccepted}
                    onChange={(e) => setBumpAccepted(e.target.checked)}
                    style={{ marginTop: 3, cursor: 'pointer', width: 18, height: 18 }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: bumpAccepted ? '#15803d' : '#0f172a' }}>
                      ⚡ YES! Add the VIP Implementation Blueprint (+${bumpPrice})
                    </div>
                    <div style={{ fontSize: 12.5, color: '#475569', marginTop: 4, lineHeight: 1.5 }}>
                      Receive immediate access to our turnkey n8n automation templates, GHL snapshot blueprints, and 24/7 AI copilot workflows.
                    </div>
                  </div>
                </div>
              </div>

              {/* Price Breakdown */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, padding: '12px 14px', background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: 14, color: '#64748b' }}>Total Investment:</span>
                <span style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>${totalPrice} USD</span>
              </div>

              <button
                type="submit"
                className="btn btn--primary"
                disabled={submitting}
                style={{
                  width: '100%',
                  padding: '16px',
                  fontSize: 17,
                  fontWeight: 700,
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, #0284c7, #2563eb)',
                  boxShadow: '0 10px 20px -5px rgba(37, 99, 235, 0.4)',
                  cursor: 'pointer',
                  border: 'none',
                  color: '#fff'
                }}
              >
                {submitting ? 'Securing Spot & Order...' : `Claim Your Access Now · $${totalPrice}`}
              </button>

              <div style={{ textAlign: 'center', fontSize: 11.5, color: '#64748b', marginTop: 12 }}>
                🔒 256-Bit SSL Encrypted Checkout · Instant Digital Access
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
