import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { Icon } from './Icon';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  agent?: string;
  handoff?: { from: string; to: string; reason?: string };
  proposal?: { id: string; toolName: string; status: string; params: any };
  timestamp: string;
}

export function CopilotHub() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const openOperzaCopilot = () => setIsOpen(true);
    window.addEventListener('operza:open-copilot', openOperzaCopilot);
    window.addEventListener('atlas:open-copilot', openOperzaCopilot);
    return () => {
      window.removeEventListener('operza:open-copilot', openOperzaCopilot);
      window.removeEventListener('atlas:open-copilot', openOperzaCopilot);
    };
  }, []);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Welcome to Operza Copilot Swarm. Our autonomous agents (Supervisor, CRM, Automation & Support) can query contacts, qualify leads, generate visual workflows, and manage operations in any language.',
      agent: 'supervisor',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeAgentName, setActiveAgentName] = useState<string>('supervisor');
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen, isExpanded]);

  useEffect(() => {
    // Poll for pending workflow approvals every 10 seconds
    const checkApprovals = async () => {
      try {
        const runs = await api.workflows.getRuns();
        const waiting = runs.filter((r: any) => r.status === 'waiting_approval');
        setPendingApprovals(waiting);
      } catch {
        // Not authenticated or server offline
      }
    };
    checkApprovals();
    const interval = setInterval(checkApprovals, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleInlineApprove = async (proposalId: string) => {
    try {
      await api.copilot.approveProposal(proposalId);
      setMessages((prev) =>
        prev.map((m) =>
          m.proposal?.id === proposalId
            ? { ...m, proposal: { ...m.proposal, status: 'approved' } }
            : m
        )
      );
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          sender: 'assistant',
          text: `✅ Action proposal ${proposalId.slice(0, 8)} approved. Execution logged.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } catch (err: any) {
      alert(`Approval error: ${err.message}`);
    }
  };

  const handleInlineReject = async (proposalId: string) => {
    try {
      await api.copilot.rejectProposal(proposalId);
      setMessages((prev) =>
        prev.map((m) =>
          m.proposal?.id === proposalId
            ? { ...m, proposal: { ...m.proposal, status: 'rejected' } }
            : m
        )
      );
    } catch (err: any) {
      alert(`Dismiss error: ${err.message}`);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    const userMsg = input.trim();
    setInput('');

    const userMessageObj: Message = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: userMsg,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const assistantMessageId = `a-${Date.now()}`;
    const assistantMessageObj: Message = {
      id: assistantMessageId,
      sender: 'assistant',
      text: '',
      agent: activeAgentName,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, userMessageObj, assistantMessageObj]);
    setIsStreaming(true);

    try {
      const response = await fetch(`/api/copilot/chat/stream?message=${encodeURIComponent(userMsg)}`, {
        headers: { 'Accept': 'text/event-stream' },
        credentials: 'include'
      });

      if (!response.ok || !response.body) {
        // Fallback to legacy chat endpoint
        const res = await api.copilot.chat({ message: userMsg });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? { ...m, text: res.message?.content || 'Action completed.' }
              : m
          )
        );
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';
      let currentAgent = activeAgentName;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunkStr = decoder.decode(value, { stream: true });
        const lines = chunkStr.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'token') {
                accumulatedText += event.token;
                currentAgent = event.agent || currentAgent;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId
                      ? { ...m, text: accumulatedText, agent: currentAgent }
                      : m
                  )
                );
              } else if (event.type === 'agent_handoff') {
                currentAgent = event.to;
                setActiveAgentName(event.to);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId
                      ? { ...m, handoff: { from: event.from, to: event.to, reason: event.reason } }
                      : m
                  )
                );
              } else if (event.type === 'proposal_created') {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId
                      ? {
                          ...m,
                          proposal: {
                            id: event.proposalId,
                            toolName: event.toolName,
                            status: event.status || 'pending',
                            params: event.params
                          }
                        }
                      : m
                  )
                );
              }
            } catch {
              // Non-JSON or comment chunk
            }
          }
        }
      }

      if (!accumulatedText) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId ? { ...m, text: 'Request analyzed and completed.' } : m
          )
        );
      }
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessageId ? { ...m, text: `⚠️ ${err.message}` } : m
        )
      );
    } finally {
      setIsStreaming(false);
    }
  };

  const handleApprove = async (runId: string) => {
    try {
      await api.workflows.approveRun(runId);
      setPendingApprovals((prev) => prev.filter((p) => p.id !== runId));
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          sender: 'assistant',
          text: `✅ Approved workflow step for execution ${runId.slice(0, 8)}. Step execution resumed.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } catch (err: any) {
      alert(`Approval error: ${err.message}`);
    }
  };

  return (
    <div className={`copilot-container ${isExpanded ? 'copilot-container--expanded' : ''}`}>
      {/* Floating Toggle Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="copilot-launcher"
          aria-label="Open Operza Copilot"
        >
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', background: 'var(--accent)', color: '#fff' }}>
            <Icon name="sparkles" size={16} />
          </div>
          <span style={{ fontWeight: 650, fontSize: 13.5 }}>Operza Copilot</span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', background: 'var(--accent-soft)', color: 'var(--accent-ink)', borderRadius: 'var(--r-pill)' }}>
            Swarm
          </span>
          {pendingApprovals.length > 0 && (
            <span
              style={{
                backgroundColor: '#ef4444',
                color: 'white',
                borderRadius: '9999px',
                padding: '2px 8px',
                fontSize: '11px',
                marginLeft: '4px'
              }}
            >
              {pendingApprovals.length}
            </span>
          )}
        </button>
      )}

      {/* Floating Chat Modal */}
      {isOpen && (
        <div
          className="copilot-panel"
          style={{
            width: isExpanded ? '680px' : '420px',
            height: isExpanded ? '720px' : '580px',
            backgroundColor: 'var(--glass-bg)',
            color: 'var(--text)',
            borderRadius: 'var(--r-2xl, 20px)',
            boxShadow: 'var(--shadow-xl)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            border: '1px solid var(--glass-border)',
            backdropFilter: 'var(--glass-blur)',
            WebkitBackdropFilter: 'var(--glass-blur)'
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '12px 18px',
              backgroundColor: 'var(--surface-2, #0f172a)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--line, rgba(255, 255, 255, 0.08))'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 'var(--r-md)', background: 'var(--accent-soft)' }}>
                <Icon name="sparkles" size={17} />
              </span>
              <div>
                <div style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--text)' }}>Operza Copilot Swarm</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'var(--green-soft)', color: 'var(--green)', borderRadius: '4px', padding: '1px 6px', fontSize: '10px', fontWeight: 650 }}>
                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--green)' }} />
                    Ollama · smollm:135m (Local)
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-3)' }}>
                    {isStreaming ? `Streaming (${activeAgentName})...` : `Agent: ${activeAgentName.toUpperCase()}`}
                  </span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-2)',
                  cursor: 'pointer',
                  padding: '5px',
                  display: 'flex',
                  alignItems: 'center',
                  borderRadius: 'var(--r-sm)'
                }}
                title={isExpanded ? 'Standard view' : 'Expand panel'}
              >
                <Icon name={isExpanded ? 'minimize' : 'maximize'} size={15} />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-2)',
                  cursor: 'pointer',
                  padding: '5px',
                  display: 'flex',
                  alignItems: 'center',
                  borderRadius: 'var(--r-sm)'
                }}
                title="Close Copilot"
              >
                <Icon name="x" size={16} />
              </button>
            </div>
          </div>

          {/* Pending Approval Banner */}
          {pendingApprovals.length > 0 && (
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                color: 'var(--red)',
                padding: '10px 14px',
                borderBottom: '1px solid var(--red-soft)',
                fontSize: '12px'
              }}
            >
              <div style={{ fontWeight: 650, marginBottom: '4px' }}>
                ⚠️ {pendingApprovals.length} Pending Human Approval(s)
              </div>
              {pendingApprovals.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: '6px'
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{p.workflowName}</span>
                  <button
                    onClick={() => handleApprove(p.id)}
                    style={{
                      backgroundColor: 'var(--green)',
                      color: 'white',
                      border: 'none',
                      borderRadius: 'var(--r-xs)',
                      padding: '3px 8px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Approve
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Messages Body */}
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              padding: '14px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.sender === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: isExpanded ? '75%' : '88%'
                }}
              >
                {m.handoff && (
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--accent-ink)',
                      backgroundColor: 'var(--accent-soft)',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      marginBottom: '4px',
                      borderLeft: '3px solid var(--accent)'
                    }}
                  >
                    ⚡ Switched to {m.handoff.to} ({m.handoff.reason})
                  </div>
                )}
                {m.agent && m.sender === 'assistant' && (
                  <div
                    style={{
                      fontSize: '10px',
                      color: 'var(--accent)',
                      fontWeight: 650,
                      marginBottom: '3px',
                      textTransform: 'uppercase',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    <Icon name="sparkles" size={11} /> {m.agent.replace('_', ' ')}
                  </div>
                )}
                <div
                  style={{
                    backgroundColor: m.sender === 'user' ? 'var(--accent)' : 'var(--surface-2, #1e293b)',
                    color: m.sender === 'user' ? '#ffffff' : 'var(--text)',
                    padding: '10px 14px',
                    borderRadius: 'var(--r-lg, 12px)',
                    fontSize: '13px',
                    lineHeight: '1.5',
                    border: '1px solid var(--line, rgba(255, 255, 255, 0.08))',
                    boxShadow: 'var(--shadow-xs)'
                  }}
                >
                  {m.text ? (
                    <span style={{ whiteSpace: 'pre-wrap' }}>{m.text}</span>
                  ) : isStreaming ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-3)' }}>
                      <span style={{ animation: 'pulse 1.2s infinite' }}>Analyzing intent & routing swarm...</span>
                    </span>
                  ) : null}

                  {/* Inline Human-in-the-Loop Proposal Card */}
                  {m.proposal && (
                    <div
                      style={{
                        marginTop: '8px',
                        padding: '10px 12px',
                        backgroundColor: 'var(--surface, #0f172a)',
                        borderRadius: 'var(--r-md, 8px)',
                        border: '1px solid var(--accent, #4f46e5)'
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: '4px'
                        }}
                      >
                        <span style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 650, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Icon name="shield" size={12} /> Proposal: {m.proposal.toolName}
                        </span>
                        <span
                          style={{
                            fontSize: '10px',
                            backgroundColor: m.proposal.status === 'approved' ? 'var(--green-soft)' : 'var(--surface-3)',
                            color: m.proposal.status === 'approved' ? 'var(--green)' : 'var(--text-2)',
                            padding: '2px 6px',
                            borderRadius: 'var(--r-pill)',
                            fontWeight: 650
                          }}
                        >
                          {m.proposal.status === 'approved' ? 'Approved' : m.proposal.status === 'rejected' ? 'Rejected' : 'Pending Approval'}
                        </span>
                      </div>

                      {m.proposal.params && (
                        <pre
                          style={{
                            margin: '6px 0',
                            padding: '6px 8px',
                            background: 'var(--bg)',
                            borderRadius: '4px',
                            fontSize: '11px',
                            maxHeight: '110px',
                            overflowY: 'auto',
                            color: 'var(--text)',
                            whiteSpace: 'pre-wrap',
                            fontFamily: 'var(--font-mono)'
                          }}
                        >
                          {JSON.stringify(m.proposal.params, null, 2)}
                        </pre>
                      )}

                      {(!m.proposal.status || m.proposal.status === 'pending') && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                          <button
                            type="button"
                            onClick={() => handleInlineApprove(m.proposal!.id)}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              backgroundColor: 'var(--green)',
                              color: 'white',
                              border: 'none',
                              borderRadius: 'var(--r-xs)',
                              padding: '4px 10px',
                              fontSize: '11px',
                              fontWeight: 650,
                              cursor: 'pointer'
                            }}
                          >
                            <Icon name="check" size={12} /> Approve Action
                          </button>
                          <button
                            type="button"
                            onClick={() => handleInlineReject(m.proposal!.id)}
                            style={{
                              backgroundColor: 'transparent',
                              color: 'var(--text-3)',
                              border: '1px solid var(--line)',
                              borderRadius: 'var(--r-xs)',
                              padding: '4px 8px',
                              fontSize: '11px',
                              cursor: 'pointer'
                            }}
                          >
                            Dismiss
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    fontSize: '10px',
                    color: 'var(--text-3)',
                    marginTop: '2px',
                    textAlign: m.sender === 'user' ? 'right' : 'left'
                  }}
                >
                  {m.timestamp}
                </div>
              </div>
            ))}
          </div>

          {/* Polyglot & Quick Action Suggestion Pills */}
          <div
            style={{
              padding: '7px 12px',
              backgroundColor: 'var(--surface-2, #0f172a)',
              borderTop: '1px solid var(--line, rgba(255, 255, 255, 0.05))',
              display: 'flex',
              gap: '6px',
              overflowX: 'auto',
              whiteSpace: 'nowrap'
            }}
          >
            {[
              { label: '📊 Deal Velocity', query: 'Summarize CRM pipeline opportunities and stages' },
              { label: '⚡ Lead Workflow', query: 'Generate workflow for qualifying high-scoring leads' },
              { label: '🔍 Find Contacts', query: 'Search contacts with active enterprise tags' },
              { label: '🇪🇸 ¿Cómo creo contacto?', query: '¿Cómo puedo agregar un contacto en Operza?' },
              { label: '🇫🇷 Créer automatisation', query: 'Comment créer une automatisation dans Operza?' },
              { label: '🇩🇪 Telefonsystem Hilfe', query: 'Wie konfiguriere ich das Telefonsystem in Operza?' }
            ].map((pill) => (
              <button
                key={pill.label}
                type="button"
                onClick={() => setInput(pill.query)}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-pill)',
                  color: 'var(--text-2)',
                  fontSize: '11px',
                  padding: '3px 9px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  fontWeight: 550
                }}
              >
                {pill.label}
              </button>
            ))}
          </div>

          {/* Input Bar */}
          <div
            style={{
              padding: '12px',
              backgroundColor: 'var(--surface-2, #0f172a)',
              borderTop: '1px solid var(--line, rgba(255, 255, 255, 0.08))',
              display: 'flex',
              gap: '8px'
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask Copilot in any language or type a command..."
              style={{
                flex: 1,
                backgroundColor: 'var(--surface)',
                color: 'var(--text)',
                border: '1px solid var(--line-strong)',
                borderRadius: 'var(--r-md, 8px)',
                padding: '8px 12px',
                fontSize: '13px',
                outline: 'none'
              }}
            />
            <button
              onClick={handleSend}
              disabled={isStreaming || !input.trim()}
              style={{
                backgroundColor: 'var(--accent)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 'var(--r-md, 8px)',
                padding: '8px 16px',
                cursor: isStreaming || !input.trim() ? 'not-allowed' : 'pointer',
                fontWeight: 650,
                opacity: isStreaming || !input.trim() ? 0.6 : 1
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

