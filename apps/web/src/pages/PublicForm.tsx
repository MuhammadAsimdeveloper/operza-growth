import { useState, useEffect, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';

interface FormField {
  id: string;
  label: string;
  type: 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'checkbox';
  required?: boolean;
  options?: string[];
}

interface FormDefinition {
  id: string;
  name: string;
  description?: string;
  fields: FormField[];
}

export default function PublicForm() {
  const { slug } = useParams<{ slug: string }>();
  const [form, setForm] = useState<FormDefinition | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    api.forms
      .getPublic(slug)
      .then((data) => {
        setForm(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Form not found or unpublished.');
        setLoading(false);
      });
  }, [slug]);

  const handleChange = (fieldKey: string, val: any) => {
    setAnswers((prev) => ({ ...prev, [fieldKey]: val }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!slug) return;
    setSubmitting(true);
    setError('');

    try {
      await api.forms.submitPublic(slug, answers);
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Failed to submit form. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.centerBox}>
        <div style={styles.spinner} />
        <p style={{ color: 'var(--text-3)', marginTop: 12 }}>Loading form…</p>
      </div>
    );
  }

  if (error && !form) {
    return (
      <div style={styles.centerBox}>
        <div style={styles.card}>
          <h2 style={{ color: '#ef4444', margin: '0 0 8px 0' }}>Form Unavailable</h2>
          <p style={{ color: 'var(--text-3)', fontSize: 14 }}>{error}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={styles.centerBox}>
        <div style={styles.card}>
          <div style={styles.checkIcon}>✓</div>
          <h2 style={{ color: 'var(--text-1)', margin: '16px 0 8px 0', fontSize: 22 }}>
            Thank You!
          </h2>
          <p style={{ color: 'var(--text-2)', fontSize: 14, lineHeight: 1.5 }}>
            Your information has been received. Our automated system has logged your inquiry and a team member will follow up shortly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.container}>
        {/* Brand Header */}
        <div style={styles.header}>
          <div style={styles.brandMark}>OP</div>
          <h1 style={styles.title}>{form?.name || 'Inquiry Form'}</h1>
          {form?.description && <p style={styles.description}>{form.description}</p>}
        </div>

        {/* Form Container */}
        <div style={styles.card}>
          {error && (
            <div style={styles.errorBanner}>
              <span>⚠️ {error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} style={styles.form}>
            {form?.fields && form.fields.length > 0 ? (
              form.fields.map((f) => (
                <div key={f.id} style={styles.fieldGroup}>
                  <label style={styles.label}>
                    {f.label} {f.required && <span style={{ color: '#ef4444' }}>*</span>}
                  </label>

                  {f.type === 'textarea' ? (
                    <textarea
                      required={f.required}
                      rows={4}
                      value={answers[f.id] || ''}
                      onChange={(e) => handleChange(f.id, e.target.value)}
                      style={styles.input}
                      placeholder={`Enter your ${f.label.toLowerCase()}…`}
                    />
                  ) : f.type === 'select' ? (
                    <select
                      required={f.required}
                      value={answers[f.id] || ''}
                      onChange={(e) => handleChange(f.id, e.target.value)}
                      style={styles.input}
                    >
                      <option value="">Select an option…</option>
                      {(f.options || []).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : f.type === 'checkbox' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={answers[f.id] === true}
                        onChange={(e) => handleChange(f.id, e.target.checked)}
                      />
                      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{f.label}</span>
                    </div>
                  ) : (
                    <input
                      type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text'}
                      required={f.required}
                      value={answers[f.id] || ''}
                      onChange={(e) => handleChange(f.id, e.target.value)}
                      style={styles.input}
                      placeholder={`Enter your ${f.label.toLowerCase()}…`}
                    />
                  )}
                </div>
              ))
            ) : (
              // Default Fallback Form Fields if none defined
              <>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>First Name *</label>
                  <input
                    type="text"
                    required
                    style={styles.input}
                    placeholder="e.g. Sarah"
                    value={answers.firstName || ''}
                    onChange={(e) => handleChange('firstName', e.target.value)}
                  />
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Last Name *</label>
                  <input
                    type="text"
                    required
                    style={styles.input}
                    placeholder="e.g. Jenkins"
                    value={answers.lastName || ''}
                    onChange={(e) => handleChange('lastName', e.target.value)}
                  />
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Work Email *</label>
                  <input
                    type="email"
                    required
                    style={styles.input}
                    placeholder="sarah@company.com"
                    value={answers.email || ''}
                    onChange={(e) => handleChange('email', e.target.value)}
                  />
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Phone Number</label>
                  <input
                    type="tel"
                    style={styles.input}
                    placeholder="+1 (555) 000-0000"
                    value={answers.phone || ''}
                    onChange={(e) => handleChange('phone', e.target.value)}
                  />
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Company / Organization</label>
                  <input
                    type="text"
                    style={styles.input}
                    placeholder="Acme Corp"
                    value={answers.company || ''}
                    onChange={(e) => handleChange('company', e.target.value)}
                  />
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>How can we help you?</label>
                  <textarea
                    rows={4}
                    style={styles.input}
                    placeholder="Tell us about your project or inquiry…"
                    value={answers.message || ''}
                    onChange={(e) => handleChange('message', e.target.value)}
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{
                ...styles.submitBtn,
                opacity: submitting ? 0.7 : 1,
                cursor: submitting ? 'not-allowed' : 'pointer'
              }}
            >
              {submitting ? 'Submitting…' : 'Submit Inquiry'}
            </button>
          </form>
        </div>

        <div style={styles.poweredBy}>
          <span>Powered by <strong>Operza</strong> Automation OS</span>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: '100vh',
    backgroundColor: '#090d16',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '32px 16px',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  container: {
    width: '100%',
    maxWidth: 540,
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  header: {
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
  },
  brandMark: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#4f46e5',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 16,
    boxShadow: '0 8px 20px -4px rgba(79, 70, 229, 0.4)',
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    color: '#f8fafc',
    margin: 0,
    letterSpacing: '-0.02em',
  },
  description: {
    fontSize: 14,
    color: '#94a3b8',
    margin: 0,
    maxWidth: 440,
    lineHeight: 1.4,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 16,
    border: '1px solid #1f2937',
    padding: '32px 28px',
    boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.5)',
    textAlign: 'left',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: 500,
    color: '#e2e8f0',
  },
  input: {
    backgroundColor: '#1f2937',
    border: '1px solid #374151',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 14,
    color: '#f8fafc',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  submitBtn: {
    backgroundColor: '#4f46e5',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    padding: '12px 18px',
    fontSize: 14,
    fontWeight: 600,
    marginTop: 8,
    boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)',
    transition: 'all 0.15s ease',
  },
  errorBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid #ef4444',
    color: '#f87171',
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 16,
  },
  checkIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    color: '#22c55e',
    fontSize: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto',
    fontWeight: 700,
  },
  centerBox: {
    minHeight: '100vh',
    backgroundColor: '#090d16',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  spinner: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: '3px solid #374151',
    borderTopColor: '#4f46e5',
    animation: 'spin 1s linear infinite',
  },
  poweredBy: {
    textAlign: 'center',
    fontSize: 12,
    color: '#64748b',
    marginTop: 8,
  },
};
