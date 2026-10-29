import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';

export default function Signup() {
  const { signup, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agencyName, setAgencyName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated && !isLoading) {
    const from = (location.state as any)?.from?.pathname ?? '/';
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
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
      await signup({ name, email, password, agencyName: agencyName.trim() || undefined });
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please try again.');
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
            <div style={styles.brandSub}>Agency Workspace & AI Automation</div>
          </div>
        </div>

        {/* Card */}
        <div className="card" style={styles.card}>
          <div style={styles.cardBody}>
            <h1 style={styles.heading}>Create your workspace</h1>
            <p style={styles.subtitle}>
              Start automating your marketing, CRM pipelines, and AI copilot agents.
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
                <label htmlFor="signup-name">Your Full Name</label>
                <input
                  id="signup-name"
                  className="input"
                  type="text"
                  placeholder="e.g. Asim Khan"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  autoFocus
                />
              </div>

              <div className="field">
                <label htmlFor="signup-agency">Agency / Company Name</label>
                <input
                  id="signup-agency"
                  className="input"
                  type="text"
                  placeholder="e.g. Apex Growth Agency"
                  value={agencyName}
                  onChange={(e) => setAgencyName(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="signup-email">Work Email</label>
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
                <label htmlFor="signup-password">Password (min 8 characters)</label>
                <input
                  id="signup-password"
                  className="input"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>

              <button
                className="btn btn--primary btn--block"
                type="submit"
                disabled={submitting}
                style={{ height: 38, fontSize: 13.5, fontWeight: 600, marginTop: 6 }}
              >
                {submitting ? 'Creating workspace…' : 'Create Operza Workspace'}
              </button>
            </form>
          </div>

          <div style={styles.footer}>
            Already have an account?{' '}
            <Link to="/login" style={styles.link}>
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg, #0b0f19)',
    padding: '24px 16px',
  },
  container: {
    width: '100%',
    maxWidth: 420,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 20,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  brandMark: {
    width: 36,
    height: 36,
    borderRadius: 'var(--radius-sm, 6px)',
    background: 'var(--primary, #3b82f6)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 14,
    letterSpacing: '0.05em',
  },
  brandName: {
    fontSize: 18,
    fontWeight: 700,
    color: 'var(--text-1, #f8fafc)',
    letterSpacing: '-0.02em',
  },
  brandSub: {
    fontSize: 11,
    color: 'var(--text-3, #64748b)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  card: {
    width: '100%',
    padding: 0,
    overflow: 'hidden',
    border: '1px solid var(--border, #1e293b)',
    borderRadius: 'var(--radius-lg, 12px)',
    background: 'var(--surface-1, #111827)',
  },
  cardBody: {
    padding: '28px 24px 20px',
  },
  heading: {
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text-1, #f8fafc)',
    margin: 0,
    letterSpacing: '-0.01em',
  },
  subtitle: {
    fontSize: 13,
    color: 'var(--text-3, #64748b)',
    marginTop: 6,
    marginBottom: 20,
    lineHeight: 1.4,
  },
  error: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm, 6px)',
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.25)',
    color: '#f87171',
    fontSize: 12.5,
    marginBottom: 16,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  footer: {
    padding: '14px 24px',
    borderTop: '1px solid var(--border, #1e293b)',
    background: 'var(--surface-2, #0f172a)',
    fontSize: 12.5,
    color: 'var(--text-3, #64748b)',
    textAlign: 'center',
  },
  link: {
    color: 'var(--primary, #3b82f6)',
    fontWeight: 600,
    textDecoration: 'none',
  },
};
