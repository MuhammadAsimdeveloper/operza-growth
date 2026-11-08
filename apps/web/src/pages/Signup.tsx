import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { SEO } from '../components/SEO';

export default function Signup() {
  const { signup, loginWithGoogle, sendMagicLink, verifyOtp, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  const [authMethod, setAuthMethod] = useState<'password' | 'otp'>('password');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agencyName, setAgencyName] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated && !isLoading) {
    const from = (location.state as any)?.from?.pathname ?? '/';
    return <Navigate to={from} replace />;
  }

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
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
      // Set flag so new accounts load clean slate (0 demo data)
      localStorage.setItem('operza_clean_workspace', 'true');
      await signup({ name, email, password, agencyName: agencyName.trim() || undefined });
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignup = async () => {
    setError('');
    setSubmitting(true);
    try {
      localStorage.setItem('operza_clean_workspace', 'true');
      const googleEmail = email.trim() || 'operator@operza.io';
      await loginWithGoogle({
        email: googleEmail,
        name: name.trim() || googleEmail.split('@')[0],
      });
    } catch (err: any) {
      setError(err.message || 'Google signup failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid work email.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await sendMagicLink(email.trim());
      setOtpSent(true);
      if (res?.devCode) {
        setDevCode(res.devCode);
        setOtpCode(res.devCode);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to dispatch verification code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!otpCode.trim() || otpCode.trim().length < 6) {
      setError('Please enter the 6-digit verification code.');
      return;
    }
    setSubmitting(true);
    try {
      localStorage.setItem('operza_clean_workspace', 'true');
      await verifyOtp({
        email: email.trim(),
        code: otpCode.trim(),
        name: name.trim(),
      });
    } catch (err: any) {
      setError(err.message || 'Invalid or expired verification code.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.wrapper}>
      <SEO
        title="Start 14-Day Free Trial — Agency Workspace — Operza"
        description="Create your Operza agency account. Full access to CRM pipelines, 2D visual workflows, funnels, omnichannel conversations, and white-label client portal."
        canonical="/signup"
        robots="index, follow"
      />
      <div style={styles.container}>
        {/* Brand */}
        <div style={styles.brand}>
          <div style={styles.brandMark}>OP</div>
          <div>
            <div style={styles.brandName}>Operza</div>
            <div style={styles.brandSub}>Business Operating System</div>
          </div>
        </div>

        {/* Card */}
        <div className="card" style={styles.card}>
          <div style={styles.cardBody}>
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

            {/* Google Signup Button */}
            <button
              type="button"
              className="btn btn--block"
              onClick={handleGoogleSignup}
              disabled={submitting}
              style={styles.googleBtn}
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>

            {/* Divider */}
            <div style={styles.divider}>
              <span style={styles.dividerLine} />
              <span style={styles.dividerText}>or register with email</span>
              <span style={styles.dividerLine} />
            </div>

            {/* Method Tabs */}
            <div style={styles.tabBar}>
              <button
                type="button"
                style={{
                  ...styles.tabBtn,
                  ...(authMethod === 'password' ? styles.tabBtnActive : {}),
                }}
                onClick={() => {
                  setAuthMethod('password');
                  setError('');
                }}
              >
                Password
              </button>
              <button
                type="button"
                style={{
                  ...styles.tabBtn,
                  ...(authMethod === 'otp' ? styles.tabBtnActive : {}),
                }}
                onClick={() => {
                  setAuthMethod('otp');
                  setError('');
                }}
              >
                Email Code (OTP)
              </button>
            </div>

            {authMethod === 'password' ? (
              <form onSubmit={handlePasswordSubmit} style={styles.form}>
                <div className="field">
                  <label htmlFor="signup-name">Full name</label>
                  <input
                    id="signup-name"
                    className="input"
                    type="text"
                    placeholder="e.g. Asim R."
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
                    placeholder="e.g. Asim Tech Solutions"
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
                  {submitting ? 'Creating account…' : 'Create Free Account'}
                </button>
              </form>
            ) : (
              <div style={styles.form}>
                {!otpSent ? (
                  <form onSubmit={handleSendOtp} style={styles.form}>
                    <div className="field">
                      <label htmlFor="signup-otp-name">Full name</label>
                      <input
                        id="signup-otp-name"
                        className="input"
                        type="text"
                        placeholder="e.g. Asim R."
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="signup-otp-email">Work email address</label>
                      <input
                        id="signup-otp-email"
                        className="input"
                        type="email"
                        placeholder="you@agency.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    <button
                      className="btn btn--primary btn--block"
                      type="submit"
                      disabled={submitting}
                      style={{ height: 38, fontSize: 13.5, fontWeight: 600 }}
                    >
                      {submitting ? 'Sending Code…' : 'Send Verification Code'}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleVerifyOtp} style={styles.form}>
                    <div style={styles.otpNotice}>
                      We sent a 6-digit code to <strong>{email}</strong>
                      {devCode && (
                        <div style={{ marginTop: 6, color: 'var(--accent)', fontWeight: 600 }}>
                          Dev Mode Code: <code style={{ fontSize: 14 }}>{devCode}</code>
                        </div>
                      )}
                    </div>
                    <div className="field">
                      <label htmlFor="signup-otp-code">6-Digit Code</label>
                      <input
                        id="signup-otp-code"
                        className="input"
                        type="text"
                        maxLength={6}
                        placeholder="123456"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value)}
                        autoFocus
                        style={{ textAlign: 'center', letterSpacing: '0.25em', fontSize: 18, fontWeight: 700 }}
                      />
                    </div>
                    <button
                      className="btn btn--primary btn--block"
                      type="submit"
                      disabled={submitting}
                      style={{ height: 38, fontSize: 13.5, fontWeight: 600 }}
                    >
                      {submitting ? 'Verifying…' : 'Complete Registration'}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--block"
                      onClick={() => setOtpSent(false)}
                      style={{ fontSize: 12 }}
                    >
                      Use a different email
                    </button>
                  </form>
                )}
              </div>
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
          By signing up you agree to Operza&apos;s Terms of Service and Privacy Policy.
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
    maxWidth: 440,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 20,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  brandMark: {
    width: 38,
    height: 38,
    borderRadius: 10,
    display: 'grid',
    placeItems: 'center',
    color: '#fff',
    background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
    fontWeight: 700,
    fontSize: 15,
    letterSpacing: '-0.03em',
  },
  brandName: {
    fontSize: 17,
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
    fontSize: 19,
    fontWeight: 700,
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
    height: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    fontSize: 13.5,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.15s, border-color 0.15s',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    margin: '4px 0',
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
  },
  tabBar: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    background: 'var(--surface-2)',
    padding: 3,
    borderRadius: 'var(--r-md)',
    gap: 4,
  },
  tabBtn: {
    padding: '7px 12px',
    fontSize: 12.5,
    fontWeight: 600,
    background: 'transparent',
    border: 'none',
    color: 'var(--text-3)',
    borderRadius: 'var(--r-sm)',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  tabBtnActive: {
    background: 'var(--surface)',
    color: 'var(--text)',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  otpNotice: {
    fontSize: 12.5,
    color: 'var(--text-2)',
    background: 'var(--surface-2)',
    padding: '10px 12px',
    borderRadius: 'var(--r-md)',
    lineHeight: 1.5,
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
    textAlign: 'center',
    maxWidth: 380,
    lineHeight: 1.5,
  },
};
