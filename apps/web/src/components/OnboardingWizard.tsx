import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { useAuth } from '../lib/AuthContext';
import { useStore, uid } from '../lib/store';

export function OnboardingWizard({ onClose }: { onClose: () => void }) {
  const { agency } = useAuth();
  const { dispatch } = useStore();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Form state
  const [businessName, setBusinessName] = useState(agency?.name || 'Growth Marketing Agency');
  const [industry, setIndustry] = useState('Digital Marketing & Advertising');
  const [teamSize, setTeamSize] = useState('1-5 employees');
  const [focus, setFocus] = useState<'crm' | 'funnels' | 'automation' | 'ai'>('crm');
  const [blueprint, setBlueprint] = useState<'agency-scale' | 'lead-gen' | 'ecommerce' | 'coaching'>('agency-scale');

  // Checklist state for Step 4
  const [checkedTasks, setCheckedTasks] = useState<Record<string, boolean>>({
    'profile-setup': true,
    'add-contact': false,
    'test-funnel': false,
    'check-copilot': false,
    'explore-workflow': false,
  });

  const handleFinish = () => {
    try {
      localStorage.setItem('operza_onboarding_completed', 'true');
    } catch { /* storage fallback */ }

    // Seed a starter contact if none exists or as a welcome lead
    dispatch({
      type: 'contact/add',
      contact: {
        id: uid('c'),
        firstName: 'Sarah',
        lastName: 'Connor',
        email: 'sarah@skynetdefense.io',
        phone: '+1 (555) 019-2834',
        company: 'Vanguard Cyber Systems',
        tags: ['starter-lead', 'qualified', focus],
        source: 'Onboarding Blueprint',
        status: 'lead',
        owner: 'Operator',
        notes: [],
        customFields: { industry, teamSize, title: 'VP Operations', score: '85' },
        createdAt: new Date().toISOString(),
      },
    });

    onClose();
    if (focus === 'funnels') navigate('/funnels');
    else if (focus === 'automation') navigate('/workflows');
    else if (focus === 'ai') navigate('/copilot');
    else navigate('/contacts');
  };

  const toggleTask = (taskId: string) => {
    setCheckedTasks((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        background: 'rgba(15, 23, 42, 0.7)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        animation: 'fadeIn 0.2s ease-out',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 680,
          background: 'var(--surface, #ffffff)',
          border: '1px solid var(--line, #e2e8f0)',
          borderRadius: 16,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.3)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Progress Bar */}
        <div style={{ padding: '24px 28px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: 'var(--accent, #4f46e5)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="sparkles" size={18} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>
                  Welcome to Operza Growth OS
                </h3>
                <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                  Step {step} of 4 · {step === 1 ? 'Business Profile' : step === 2 ? 'Primary Focus' : step === 3 ? 'Blueprint Setup' : 'Activation Checklist'}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              aria-label="Skip onboarding"
              title="Skip onboarding for now"
            >
              <Icon name="x" size={16} />
            </button>
          </div>

          {/* Stepper Bar */}
          <div style={{ height: 6, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${step * 25}%`,
                background: 'linear-gradient(90deg, #4f46e5, #06b6d4)',
                borderRadius: 99,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>

        {/* Wizard Content Body */}
        <div style={{ padding: '24px 28px', minHeight: 330, display: 'flex', flexDirection: 'column' }}>
          {/* ─── STEP 1: BUSINESS PROFILE ─── */}
          {step === 1 && (
            <div className="stack" style={{ gap: 16 }}>
              <div>
                <h4 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                  Tell us about your business or agency
                </h4>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>
                  We will configure your default currency, timezone, and pipeline blueprints to match your operations.
                </p>
              </div>

              <div className="field">
                <label htmlFor="ob-biz-name">Company or Agency Name</label>
                <input
                  id="ob-biz-name"
                  className="input"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Apex Growth Partners"
                />
              </div>

              <div className="grid grid--2" style={{ gap: 14 }}>
                <div className="field">
                  <label htmlFor="ob-industry">Industry / Sector</label>
                  <select
                    id="ob-industry"
                    className="select"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                  >
                    <option value="Digital Marketing & Advertising">Digital Marketing &amp; Advertising</option>
                    <option value="SaaS & Technology">SaaS &amp; Technology</option>
                    <option value="E-commerce & Retail">E-commerce &amp; Retail</option>
                    <option value="Consulting & Professional Services">Consulting &amp; Professional Services</option>
                    <option value="Real Estate & Construction">Real Estate &amp; Construction</option>
                    <option value="Healthcare & Wellness">Healthcare &amp; Wellness</option>
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="ob-team-size">Team Size</label>
                  <select
                    id="ob-team-size"
                    className="select"
                    value={teamSize}
                    onChange={(e) => setTeamSize(e.target.value)}
                  >
                    <option value="Just me (Solo operator)">Just me (Solo operator)</option>
                    <option value="1-5 employees">1-5 employees</option>
                    <option value="6-25 employees">6-25 employees</option>
                    <option value="26-100 employees">26-100 employees</option>
                    <option value="100+ enterprise">100+ enterprise</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* ─── STEP 2: PRIMARY FOCUS ─── */}
          {step === 2 && (
            <div className="stack" style={{ gap: 16 }}>
              <div>
                <h4 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                  What is your primary focus right now?
                </h4>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>
                  We will prioritize shortcuts and quick start guides on your workspace dashboard.
                </p>
              </div>

              <div className="grid grid--2" style={{ gap: 12 }}>
                {[
                  {
                    id: 'crm',
                    title: 'Multi-Client CRM & Deals',
                    desc: 'Track leads, pipeline stages, custom fields, and client records.',
                    icon: 'users',
                  },
                  {
                    id: 'funnels',
                    title: 'Funnels & 1-Click Checkouts',
                    desc: 'High-converting opt-in pages, VSLs, and order bumps.',
                    icon: 'funnel',
                  },
                  {
                    id: 'automation',
                    title: 'Visual Workflow Automations',
                    desc: 'Connect triggers and cubic bezier nodes with BullMQ durability.',
                    icon: 'zap',
                  },
                  {
                    id: 'ai',
                    title: 'Miss Minutes AI Copilot',
                    desc: 'Autonomous assistant for CRM actions and business intelligence.',
                    icon: 'sparkles',
                  },
                ].map((item) => {
                  const isSelected = focus === item.id;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setFocus(item.id as any)}
                      style={{
                        padding: '16px',
                        borderRadius: 12,
                        border: `2px solid ${isSelected ? 'var(--accent, #4f46e5)' : 'var(--line)'}`,
                        background: isSelected ? 'var(--accent-soft, rgba(79, 70, 229, 0.06))' : 'var(--surface-2)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            background: isSelected ? 'var(--accent, #4f46e5)' : 'var(--surface)',
                            color: isSelected ? '#ffffff' : 'var(--accent, #4f46e5)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Icon name={item.icon} size={16} />
                        </div>
                        <strong style={{ fontSize: 14, color: 'var(--text)' }}>{item.title}</strong>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>{item.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─── STEP 3: WORKSPACE BLUEPRINT ─── */}
          {step === 3 && (
            <div className="stack" style={{ gap: 16 }}>
              <div>
                <h4 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                  Choose your starter workspace blueprint
                </h4>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>
                  Pre-populates proven pipeline stages, email templates, and sample workflows.
                </p>
              </div>

              <div className="stack" style={{ gap: 10 }}>
                {[
                  {
                    id: 'agency-scale',
                    title: 'High-Ticket Digital Agency Blueprint',
                    desc: 'Discovery Call → Proposal Sent → Contract Signed → Retainer Active. Includes SMS nurture.',
                    badge: 'Recommended',
                  },
                  {
                    id: 'lead-gen',
                    title: 'B2B Lead Generation & Outreach',
                    desc: 'Cold Lead → Inbound Response → Qualification Call → Demo Scheduled.',
                    badge: 'B2B Sales',
                  },
                  {
                    id: 'ecommerce',
                    title: 'Direct-to-Consumer / E-commerce Funnel',
                    desc: 'Cart Abandoned → 1-Click Upsell Offered → VIP Customer Club.',
                    badge: 'Funnels',
                  },
                  {
                    id: 'coaching',
                    title: 'Consultant & Course Creator Masterclass',
                    desc: 'Free Masterclass Opt-in → VSL → Calendar Booking → High-Ticket Enrolled.',
                    badge: 'Knowledge',
                  },
                ].map((bp) => {
                  const isSelected = blueprint === bp.id;
                  return (
                    <div
                      key={bp.id}
                      onClick={() => setBlueprint(bp.id as any)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 18px',
                        borderRadius: 10,
                        border: `1.5px solid ${isSelected ? 'var(--accent, #4f46e5)' : 'var(--line)'}`,
                        background: isSelected ? 'var(--accent-soft, rgba(79, 70, 229, 0.06))' : 'var(--surface-2)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <strong style={{ fontSize: 13.5, color: 'var(--text)' }}>{bp.title}</strong>
                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: isSelected ? 'var(--accent, #4f46e5)' : 'var(--surface-3)',
                              color: isSelected ? '#ffffff' : 'var(--text-3)',
                            }}
                          >
                            {bp.badge}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{bp.desc}</div>
                      </div>
                      <div
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          border: `2px solid ${isSelected ? 'var(--accent, #4f46e5)' : 'var(--line-strong)'}`,
                          background: isSelected ? 'var(--accent, #4f46e5)' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {isSelected && <Icon name="check" size={12} style={{ color: '#ffffff' }} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─── STEP 4: LAUNCH CHECKLIST ─── */}
          {step === 4 && (
            <div className="stack" style={{ gap: 16 }}>
              <div>
                <h4 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                  Interactive Launch Checklist
                </h4>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>
                  Complete these 5 foundational actions to achieve immediate ROI with Operza.
                </p>
              </div>

              <div className="stack" style={{ gap: 8 }}>
                {[
                  { id: 'profile-setup', label: 'Configure business profile & branding', done: true },
                  { id: 'add-contact', label: 'Create your first CRM contact or import lead list', done: checkedTasks['add-contact'] },
                  { id: 'test-funnel', label: 'Review pre-built sales funnel & order bump', done: checkedTasks['test-funnel'] },
                  { id: 'check-copilot', label: 'Query Miss Minutes AI Copilot for quick insights', done: checkedTasks['check-copilot'] },
                  { id: 'explore-workflow', label: 'Inspect the 2D visual workflow automation canvas', done: checkedTasks['explore-workflow'] },
                ].map((task) => (
                  <div
                    key={task.id}
                    onClick={() => toggleTask(task.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 14px',
                      background: 'var(--surface-2)',
                      borderRadius: 8,
                      border: '1px solid var(--line)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={task.done}
                      onChange={() => {}}
                      style={{ cursor: 'pointer', width: 16, height: 16 }}
                    />
                    <span
                      style={{
                        fontSize: 13,
                        color: task.done ? 'var(--text-3)' : 'var(--text)',
                        textDecoration: task.done ? 'line-through' : 'none',
                        fontWeight: task.done ? 400 : 600,
                      }}
                    >
                      {task.label}
                    </span>
                    {task.done && (
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>
                        Completed
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation Buttons */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 28px',
            borderTop: '1px solid var(--line)',
            background: 'var(--surface-2)',
          }}
        >
          {step > 1 ? (
            <button className="btn btn--ghost" type="button" onClick={() => setStep((s) => (s - 1) as any)}>
              ← Back
            </button>
          ) : (
            <button className="btn btn--ghost" type="button" onClick={onClose}>
              Skip Setup
            </button>
          )}

          {step < 4 ? (
            <button className="btn btn--primary" type="button" onClick={() => setStep((s) => (s + 1) as any)}>
              Continue →
            </button>
          ) : (
            <button className="btn btn--primary" type="button" onClick={handleFinish}>
              <Icon name="check" size={15} /> Launch Workspace
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
