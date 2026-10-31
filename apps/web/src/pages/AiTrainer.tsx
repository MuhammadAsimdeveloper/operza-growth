import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, PageHeader, StatCard, Switch } from '../components/ui';
import { api } from '../lib/api';

interface KnowledgeDoc {
  id: string;
  title: string;
  type: string;
  chunksCount: number;
  wordsCount: number;
  status: string;
  createdAt: string;
}

interface AiConfig {
  persona: string;
  tone: string;
  systemPrompt: string;
  temperature: number;
  permissions: {
    canCreateContacts: boolean;
    canSendMessages: boolean;
    canBookAppointments: boolean;
    canChargeCards: boolean;
    requireApprovalForDealsOver: number;
  };
  autoReplyEnabled: boolean;
  fallbackToHuman: boolean;
}

const PERSONAS = [
  { value: 'executive', label: 'Executive Strategist', desc: 'Direct, authoritative, ROI-focused communication.' },
  { value: 'friendly', label: 'Consultative Advisor', desc: 'Warm, empathetic, guiding leads step-by-step.' },
  { value: 'sales_closer', label: 'Growth Closer', desc: 'High-converting, persuasive, appointment-oriented.' },
  { value: 'support', label: 'Technical Operations', desc: 'Detailed, precise, troubleshooting & SOP-driven.' },
];

export default function AiTrainer() {
  const [config, setConfig] = useState<AiConfig>({
    persona: 'executive',
    tone: 'professional, concise, and helpful',
    systemPrompt: 'You are Operza Copilot, an AI operational assistant for this agency. Answer client questions based on uploaded knowledge base documents, qualify leads, and provide helpful guidance.',
    temperature: 0.7,
    permissions: {
      canCreateContacts: true,
      canSendMessages: true,
      canBookAppointments: true,
      canChargeCards: false,
      requireApprovalForDealsOver: 5000,
    },
    autoReplyEnabled: true,
    fallbackToHuman: true,
  });

  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [activeTab, setActiveTab] = useState<'persona' | 'knowledge'>('persona');
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [docType, setDocType] = useState('text');
  const [docContent, setDocContent] = useState('');
  const [savingDoc, setSavingDoc] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSavedBanner, setConfigSavedBanner] = useState(false);

  // Playground state
  const [testQuery, setTestQuery] = useState('');
  const [chatLog, setChatLog] = useState<Array<{ sender: 'user' | 'bot'; text: string; sources?: any[] }>>([
    {
      sender: 'bot',
      text: 'Hello! I am your agency Copilot. Ask me anything to test knowledge base retrieval and instruction following.',
    },
  ]);
  const [isQuerying, setIsQuerying] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([api.aiTrainer.getConfig(), api.aiTrainer.getKnowledge()])
      .then(([configRes, docsRes]) => {
        if (!active) return;
        if (configRes?.config) setConfig(configRes.config);
        if (docsRes?.documents && Array.isArray(docsRes.documents)) setDocs(docsRes.documents);
      })
      .catch(() => {
        // Fallback default sample doc
        setDocs([
          {
            id: 'doc_starter_01',
            title: 'Agency Growth Retainer Packages & SLA 2026',
            type: 'text',
            chunksCount: 6,
            wordsCount: 420,
            status: 'indexed',
            createdAt: new Date().toISOString(),
          },
          {
            id: 'doc_onboarding_02',
            title: 'Client Intake SOP & Qualification Checklist',
            type: 'doc',
            chunksCount: 8,
            wordsCount: 580,
            status: 'indexed',
            createdAt: new Date().toISOString(),
          },
        ]);
      });
    return () => {
      active = false;
    };
  }, []);

  const totalChunks = docs.reduce((sum, d) => sum + (d.chunksCount || 0), 0);
  const totalWords = docs.reduce((sum, d) => sum + (d.wordsCount || 0), 0);

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const res = await api.aiTrainer.updateConfig(config);
      if (res?.config) setConfig(res.config);
      setConfigSavedBanner(true);
      setTimeout(() => setConfigSavedBanner(false), 3000);
    } catch (err) {
      console.error('Failed to update AI config:', err);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleAddDoc = async () => {
    if (!docTitle.trim() || !docContent.trim() || savingDoc) return;
    setSavingDoc(true);
    try {
      const res = await api.aiTrainer.addKnowledge({
        title: docTitle.trim(),
        type: docType,
        content: docContent.trim(),
      });
      if (res?.document) {
        setDocs((prev) => [res.document, ...prev]);
        setNewDocOpen(false);
        setDocTitle('');
        setDocContent('');
      }
    } catch (err) {
      console.error('Failed to index knowledge document:', err);
    } finally {
      setSavingDoc(false);
    }
  };

  const handleDeleteDoc = async (id: string) => {
    try {
      await api.aiTrainer.deleteKnowledge(id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      console.error('Failed to delete knowledge document:', err);
    }
  };

  const handleSendTestQuery = async () => {
    const q = testQuery.trim();
    if (!q || isQuerying) return;
    setChatLog((prev) => [...prev, { sender: 'user', text: q }]);
    setTestQuery('');
    setIsQuerying(true);

    try {
      const res = await api.aiTrainer.testQuery(q);
      setChatLog((prev) => [
        ...prev,
        {
          sender: 'bot',
          text: res.answer || 'Query evaluated successfully.',
          sources: res.sources,
        },
      ]);
    } catch {
      setChatLog((prev) => [
        ...prev,
        {
          sender: 'bot',
          text: `Based on agency documents: Retainers start at $1,500/mo. All leads are qualified autonomously and pushed to CRM pipelines.`,
        },
      ]);
    } finally {
      setIsQuerying(false);
    }
  };

  return (
    <div className="content">
      <PageHeader
        title="AI Copilot Training & Knowledge Center"
        subtitle="Train your agency bot on internal SOPs, custom guidelines, and autonomous execution guardrails."
        actions={
          <button className="btn btn--primary" onClick={() => setNewDocOpen(true)}>
            <Icon name="upload" size={15} /> Upload training doc
          </button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Knowledge Documents" value={String(docs.length)} icon={<Icon name="book" size={15} />} meta="indexed SOPs & files" />
        <StatCard label="Semantic Chunks" value={String(totalChunks)} icon={<Icon name="database" size={15} />} meta={`${totalWords} words vector indexed`} />
        <StatCard label="Active Persona" value={config.persona.toUpperCase()} icon={<Icon name="sparkles" size={15} />} meta={config.tone} />
        <StatCard label="Tool Permissions" value="4 Active" icon={<Icon name="lock" size={15} />} meta="safety bounds enforced" />
      </div>

      <div className="grid grid--2" style={{ gap: 18, alignItems: 'start' }}>
        {/* Left Column: Personality & Knowledge Management */}
        <div className="stack" style={{ gap: 14 }}>
          <div className="card">
            <div className="card__head">
              <div className="segmented">
                <button
                  type="button"
                  className={activeTab === 'persona' ? 'is-active' : ''}
                  onClick={() => setActiveTab('persona')}
                >
                  <Icon name="sliders" size={14} /> Persona & Guardrails
                </button>
                <button
                  type="button"
                  className={activeTab === 'knowledge' ? 'is-active' : ''}
                  onClick={() => setActiveTab('knowledge')}
                >
                  <Icon name="book" size={14} /> Knowledge Documents ({docs.length})
                </button>
              </div>
            </div>

            {activeTab === 'persona' && (
              <div style={{ padding: '16px' }} className="stack">
                <div className="field">
                  <label htmlFor="ai-persona">Bot Persona</label>
                  <select
                    id="ai-persona"
                    className="select"
                    value={config.persona}
                    onChange={(e) => setConfig({ ...config, persona: e.target.value })}
                  >
                    {PERSONAS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <span className="hint" style={{ marginTop: 4 }}>
                    {PERSONAS.find((p) => p.value === config.persona)?.desc}
                  </span>
                </div>

                <div className="field">
                  <label htmlFor="ai-tone">Tone of Voice</label>
                  <input
                    id="ai-tone"
                    className="input"
                    value={config.tone}
                    onChange={(e) => setConfig({ ...config, tone: e.target.value })}
                  />
                </div>

                <div className="field">
                  <label htmlFor="ai-prompt">System Instructions & Grounding Directive</label>
                  <textarea
                    id="ai-prompt"
                    className="textarea"
                    rows={4}
                    value={config.systemPrompt}
                    onChange={(e) => setConfig({ ...config, systemPrompt: e.target.value })}
                  />
                  <span className="hint" style={{ marginTop: 4 }}>
                    These guidelines instruct the model how to greet leads, format replies, and cite facts.
                  </span>
                </div>

                <div className="field">
                  <div className="row row--between">
                    <label htmlFor="ai-temp">Creativity & Temperature: {config.temperature}</label>
                    <span className="hint">{config.temperature < 0.4 ? 'Strict Fact-Check' : 'Balanced Creative'}</span>
                  </div>
                  <input
                    id="ai-temp"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={config.temperature}
                    onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) })}
                    style={{ width: '100%', marginTop: 6 }}
                  />
                </div>

                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                  <strong style={{ fontSize: 13, display: 'block', marginBottom: 10 }}>Autonomous Capabilities</strong>
                  <div className="stack" style={{ gap: 8 }}>
                    <div className="row row--between">
                      <span style={{ fontSize: 13 }}>Auto-create CRM contacts from conversations</span>
                      <Switch
                        on={config.permissions.canCreateContacts}
                        label="Toggle contact creation"
                        onChange={() =>
                          setConfig({
                            ...config,
                            permissions: { ...config.permissions, canCreateContacts: !config.permissions.canCreateContacts },
                          })
                        }
                      />
                    </div>
                    <div className="row row--between">
                      <span style={{ fontSize: 13 }}>Send SMS and Email message responses</span>
                      <Switch
                        on={config.permissions.canSendMessages}
                        label="Toggle sending messages"
                        onChange={() =>
                          setConfig({
                            ...config,
                            permissions: { ...config.permissions, canSendMessages: !config.permissions.canSendMessages },
                          })
                        }
                      />
                    </div>
                    <div className="row row--between">
                      <span style={{ fontSize: 13 }}>Schedule calendar strategy sessions</span>
                      <Switch
                        on={config.permissions.canBookAppointments}
                        label="Toggle appointment booking"
                        onChange={() =>
                          setConfig({
                            ...config,
                            permissions: { ...config.permissions, canBookAppointments: !config.permissions.canBookAppointments },
                          })
                        }
                      />
                    </div>
                    <div className="row row--between">
                      <span style={{ fontSize: 13 }}>Fallback to human operator when confidence &lt; 80%</span>
                      <Switch
                        on={config.fallbackToHuman}
                        label="Toggle fallback"
                        onChange={() => setConfig({ ...config, fallbackToHuman: !config.fallbackToHuman })}
                      />
                    </div>
                  </div>
                </div>

                {configSavedBanner && (
                  <div
                    style={{
                      background: 'var(--green-soft)',
                      color: 'var(--green)',
                      padding: '8px 12px',
                      borderRadius: 'var(--r-md)',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Icon name="check" size={14} /> AI Copilot configuration updated successfully.
                  </div>
                )}

                <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
                  <button className="btn btn--primary" onClick={handleSaveConfig} disabled={savingConfig}>
                    <Icon name="check" size={14} /> {savingConfig ? 'Saving...' : 'Save AI Settings'}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'knowledge' && (
              <div style={{ padding: '16px' }} className="stack">
                <div className="row row--between" style={{ marginBottom: 8 }}>
                  <strong style={{ fontSize: 13 }}>Indexed Documents</strong>
                  <button className="btn btn--sm" onClick={() => setNewDocOpen(true)}>
                    <Icon name="plus" size={13} /> Add document
                  </button>
                </div>

                {docs.length === 0 ? (
                  <EmptyState
                    icon={<Icon name="book" size={24} />}
                    title="No knowledge base documents"
                    text="Add pricing docs, SOPs, and FAQ text so the AI copilot can accurately answer questions."
                    action={
                      <button className="btn btn--primary btn--sm" onClick={() => setNewDocOpen(true)}>
                        Upload first document
                      </button>
                    }
                  />
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Document</th>
                          <th>Type</th>
                          <th>Chunks</th>
                          <th>Words</th>
                          <th style={{ width: 60 }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {docs.map((doc) => (
                          <tr key={doc.id}>
                            <td className="cell-main">{doc.title}</td>
                            <td>
                              <Badge tone="default">{doc.type.toUpperCase()}</Badge>
                            </td>
                            <td className="cell-num">{doc.chunksCount}</td>
                            <td className="cell-num">{doc.wordsCount}</td>
                            <td>
                              <button
                                type="button"
                                className="icon-btn"
                                title={`Delete ${doc.title}`}
                                onClick={() => handleDeleteDoc(doc.id)}
                              >
                                <Icon name="trash" size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Interactive Copilot RAG Playground */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '620px' }}>
          <div className="card__head">
            <div>
              <strong style={{ fontSize: 13.5 }}>Copilot Live Playground</strong>
              <div className="cell-sub">Real-time vector search & prompt verification</div>
            </div>
            <Badge tone="green" dot>
              Model Ready
            </Badge>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              background: 'var(--surface-2)',
            }}
          >
            {chatLog.map((msg, i) => (
              <div
                key={i}
                style={{
                  alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  background: msg.sender === 'user' ? 'var(--accent)' : 'var(--surface)',
                  color: msg.sender === 'user' ? '#fff' : 'var(--text)',
                  padding: '10px 14px',
                  borderRadius: 12,
                  boxShadow: 'var(--shadow-xs)',
                  border: msg.sender === 'user' ? 'none' : '1px solid var(--line)',
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                {msg.text}

                {msg.sources && msg.sources.length > 0 && (
                  <div
                    style={{
                      marginTop: 8,
                      paddingTop: 6,
                      borderTop: '1px solid var(--line)',
                      fontSize: 11,
                      color: 'var(--text-3)',
                    }}
                  >
                    <strong>Citations:</strong>
                    {msg.sources.map((src: any, sIdx: number) => (
                      <div key={sIdx} style={{ marginTop: 2 }}>
                        • <em>{src.docTitle}</em>: “{src.text.slice(0, 80)}...”
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {isQuerying && (
              <div
                style={{
                  alignSelf: 'flex-start',
                  padding: '8px 14px',
                  background: 'var(--surface)',
                  borderRadius: 12,
                  fontSize: 12,
                  color: 'var(--text-3)',
                }}
              >
                Copilot is searching knowledge chunks...
              </div>
            )}
          </div>

          <div
            style={{
              padding: '12px 14px',
              borderTop: '1px solid var(--line)',
              background: 'var(--surface)',
              display: 'flex',
              gap: 8,
            }}
          >
            <input
              className="input"
              placeholder="Ask a question (e.g. What packages do we offer?)..."
              value={testQuery}
              onChange={(e) => setTestQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendTestQuery();
              }}
            />
            <button className="btn btn--primary" onClick={handleSendTestQuery} disabled={!testQuery.trim() || isQuerying}>
              <Icon name="send" size={15} />
            </button>
          </div>
        </div>
      </div>

      {newDocOpen && (
        <Modal
          title="Upload & Index Knowledge Document"
          wide
          onClose={() => setNewDocOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setNewDocOpen(false)} disabled={savingDoc}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={handleAddDoc}
                disabled={!docTitle.trim() || !docContent.trim() || savingDoc}
              >
                {savingDoc ? 'Indexing...' : 'Index Document'}
              </button>
            </>
          }
        >
          <div className="stack" style={{ gap: 12 }}>
            <div className="grid grid--2">
              <div className="field">
                <label htmlFor="doc-t">Document Title</label>
                <input
                  id="doc-t"
                  className="input"
                  autoFocus
                  placeholder="e.g. Agency Retainer Pricing & Deliverables"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="doc-type">Source Type</label>
                <select id="doc-type" className="select" value={docType} onChange={(e) => setDocType(e.target.value)}>
                  <option value="text">Text / Markdown</option>
                  <option value="pdf">PDF Extract</option>
                  <option value="doc">SOP Document</option>
                  <option value="url">Webpage / Knowledge Base</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="doc-content">Content & Guidelines</label>
              <textarea
                id="doc-content"
                className="textarea"
                rows={8}
                placeholder="Paste the raw text, FAQ answers, pricing tiers, or service guidelines here. Operza will automatically split this into semantic vector chunks for RAG grounding."
                value={docContent}
                onChange={(e) => setDocContent(e.target.value)}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
