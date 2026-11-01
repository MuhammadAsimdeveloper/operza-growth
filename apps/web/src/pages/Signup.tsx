import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { SEO } from '../components/SEO';
import { OperzaLogo } from '../components/OperzaLogo';

export default function Signup() {
  const { signup, verifyOtp, resendOtp, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const urlError = queryParams.get('error');

  const [step, setStep] = useState<'details' | 'otp'>('details');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agencyName, setAgencyName] = useState('');
  const [otp, setOtp] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(urlError || '');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  if (isAuthenticated && !isLoading) {
    const from = (location.state as any)?.from?.pathname ?? '/';
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError('Please fill in your name, email, and password.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await signup({ name, email, password, agencyName: agencyName.trim() || undefined });
      if (res?.requireOtp) {
        setStep('otp');
        setNotice(res.message || 'Verification code sent to your email.');
      }
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!otp.trim()) {
      setError('Please enter the 6-digit verification code.');
      return;
    }
    setSubmitting(true);
    try {
      await verifyOtp(email, otp.trim());
    } catch (err: any) {
      setError(err.message || 'Verification failed. Please check the code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    setError('');
    setNotice('');
    setResending(true);
    try {
      await resendOtp(email);
      setNotice('A fresh verification code has been dispatched to your email.');
    } catch (err: any) {
      setError(err.message || 'Failed to resend verification code.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div style={styles.wrapper}>
      <SEO
        title="Start 7-Day Free Trial — Agency Workspace"
        description="Create your Operza agency account. Full access to CRM pipelines, 2D visual workflows, funnels, omnichannel conversations, and white-label client portal."
        canonical="/signup"
        robots="noindex, follow"
      />
      <div style={styles.container}>
        {/* Brand */}
        <div style={styles.brand}>
          <OperzaLogo size={38} />
        </div>

        {/* Card */}
        <div className="card" style={styles.card}>
          <div style={styles.cardBody}>
            {step === 'details' ? (
              <>
                <h1 style={styles.heading}>Create your account</h1>
                <p style={styles.subtitle}>
                  Start automating your marketing, CRM pipelines, and client operations.
                </p>

                {error && (
                  <div style={styles.error}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                    {error}
                  </div>
                )}

                <a
                  href="/api/auth/google"
                  style={styles.googleBtn}
                  aria-label="Sign up with Google"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                  </svg>
                  <span>Sign up with Google</span>
                </a>

                <div style={styles.divider}>
                  <div style={styles.dividerLine} />
                  <span style={styles.dividerText}>or register with email</span>
                  <div style={styles.dividerLine} />
                </div>

                <form onSubmit={handleSubmit} style={styles.form}>
                  <div className="field">
                    <label htmlFor="signup-name">Full name</label>
                    <input
                      id="signup-name"
                      className="input"
                      type="text"
                      placeholder="e.g. Sanjar Khan"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                      autoFocus
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="signup-agency">Agency or company name</label>
                    <input
                      id="signup-agency"
                      className="input"
                      type="text"
                      placeholder="e.g. Apex Growth Studio"
                      value={agencyName}
                      onChange={(e) => setAgencyName(e.target.value)}
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="signup-email">Work email address</label>
                    <input
                      id="signup-email"
                      className="input"
                      type="email"
                      placeholder="you@agency.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="signup-password">Password</label>
                    <input
                      id="signup-password"
                      className="input"
                      type="password"
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </div>

                  <button
                    className="btn btn--primary btn--block"
                    type="submit"
                    disabled={submitting}
                    style={{ height: 38, fontSize: 13.5, fontWeight: 600, marginTop: 4 }}
                  >
                    {submitting ? 'Sending verification code…' : 'Continue with Email Verification'}
                  </button>
                </form>
              </>
            ) : (
              <>
                <div style={{ textAlign: 'center', marginBottom: 16 }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: '50%',
                      background: 'var(--accent-soft, #e0e7ff)',
                      color: 'var(--accent, #4f46e5)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 12
                    }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="20" height="16" x="2" y="4" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                  </div>
                  <h1 style={styles.heading}>Verify your email</h1>
                  <p style={styles.subtitle}>
                    We sent a 6-digit verification code to <strong>{email}</strong>. Enter it below to activate your workspace.
                  </p>
                </div>

                {notice && (
                  <div style={{ ...styles.error, background: 'var(--green-soft, #ecfdf5)', color: 'var(--green, #059669)', borderColor: 'var(--green, #10b981)' }}>
                    {notice}
                  </div>
                )}

                {error && (
                  <div style={styles.error}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                    {error}
                  </div>
                )}

                <form onSubmit={handleVerifyOtp} style={styles.form}>
                  <div className="field">
                    <label htmlFor="signup-otp" style={{ textAlign: 'center', display: 'block', fontWeight: 600 }}>
                      6-Digit Security Code
                    </label>
                    <input
                      id="signup-otp"
                      className="input"
                      type="text"
                      maxLength={6}
                      placeholder="123456"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                      style={{
                        textAlign: 'center',
                        fontSize: 24,
                        fontWeight: 700,
                        letterSpacing: 8,
                        height: 48,
                        borderRadius: 8
                      }}
                      autoFocus
                    />
                  </div>

                  <button
                    className="btn btn--primary btn--block"
                    type="submit"
                    disabled={submitting || otp.length < 6}
                    style={{ height: 40, fontSize: 14, fontWeight: 600 }}
                  >
                    {submitting ? 'Verifying & Initializing…' : 'Verify & Launch Workspace'}
                  </button>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                    <button
                      type="button"
                      className="btn btn--subtle btn--sm"
                      onClick={() => { setStep('details'); setError(''); }}
                    >
                      ← Back
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={handleResendOtp}
                      disabled={resending}
                      style={{ color: 'var(--accent)' }}
                    >
                      {resending ? 'Sending…' : 'Resend Code'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>

          <div style={styles.footer}>
            <span style={{ color: 'var(--text-3)', fontSize: 13 }}>
              Already have an account?{' '}
              <Link to="/login" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                Sign in
              </Link>
            </span>
          </div>
        </div>

        <div style={styles.legalText}>
          © {new Date().getFullYear()} Operza. All rights reserved.
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: 20,
    background: 'var(--bg)',
  },
  container: {
    width: '100%',
    maxWidth: 420,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 24,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  brandMark: {
    width: 36,
    height: 36,
    borderRadius: 10,
    display: 'grid',
    placeItems: 'center',
    color: '#fff',
    background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
    fontWeight: 700,
    fontSize: 14,
    letterSpacing: '-0.03em',
  },
  brandName: {
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: '-0.02em',
    lineHeight: 1.2,
  },
  brandSub: {
    fontSize: 11.5,
    color: 'var(--text-3)',
  },
  card: {
    width: '100%',
    overflow: 'hidden',
  },
  cardBody: {
    padding: '28px 24px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  heading: {
    fontSize: 18,
    fontWeight: 680,
    letterSpacing: '-0.02em',
    lineHeight: 1.3,
  },
  subtitle: {
    fontSize: 13,
    color: 'var(--text-3)',
    marginTop: -8,
  },
  error: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    borderRadius: 'var(--r-md)',
    background: 'var(--red-soft)',
    color: 'var(--red)',
    fontSize: 13,
    fontWeight: 550,
  },
  googleBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 40,
    borderRadius: 'var(--r-md)',
    border: '1px solid var(--line)',
    background: 'var(--surface-1)',
    color: 'var(--text-1)',
    fontSize: 13.5,
    fontWeight: 600,
    textDecoration: 'none',
    transition: 'background 0.15s ease, border-color 0.15s ease',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    margin: '2px 0',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: 'var(--line)',
  },
  dividerText: {
    fontSize: 11.5,
    color: 'var(--text-3)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    fontWeight: 550,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  footer: {
    padding: '14px 24px',
    borderTop: '1px solid var(--line)',
    background: 'var(--surface-2)',
    textAlign: 'center',
  },
  legalText: {
    fontSize: 11.5,
    color: 'var(--text-3)',
  },
};
