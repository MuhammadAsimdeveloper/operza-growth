import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';

export default function Login() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // If already authenticated, redirect
  if (isAuthenticated && !isLoading) {
    const from = (location.state as any)?.from?.pathname ?? '/';
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.container}>
        {/* Brand */}
        <div style={styles.brand}>
          <div style={styles.brandMark}>OP</div>
          <div>
            <div style={styles.brandName}>Operza</div>
            <div style={styles.brandSub}>Agency Workspace</div>
          </div>
        </div>

        {/* Card */}
        <div className="card" style={styles.card}>
          <div style={styles.cardBody}>
            <h1 style={styles.heading}>Sign in to your account</h1>
            <p style={styles.subtitle}>
              Welcome back! Enter your credentials to continue.
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

            <form onSubmit={handleSubmit} style={styles.form}>
              <div className="field">
                <label htmlFor="login-email">Email address</label>
                <input
                  id="login-email"
                  className="input"
                  type="email"
                  placeholder="you@agency.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                />
              </div>

              <div className="field">
                <label htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  className="input"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>

              <button
                className="btn btn--primary btn--block"
                type="submit"
                disabled={submitting}
                style={{ height: 38, fontSize: 13.5, fontWeight: 600, marginTop: 4 }}
              >
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </div>

          <div style={styles.footer}>
            <span style={{ color: 'var(--text-3)', fontSize: 13 }}>
              Don't have an account?{' '}
              <Link to="/signup" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                Create one
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
    maxWidth: 400,
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
