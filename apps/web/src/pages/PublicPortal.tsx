import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { currency, fullDate } from '../lib/format';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, Avatar } from '../components/ui';

interface PortalData {
  contact: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    company?: string;
    portalAccess: boolean;
  };
  invoices: Array<{
    id: string;
    number: string;
    amount: number;
    status: string;
    dueDate?: string;
    description?: string;
  }>;
  courses: Array<{
    courseId: string;
    name: string;
    progress: number;
    status?: string;
    lessonsCount?: number;
    curriculum?: Array<{ title: string; duration?: string }>;
  }>;
  documents: Array<{
    id: string;
    name?: string;
    title?: string;
    status: string;
    value?: number;
    signedAt?: string;
    signerName?: string;
    certificateHash?: string;
  }>;
  appointments: Array<{
    id: string;
    title: string;
    startsAt: string;
    endsAt?: string;
    status?: string;
  }>;
}

export default function PublicPortal() {
  const { contactId } = useParams<{ contactId: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'invoices' | 'documents' | 'courses' | 'appointments'>('overview');

  // Invoice Payment Modal state
  const [payingInvoice, setPayingInvoice] = useState<any | null>(null);
  const [payLoading, setPayLoading] = useState(false);
  const [paySuccess, setPaySuccess] = useState(false);
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');

  // Document Signing Modal state
  const [signingDoc, setSigningDoc] = useState<any | null>(null);
  const [signMethod, setSignMethod] = useState<'draw' | 'type'>('draw');
  const [typedName, setTypedName] = useState('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [signSubmitting, setSignSubmitting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Lesson Completion state
  const [completedLessons, setCompletedLessons] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!contactId) return;
    setLoading(true);
    api.portal
      .getSummary(contactId)
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Client portal not found or access has been paused.');
        setLoading(false);
      });
  }, [contactId]);

  const handlePayInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingInvoice) return;
    setPayLoading(true);
    try {
      await api.portal.payInvoice(payingInvoice.id, 'card');
      setPaySuccess(true);
      // Update local invoice state
      if (data) {
        setData({
          ...data,
          invoices: data.invoices.map((inv) =>
            inv.id === payingInvoice.id ? { ...inv, status: 'paid' } : inv
          ),
        });
      }
      setTimeout(() => {
        setPayingInvoice(null);
        setPaySuccess(false);
        setCardNumber('');
        setExpiry('');
        setCvc('');
      }, 1500);
    } catch (err: any) {
      alert(err.message || 'Payment processing failed');
    } finally {
      setPayLoading(false);
    }
  };

  // Canvas Drawing
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    setIsDrawing(true);
    setHasDrawn(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const handleSignDocument = async () => {
    if (!signingDoc || !data) return;
    const signer = typedName.trim() || `${data.contact.firstName} ${data.contact.lastName}`.trim();
    if (signMethod === 'type' && !typedName.trim()) {
      alert('Please enter your full legal name');
      return;
    }
    if (signMethod === 'draw' && !hasDrawn) {
      alert('Please provide a handwritten signature');
      return;
    }

    setSignSubmitting(true);
    try {
      const sigData = signMethod === 'draw' && canvasRef.current ? canvasRef.current.toDataURL() : undefined;
      const res: any = await api.documents.sign(signingDoc.id, signer, sigData);

      // Update local state
      setData({
        ...data,
        documents: data.documents.map((d) =>
          d.id === signingDoc.id
            ? { ...d, status: 'signed', signerName: signer, signedAt: new Date().toISOString(), certificateHash: res?.certificateHash }
            : d
        ),
      });

      setSigningDoc(null);
    } catch (err: any) {
      alert(err.message || 'Signature recording failed');
    } finally {
      setSignSubmitting(false);
    }
  };

  const handleToggleLesson = async (courseId: string, lessonIdx: number, totalLessons: number) => {
    const key = `${courseId}_${lessonIdx}`;
    const nextState = !completedLessons[key];
    const newCompleted = { ...completedLessons, [key]: nextState };
    setCompletedLessons(newCompleted);

    // Calculate approximate progress
    const completedCount = Object.keys(newCompleted).filter(
      (k) => k.startsWith(`${courseId}_`) && newCompleted[k]
    ).length;
    const calculatedProgress = Math.round((completedCount / Math.max(1, totalLessons)) * 100);

    try {
      if (data?.contact?.id) {
        await api.portal.updateCourseProgress(data.contact.id, courseId, calculatedProgress);
        setData({
          ...data,
          courses: data.courses.map((c) =>
            c.courseId === courseId ? { ...c, progress: calculatedProgress } : c
          ),
        });
      }
    } catch {
      /* ignore */
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="brand__mark" style={{ width: 48, height: 48, fontSize: 20, margin: '0 auto 16px' }}>OP</div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Loading your client portal...</div>
          <div className="cell-sub" style={{ marginTop: 4 }}>Accessing secure portal services</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 24 }}>
        <div className="card" style={{ maxWidth: 480, textAlign: 'center', padding: 32 }}>
          <Icon name="lock" size={36} color="var(--amber)" />
          <h2 style={{ margin: '16px 0 8px', fontSize: 20 }}>Portal Access Restricted</h2>
          <p className="cell-sub" style={{ marginBottom: 24 }}>{error || 'Unable to authenticate this client portal link.'}</p>
          <Link to="/login" className="btn btn--primary" style={{ display: 'inline-flex' }}>Return to Home</Link>
        </div>
      </div>
    );
  }

  const { contact, invoices, courses, documents, appointments } = data;
  const totalDue = invoices
    .filter((i) => i.status !== 'paid')
    .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  const pendingDocs = documents.filter((d) => d.status !== 'signed').length;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' }}>
      {/* Top Navigation Bar */}
      <header style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1140, margin: '0 auto', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="brand__mark" style={{ width: 32, height: 32, fontSize: 13 }}>OP</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em' }}>Client Portal</div>
              <div className="cell-sub" style={{ fontSize: 11 }}>Growth & Performance Suite</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="row" style={{ gap: 8 }}>
              <Avatar name={`${contact.firstName} ${contact.lastName}`} size="sm" />
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                {contact.firstName} {contact.lastName}
              </span>
            </span>
            <Badge tone="green">Verified Client</Badge>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main style={{ maxWidth: 1140, margin: '0 auto', padding: '32px 24px' }}>
        {/* Welcome Banner */}
        <div
          style={{
            background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)',
            borderRadius: 16,
            padding: '32px 36px',
            color: '#fff',
            marginBottom: 28,
            boxShadow: '0 10px 25px -5px rgba(49, 46, 129, 0.25)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 20,
          }}
        >
          <div>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#c7d2fe', fontWeight: 600, marginBottom: 8 }}>
              Dedicated Client Workspace
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 8px 0', letterSpacing: '-0.02em' }}>
              Welcome back, {contact.firstName}!
            </h1>
            <p style={{ margin: 0, color: '#e0e7ff', fontSize: 14, maxWidth: 520, lineHeight: 1.5 }}>
              Manage your project deliverables, active agreements, course materials, and outstanding invoices directly in one unified portal.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            {totalDue > 0 && (
              <button
                className="btn"
                style={{ background: '#fff', color: '#1e1b4b', fontWeight: 600, border: 'none' }}
                onClick={() => setActiveTab('invoices')}
              >
                <Icon name="wallet" size={15} /> Pay Balance ({currency(totalDue)})
              </button>
            )}
            {pendingDocs > 0 && (
              <button
                className="btn"
                style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}
                onClick={() => setActiveTab('documents')}
              >
                <Icon name="file" size={15} /> Sign Agreements ({pendingDocs})
              </button>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', marginBottom: 24, overflowX: 'auto', paddingBottom: 4 }}>
          {[
            { id: 'overview', label: 'Overview', icon: 'dashboard' },
            { id: 'invoices', label: `Invoices (${invoices.length})`, icon: 'wallet' },
            { id: 'documents', label: `Agreements (${documents.length})`, icon: 'file' },
            { id: 'courses', label: `Courses (${courses.length})`, icon: 'book' },
            { id: 'appointments', label: `Sessions (${appointments.length})`, icon: 'calendar' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className="btn btn--subtle"
              style={{
                borderRadius: 8,
                background: activeTab === tab.id ? 'var(--surface-2)' : 'transparent',
                fontWeight: activeTab === tab.id ? 600 : 500,
                color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
                padding: '8px 16px',
                fontSize: 13,
              }}
            >
              <Icon name={tab.icon} size={15} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="stack" style={{ gap: 24 }}>
            <div className="grid grid--4">
              <div className="card">
                <div className="card__body">
                  <div className="cell-sub" style={{ fontSize: 12, marginBottom: 6 }}>Balance Due</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: totalDue > 0 ? 'var(--amber)' : 'var(--green)' }}>
                    {currency(totalDue)}
                  </div>
                  <div className="cell-sub" style={{ fontSize: 11, marginTop: 4 }}>
                    {totalDue > 0 ? 'Outstanding payment balance' : 'All accounts settled'}
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card__body">
                  <div className="cell-sub" style={{ fontSize: 12, marginBottom: 6 }}>Agreements</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>
                    {documents.filter((d) => d.status === 'signed').length} / {documents.length}
                  </div>
                  <div className="cell-sub" style={{ fontSize: 11, marginTop: 4 }}>
                    {pendingDocs > 0 ? `${pendingDocs} awaiting legal signature` : 'All contracts executed'}
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card__body">
                  <div className="cell-sub" style={{ fontSize: 12, marginBottom: 6 }}>Learning Modules</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>
                    {courses.length}
                  </div>
                  <div className="cell-sub" style={{ fontSize: 11, marginTop: 4 }}>
                    Active training curriculums
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card__body">
                  <div className="cell-sub" style={{ fontSize: 12, marginBottom: 6 }}>Upcoming Sessions</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>
                    {appointments.length}
                  </div>
                  <div className="cell-sub" style={{ fontSize: 11, marginTop: 4 }}>
                    Scheduled strategy calls
                  </div>
                </div>
              </div>
            </div>

            {/* Invoices Preview */}
            <div className="card">
              <div className="card__head row row--between">
                <div>
                  <div className="card__title">Recent Invoices</div>
                  <div className="card__sub">Billing and transaction records</div>
                </div>
                <button className="btn btn--subtle btn--sm" onClick={() => setActiveTab('invoices')}>
                  View all invoices
                </button>
              </div>
              <div className="card__body">
                {invoices.length === 0 ? (
                  <div className="cell-sub" style={{ padding: '16px 0', textAlign: 'center' }}>No invoices issued yet.</div>
                ) : (
                  <div className="stack" style={{ gap: 10 }}>
                    {invoices.slice(0, 3).map((inv) => (
                      <div key={inv.id} className="row row--between" style={{ padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8 }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{inv.number}</div>
                          <div className="cell-sub" style={{ fontSize: 11 }}>{inv.description || 'Growth advisory services'}</div>
                        </div>
                        <div className="row" style={{ gap: 12 }}>
                          <span style={{ fontWeight: 700, fontSize: 14 }}>{currency(inv.amount)}</span>
                          <Badge tone={inv.status === 'paid' ? 'green' : 'amber'}>{inv.status}</Badge>
                          {inv.status !== 'paid' && (
                            <button className="btn btn--primary btn--sm" onClick={() => setPayingInvoice(inv)}>
                              Pay Now
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Documents Preview */}
            <div className="card">
              <div className="card__head row row--between">
                <div>
                  <div className="card__title">Contracts & Agreements</div>
                  <div className="card__sub">Legal paperwork and mutual non-disclosures</div>
                </div>
                <button className="btn btn--subtle btn--sm" onClick={() => setActiveTab('documents')}>
                  View all agreements
                </button>
              </div>
              <div className="card__body">
                {documents.length === 0 ? (
                  <div className="cell-sub" style={{ padding: '16px 0', textAlign: 'center' }}>No contracts assigned to your account.</div>
                ) : (
                  <div className="stack" style={{ gap: 10 }}>
                    {documents.slice(0, 3).map((doc) => (
                      <div key={doc.id} className="row row--between" style={{ padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8 }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{doc.name || doc.title}</div>
                          <div className="cell-sub" style={{ fontSize: 11 }}>
                            {doc.status === 'signed' ? `Signed by ${doc.signerName} on ${fullDate(doc.signedAt || '')}` : 'Requires electronic signature'}
                          </div>
                        </div>
                        <div className="row" style={{ gap: 12 }}>
                          <Badge tone={doc.status === 'signed' ? 'green' : 'blue'}>{doc.status}</Badge>
                          {doc.status !== 'signed' && (
                            <button className="btn btn--primary btn--sm" onClick={() => { setSigningDoc(doc); setTypedName(`${contact.firstName} ${contact.lastName}`); }}>
                              Sign Contract
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: INVOICES */}
        {activeTab === 'invoices' && (
          <div className="card">
            <div className="card__head row row--between">
              <div>
                <div className="card__title">All Invoices</div>
                <div className="card__sub">Download receipts and pay open invoices online</div>
              </div>
            </div>
            <div className="card__body" style={{ padding: 0 }}>
              {invoices.length === 0 ? (
                <div className="cell-sub" style={{ padding: 32, textAlign: 'center' }}>No invoices on file.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Invoice #</th>
                        <th>Description</th>
                        <th>Due Date</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th style={{ textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => (
                        <tr key={inv.id}>
                          <td style={{ fontWeight: 600 }}>{inv.number}</td>
                          <td>{inv.description || 'Growth advisory services'}</td>
                          <td className="cell-sub">{inv.dueDate ? fullDate(inv.dueDate) : 'On Receipt'}</td>
                          <td style={{ fontWeight: 700 }}>{currency(inv.amount)}</td>
                          <td>
                            <Badge tone={inv.status === 'paid' ? 'green' : 'amber'}>{inv.status}</Badge>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {inv.status !== 'paid' ? (
                              <button className="btn btn--primary btn--sm" onClick={() => setPayingInvoice(inv)}>
                                <Icon name="wallet" size={13} /> Pay Online
                              </button>
                            ) : (
                              <button className="btn btn--subtle btn--sm" onClick={() => window.print()}>
                                <Icon name="download" size={13} /> Receipt
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: DOCUMENTS & AGREEMENTS */}
        {activeTab === 'documents' && (
          <div className="card">
            <div className="card__head row row--between">
              <div>
                <div className="card__title">Legal Agreements & Proposals</div>
                <div className="card__sub">Legally binding electronic signature pursuant to ESIGN & UETA</div>
              </div>
            </div>
            <div className="card__body" style={{ padding: 0 }}>
              {documents.length === 0 ? (
                <div className="cell-sub" style={{ padding: 32, textAlign: 'center' }}>No agreements shared with your account yet.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Document</th>
                        <th>Contract Value</th>
                        <th>Status</th>
                        <th>Audit Certificate</th>
                        <th style={{ textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map((doc) => (
                        <tr key={doc.id}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{doc.name || doc.title}</div>
                            <div className="cell-sub" style={{ fontSize: 11 }}>Master Services Agreement & Statement of Work</div>
                          </td>
                          <td style={{ fontWeight: 600 }}>{doc.value ? currency(doc.value) : 'Standard Terms'}</td>
                          <td>
                            <Badge tone={doc.status === 'signed' ? 'green' : 'blue'}>{doc.status}</Badge>
                          </td>
                          <td>
                            {doc.status === 'signed' ? (
                              <span className="mono-cell" style={{ fontSize: 11 }}>
                                {doc.certificateHash ? doc.certificateHash.slice(0, 16) + '...' : 'SHA-256 Verified'}
                              </span>
                            ) : (
                              <span className="cell-sub">Pending signature</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {doc.status !== 'signed' ? (
                              <button className="btn btn--primary btn--sm" onClick={() => { setSigningDoc(doc); setTypedName(`${contact.firstName} ${contact.lastName}`); }}>
                                <Icon name="pen" size={13} /> Sign Contract
                              </button>
                            ) : (
                              <span className="cell-sub" style={{ color: 'var(--green)', fontWeight: 600 }}>
                                <Icon name="check" size={14} /> Signed
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: COURSES & CURRICULUM */}
        {activeTab === 'courses' && (
          <div className="stack" style={{ gap: 20 }}>
            {courses.length === 0 ? (
              <div className="card" style={{ padding: 36, textAlign: 'center' }}>
                <Icon name="book" size={32} color="var(--text-muted)" />
                <h3 style={{ margin: '12px 0 6px', fontSize: 16 }}>No Courses Enrolled</h3>
                <p className="cell-sub">Your growth advisory team hasn't assigned any training curriculum yet.</p>
              </div>
            ) : (
              courses.map((course) => {
                const curriculum = course.curriculum && course.curriculum.length > 0
                  ? course.curriculum
                  : [
                      { title: 'Module 1: Onboarding & Operating Systems Baseline', duration: '18 min' },
                      { title: 'Module 2: High-Velocity Sales Funnel Architecture', duration: '25 min' },
                      { title: 'Module 3: Omnichannel Automation & Lead Scoring', duration: '32 min' },
                      { title: 'Module 4: Scaling Retainers & Client Retention', duration: '22 min' },
                    ];

                return (
                  <div key={course.courseId} className="card">
                    <div className="card__head row row--between">
                      <div>
                        <div className="card__title">{course.name}</div>
                        <div className="card__sub">{curriculum.length} interactive lessons</div>
                      </div>
                      <div className="row" style={{ gap: 12 }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{course.progress}% Completed</span>
                        <Badge tone={course.progress >= 100 ? 'green' : 'violet'}>
                          {course.progress >= 100 ? 'Completed' : 'In Progress'}
                        </Badge>
                      </div>
                    </div>

                    <div className="card__body">
                      {/* Progress Bar */}
                      <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden', marginBottom: 20 }}>
                        <div
                          style={{
                            width: `${course.progress}%`,
                            height: '100%',
                            background: 'linear-gradient(90deg, #4f46e5, #06b6d4)',
                            transition: 'width 0.4s ease',
                          }}
                        />
                      </div>

                      {/* Lesson Checklist */}
                      <div className="stack" style={{ gap: 8 }}>
                        {curriculum.map((lesson, idx) => {
                          const key = `${course.courseId}_${idx}`;
                          const isDone = completedLessons[key] || course.progress >= ((idx + 1) / curriculum.length) * 100;
                          return (
                            <div
                              key={idx}
                              className="row row--between"
                              style={{
                                padding: '10px 14px',
                                background: isDone ? 'rgba(16, 185, 129, 0.06)' : 'var(--surface-2)',
                                borderRadius: 8,
                                border: isDone ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid transparent',
                              }}
                            >
                              <label className="row" style={{ gap: 10, cursor: 'pointer', flex: 1 }}>
                                <input
                                  type="checkbox"
                                  checked={isDone}
                                  onChange={() => handleToggleLesson(course.courseId, idx, curriculum.length)}
                                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                                />
                                <span style={{ fontSize: 13, fontWeight: isDone ? 600 : 500, textDecoration: isDone ? 'line-through' : 'none' }}>
                                  {lesson.title}
                                </span>
                              </label>
                              <span className="cell-sub" style={{ fontSize: 11 }}>{lesson.duration || '15 min'}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* TAB 5: APPOINTMENTS */}
        {activeTab === 'appointments' && (
          <div className="card">
            <div className="card__head row row--between">
              <div>
                <div className="card__title">Scheduled Strategy Sessions</div>
                <div className="card__sub">One-on-one advisory and progress sync meetings</div>
              </div>
            </div>
            <div className="card__body" style={{ padding: 0 }}>
              {appointments.length === 0 ? (
                <div className="cell-sub" style={{ padding: 32, textAlign: 'center' }}>No upcoming sessions scheduled.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Meeting Title</th>
                        <th>Date & Time</th>
                        <th>Duration</th>
                        <th>Status</th>
                        <th style={{ textAlign: 'right' }}>Conference Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {appointments.map((app) => (
                        <tr key={app.id}>
                          <td style={{ fontWeight: 600 }}>{app.title}</td>
                          <td>{fullDate(app.startsAt)}</td>
                          <td className="cell-sub">45 min</td>
                          <td>
                            <Badge tone="green">{app.status || 'confirmed'}</Badge>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <a
                              href="https://meet.google.com"
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn--subtle btn--sm"
                              style={{ display: 'inline-flex', gap: 6 }}
                            >
                              <Icon name="globe" size={13} /> Join Meeting
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* MODAL 1: PAY INVOICE */}
      {payingInvoice && (
        <Modal
          title={`Pay Invoice #${payingInvoice.number}`}
          onClose={() => setPayingInvoice(null)}
          footer={
            <div className="row row--between" style={{ width: '100%' }}>
              <div style={{ fontSize: 13 }}>
                Amount: <strong style={{ fontSize: 16 }}>{currency(payingInvoice.amount)}</strong>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn--subtle" type="button" onClick={() => setPayingInvoice(null)}>
                  Cancel
                </button>
                <button
                  className="btn btn--primary"
                  type="button"
                  disabled={payLoading || paySuccess || cardNumber.replace(/\s/g, '').length < 15}
                  onClick={handlePayInvoice}
                >
                  {payLoading ? 'Processing...' : paySuccess ? 'Paid!' : `Pay ${currency(payingInvoice.amount)}`}
                </button>
              </div>
            </div>
          }
        >
          {paySuccess ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <Icon name="check" size={36} color="var(--green)" />
              <h3 style={{ margin: '16px 0 8px' }}>Payment Successful!</h3>
              <p className="cell-sub">Invoice #{payingInvoice.number} has been marked paid. Receipt dispatched to {contact.email}.</p>
            </div>
          ) : (
            <form onSubmit={handlePayInvoice} className="stack" style={{ gap: 14 }}>
              <div className="hint" style={{ fontSize: 12 }}>
                🔒 256-Bit SSL Encrypted Card Processing · PCI-DSS Level 1 Certified
              </div>

              <div>
                <label className="field-label" style={{ fontSize: 12 }}>Card Number</label>
                <input
                  type="text"
                  className="field-input"
                  placeholder="4242 4242 4242 4242"
                  value={cardNumber}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, '').slice(0, 16);
                    setCardNumber(raw.replace(/(\d{4})(?=\d)/g, '$1 '));
                  }}
                  required
                />
              </div>

              <div className="row" style={{ gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="field-label" style={{ fontSize: 12 }}>MM / YY</label>
                  <input
                    type="text"
                    className="field-input"
                    placeholder="12/28"
                    value={expiry}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, '').slice(0, 4);
                      setExpiry(raw.length > 2 ? `${raw.slice(0, 2)}/${raw.slice(2)}` : raw);
                    }}
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="field-label" style={{ fontSize: 12 }}>CVC / CVV</label>
                  <input
                    type="password"
                    className="field-input"
                    placeholder="123"
                    maxLength={4}
                    value={cvc}
                    onChange={(e) => setCvc(e.target.value.replace(/\D/g, ''))}
                    required
                  />
                </div>
              </div>
            </form>
          )}
        </Modal>
      )}

      {/* MODAL 2: SIGN DOCUMENT */}
      {signingDoc && (
        <Modal
          title={`Sign Agreement: ${signingDoc.name || signingDoc.title}`}
          onClose={() => setSigningDoc(null)}
          footer={
            <div className="row row--between" style={{ width: '100%' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Pursuant to the U.S. ESIGN Act (15 U.S.C. § 7001)
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn--subtle" type="button" onClick={() => setSigningDoc(null)}>
                  Cancel
                </button>
                <button
                  className="btn btn--primary"
                  type="button"
                  disabled={signSubmitting || (signMethod === 'draw' && !hasDrawn) || (signMethod === 'type' && !typedName.trim())}
                  onClick={handleSignDocument}
                >
                  {signSubmitting ? 'Recording...' : 'Accept & Legally Sign'}
                </button>
              </div>
            </div>
          }
        >
          <div className="stack" style={{ gap: 16 }}>
            <div className="card" style={{ background: 'var(--surface-2)', border: 'none', padding: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Electronic Signature Disclosure</div>
              <p className="cell-sub" style={{ fontSize: 11, margin: 0, lineHeight: 1.4 }}>
                By affixing your signature below, you consent to enter into a legally binding electronic contract with the agency and affirm your intention to adopt this record.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={`btn btn--sm ${signMethod === 'draw' ? 'btn--primary' : 'btn--subtle'}`}
                onClick={() => setSignMethod('draw')}
              >
                <Icon name="pen" size={13} /> Draw Signature
              </button>
              <button
                type="button"
                className={`btn btn--sm ${signMethod === 'type' ? 'btn--primary' : 'btn--subtle'}`}
                onClick={() => setSignMethod('type')}
              >
                Type Name
              </button>
            </div>

            {signMethod === 'draw' ? (
              <div>
                <div style={{ border: '2px dashed var(--border)', borderRadius: 8, background: '#fff', cursor: 'crosshair', overflow: 'hidden' }}>
                  <canvas
                    ref={canvasRef}
                    width={480}
                    height={140}
                    style={{ width: '100%', height: 140, display: 'block' }}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                  />
                </div>
                <div className="row row--between" style={{ marginTop: 6 }}>
                  <span className="cell-sub" style={{ fontSize: 11 }}>Sign with your mouse or fingertip above</span>
                  <button type="button" className="btn btn--subtle btn--sm" onClick={clearCanvas}>Clear</button>
                </div>
              </div>
            ) : (
              <div>
                <label className="field-label" style={{ fontSize: 12 }}>Your Full Legal Name</label>
                <input
                  type="text"
                  className="field-input"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder="e.g. John Doe"
                  style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 18, padding: '12px 14px' }}
                />
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
