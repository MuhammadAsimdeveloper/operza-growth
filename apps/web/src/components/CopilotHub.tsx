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
      text: 'Welcome to Operza Copilot Swarm. Our autonomous agents (Supervisor, CRM, Automation & Support) can query contacts, qualify leads, generate visual workflows, and manage operations.',
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
  }, [messages, isOpen]);

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
      text: 'Analyzing intent...',
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
                            status: event.status,
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
    <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999 }}>
      {/* Floating Toggle Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#4f46e5',
            color: '#ffffff',
            padding: '12px 18px',
            borderRadius: '9999px',
            boxShadow: '0 10px 25px -5px rgba(79, 70, 229, 0.4)',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '14px'
          }}
        >
          <Icon name="sparkles" size={18} />
          <span>Operza Copilot</span>
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
          style={{
            width: '380px',
            height: '520px',
            backgroundColor: '#1e293b',
            color: '#f8fafc',
            borderRadius: '16px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '14px 18px',
              backgroundColor: '#0f172a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#818cf8' }}>
                <Icon name="sparkles" size={18} />
              </span>
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>Operza Copilot Swarm</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', borderRadius: '4px', padding: '1px 6px', fontSize: '10px', fontWeight: 600 }}>
                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#10b981' }} />
                    Ollama · smollm:135m (Local)
                  </span>
                  <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                    {isStreaming ? `Streaming (${activeAgentName})...` : `Agent: ${activeAgentName.toUpperCase()}`}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '18px'
              }}
            >
              ✕
            </button>
          </div>

          {/* Pending Approval Banner */}
          {pendingApprovals.length > 0 && (
            <div
              style={{
                backgroundColor: '#7f1d1d',
                padding: '10px 14px',
                borderBottom: '1px solid #b91c1c',
                fontSize: '12px'
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>
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
                  <span>{p.workflowName}</span>
                  <button
                    onClick={() => handleApprove(p.id)}
                    style={{
                      backgroundColor: '#22c55e',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '3px 8px',
                      fontSize: '11px',
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
                  maxWidth: '85%'
                }}
              >
                {m.handoff && (
                  <div
                    style={{
                      fontSize: '11px',
                      color: '#a5b4fc',
                      backgroundColor: 'rgba(99, 102, 241, 0.15)',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      marginBottom: '4px',
                      borderLeft: '3px solid #6366f1'
                    }}
                  >
                    ⚡ Switched to {m.handoff.to} ({m.handoff.reason})
                  </div>
                )}
                {m.agent && m.sender === 'assistant' && (
                  <div
                    style={{
                      fontSize: '10px',
                      color: '#818cf8',
                      fontWeight: 600,
                      marginBottom: '2px',
                      textTransform: 'uppercase'
                    }}
                  >
                    {m.agent.replace('_', ' ')}
                  </div>
                )}
                <div
                  style={{
                    backgroundColor: m.sender === 'user' ? '#4f46e5' : '#334155',
                    color: '#ffffff',
                    padding: '10px 14px',
                    borderRadius: '12px',
                    fontSize: '13px',
                    lineHeight: '1.4'
                  }}
                >
                  {m.text || (isStreaming ? 'Thinking...' : '')}
                  {m.proposal && (
                    <div
                      style={{
                        marginTop: '8px',
                        padding: '8px 10px',
                        backgroundColor: '#0f172a',
                        borderRadius: '8px',
                        border: '1px solid #4f46e5'
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: '2px'
                        }}
                      >
                        <span style={{ fontSize: '11px', color: '#a5b4fc', fontWeight: 600 }}>
                          Proposal: {m.proposal.toolName}
                        </span>
                        <span
                          style={{
                            fontSize: '10px',
                            backgroundColor: '#334155',
                            padding: '2px 5px',
                            borderRadius: '4px',
                            color: '#cbd5e1'
                          }}
                        >
                          Pending Review
                        </span>
                      </div>
                      <a
                        href="/copilot-inbox"
                        style={{
                          display: 'inline-block',
                          fontSize: '11px',
                          color: '#38bdf8',
                          textDecoration: 'none',
                          fontWeight: 500,
                          marginTop: '2px'
                        }}
                      >
                        Review in Copilot Inbox →
                      </a>
                    </div>
                  )}
                </div>
                <div
                  style={{
                    fontSize: '10px',
                    color: '#64748b',
                    marginTop: '2px',
                    textAlign: m.sender === 'user' ? 'right' : 'left'
                  }}
                >
                  {m.timestamp}
                </div>
              </div>
            ))}
          </div>

          {/* Prompt Suggestions */}
          <div
            style={{
              padding: '6px 12px',
              backgroundColor: '#0f172a',
              borderTop: '1px solid rgba(255, 255, 255, 0.05)',
              display: 'flex',
              gap: '6px',
              overflowX: 'auto',
              whiteSpace: 'nowrap'
            }}
          >
            {[
              { label: '📊 Pipeline Deals', query: 'Summarize CRM pipeline opportunities and stages' },
              { label: '⚡ Lead Workflow', query: 'Generate workflow for qualifying high-scoring leads' },
              { label: '🔍 Find Contacts', query: 'Search contacts with active enterprise tags' },
              { label: '📋 Approvals', query: 'List all workflow runs awaiting human approval' }
            ].map(pill => (
              <button
                key={pill.label}
                type="button"
                onClick={() => setInput(pill.query)}
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '6px',
                  color: '#cbd5e1',
                  fontSize: '11px',
                  padding: '3px 8px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
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
              backgroundColor: '#0f172a',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              gap: '8px'
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask Copilot or type a command..."
              style={{
                flex: 1,
                backgroundColor: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #475569',
                borderRadius: '8px',
                padding: '8px 12px',
                fontSize: '13px',
                outline: 'none'
              }}
            />
            <button
              onClick={handleSend}
              disabled={isStreaming || !input.trim()}
              style={{
                backgroundColor: '#4f46e5',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '8px 14px',
                cursor: isStreaming || !input.trim() ? 'not-allowed' : 'pointer',
                fontWeight: 600
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

