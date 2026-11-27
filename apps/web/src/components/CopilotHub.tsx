import React, { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { Icon } from './Icon';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  agent?: string;
  handoff?: { from: string; to: string; reason?: string };
  proposal?: { id: string; toolName: string; status: string; params: any };
  sources?: Array<{ title?: string; docTitle?: string; chunkId?: string; score?: number }>;
  timestamp: string;
}

function isRtlText(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

function getActiveModuleName(pathname: string): { label: string; path: string } {
  if (pathname.startsWith('/websites')) return { label: 'Hosted Websites & CMS', path: '/websites' };
  if (pathname.startsWith('/funnels')) return { label: 'Funnels & Checkouts', path: '/funnels' };
  if (pathname.startsWith('/workflows')) return { label: 'Visual Workflows', path: '/workflows' };
  if (pathname.startsWith('/contacts')) return { label: 'Contacts & CRM', path: '/contacts' };
  if (pathname.startsWith('/conversations')) return { label: 'Conversations & Inboxes', path: '/conversations' };
  if (pathname.startsWith('/phone')) return { label: 'WebRTC Telephony & Softphone', path: '/phone' };
  if (pathname.startsWith('/calendars')) return { label: 'Calendar & Booking Sync', path: '/calendars' };
  if (pathname.startsWith('/opportunities')) return { label: 'Deals & Pipeline', path: '/opportunities' };
  if (pathname.startsWith('/payments') || pathname.startsWith('/store') || pathname.startsWith('/products')) return { label: 'Commerce & Invoicing', path: '/payments' };
  if (pathname.startsWith('/reporting')) return { label: 'Analytics & KPIs', path: '/reporting' };
  if (pathname.startsWith('/ai-trainer')) return { label: 'AI Copilot Training & Knowledge', path: '/ai-trainer' };
  if (pathname.startsWith('/integrations')) return { label: 'App Marketplace & Connectors', path: '/integrations' };
  if (pathname.startsWith('/developers')) return { label: 'Developer Hub & API Keys', path: '/developers' };
  return { label: 'Workspace Overview', path: '/' };
}

function renderInlineMarkdown(str: string): React.ReactNode[] {
  const regex = /(\*\*.*?\*\*|`.*?`|\[.*?\]\(.*?\))/g;
  const tokens = str.split(regex);

  return tokens.map((token, i) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return (
        <strong key={i} style={{ color: 'var(--text, #ffffff)', fontWeight: 700 }}>
          {token.slice(2, -2)}
        </strong>
      );
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      return (
        <code
          key={i}
          style={{
            backgroundColor: 'var(--surface-3, rgba(255,255,255,0.08))',
            color: 'var(--accent-ink, #c7d2fe)',
            padding: '1px 5px',
            borderRadius: 4,
            fontSize: '0.9em',
            fontFamily: 'var(--font-mono, monospace)'
          }}
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    const linkMatch = token.match(/^\[(.*?)\]\((.*?)\)$/);
    if (linkMatch) {
      const [, text, href] = linkMatch;
      return (
        <a
          key={i}
          href={href}
          style={{
            color: 'var(--accent, #6366f1)',
            textDecoration: 'underline',
            fontWeight: 600
          }}
          onClick={(e) => {
            if (href.startsWith('/')) {
              e.preventDefault();
              window.location.href = href;
            }
          }}
        >
          {text}
        </a>
      );
    }
    return token;
  });
}

function MarkdownContent({ text, isRtl }: { text: string; isRtl: boolean }) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = (code: string, idx: number) => {
    navigator.clipboard.writeText(code);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const parts = text.split(/(```[\s\S]*?```)/g);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {parts.map((part, idx) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const lines = part.slice(3, -3).trim().split('\n');
          const firstLine = lines[0].trim();
          const hasLang = /^[a-zA-Z0-9_-]+$/.test(firstLine);
          const lang = hasLang ? firstLine : 'code';
          const code = (hasLang ? lines.slice(1) : lines).join('\n');

          return (
            <div
              key={idx}
              style={{
                borderRadius: 'var(--r-md, 8px)',
                overflow: 'hidden',
                backgroundColor: 'var(--bg, #0b0f19)',
                border: '1px solid var(--line, rgba(255,255,255,0.08))',
                margin: '6px 0',
                fontFamily: 'var(--font-mono, monospace)',
                direction: 'ltr',
                textAlign: 'left'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '4px 10px',
                  backgroundColor: 'var(--surface, #111827)',
                  borderBottom: '1px solid var(--line, rgba(255,255,255,0.05))',
                  fontSize: 10,
                  color: 'var(--text-3, #94a3b8)'
                }}
              >
                <span style={{ textTransform: 'uppercase', fontWeight: 650 }}>{lang}</span>
                <button
                  type="button"
                  onClick={() => handleCopy(code, idx)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: copiedIndex === idx ? 'var(--green, #10b981)' : 'var(--text-2, #cbd5e1)',
                    cursor: 'pointer',
                    fontSize: 11,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 6px',
                    borderRadius: 4
                  }}
                >
                  <Icon name={copiedIndex === idx ? 'check' : 'copy'} size={12} />
                  <span>{copiedIndex === idx ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: '10px 12px',
                  overflowX: 'auto',
                  fontSize: '12px',
                  lineHeight: '1.45',
                  color: 'var(--text, #f1f5f9)',
                  whiteSpace: 'pre'
                }}
              >
                <code>{code}</code>
              </pre>
            </div>
          );
        }

        const paragraphs = part.split(/\n\n+/);
        return (
          <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {paragraphs.map((p, pIdx) => {
              const lines = p.split('\n');
              return (
                <div key={pIdx} style={{ lineHeight: 1.55 }}>
                  {lines.map((line, lIdx) => {
                    const isBullet = /^[-*•]\s+/.test(line);
                    const isNumbered = /^\d+\.\s+/.test(line);
                    const cleanLine = line.replace(/^[-*•]\s+|\d+\.\s+/, '');
                    const rendered = renderInlineMarkdown(cleanLine);

                    if (isBullet) {
                      return (
                        <div
                          key={lIdx}
                          style={{
                            display: 'flex',
                            gap: 6,
                            margin: '2px 0',
                            paddingLeft: isRtl ? 0 : 8,
                            paddingRight: isRtl ? 8 : 0
                          }}
                        >
                          <span style={{ color: 'var(--accent)', fontWeight: 700 }}>•</span>
                          <span style={{ flex: 1 }}>{rendered}</span>
                        </div>
                      );
                    }
                    if (isNumbered) {
                      const num = line.match(/^(\d+)\./)?.[1] || `${lIdx + 1}`;
                      return (
                        <div
                          key={lIdx}
                          style={{
                            display: 'flex',
                            gap: 6,
                            margin: '2px 0',
                            paddingLeft: isRtl ? 0 : 8,
                            paddingRight: isRtl ? 8 : 0
                          }}
                        >
                          <span style={{ color: 'var(--accent)', fontWeight: 650, minWidth: 16 }}>{num}.</span>
                          <span style={{ flex: 1 }}>{rendered}</span>
                        </div>
                      );
                    }
                    return (
                      <div key={lIdx} style={{ margin: line ? '2px 0' : '4px 0' }}>
                        {rendered}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function CopilotHub() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [sessionId, setSessionId] = useState<string>(() => {
    return localStorage.getItem('operza_copilot_session_id') || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  });

  useEffect(() => {
    localStorage.setItem('operza_copilot_session_id', sessionId);
  }, [sessionId]);

  const [activeModule, setActiveModule] = useState<{ label: string; path: string }>({
    label: 'Workspace Overview',
    path: '/'
  });

  useEffect(() => {
    const updateActiveModule = () => {
      if (typeof window !== 'undefined') {
        setActiveModule(getActiveModuleName(window.location.pathname));
      }
    };
    updateActiveModule();
    window.addEventListener('popstate', updateActiveModule);
    return () => window.removeEventListener('popstate', updateActiveModule);
  }, []);

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
      text: 'Welcome to **Operza Copilot 2.0**. I am your multilingual AI Business Assistant and product strategist. Ask questions, optimize conversion funnels, design n8n-style visual workflows, or analyze your CRM pipeline in any language (including Roman Urdu).',
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
    const checkApprovals = async () => {
      try {
        const runs = await api.workflows.getRuns();
        const waiting = runs.filter((r: any) => r.status === 'waiting_approval');
        setPendingApprovals(waiting);
      } catch {
        // Safe offline fallback
      }
    };
    checkApprovals();
    const interval = setInterval(checkApprovals, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleNewConversation = () => {
    const newSessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setSessionId(newSessionId);
    localStorage.setItem('operza_copilot_session_id', newSessionId);
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        sender: 'assistant',
        text: `Started a fresh conversation session. Active workspace context: **${activeModule.label}** (\`${activeModule.path}\`). How can I help you grow today?`,
        agent: 'supervisor',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ]);
  };

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
          text: `✅ Action proposal \`${proposalId.slice(0, 12)}\` approved by human reviewer. Execution logged.`,
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
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';
      const response = await fetch('/api/copilot/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        credentials: 'include',
        body: JSON.stringify({
          message: userMsg,
          sessionId,
          activeModule: `${activeModule.label} (${currentPath})`,
          mode: 'copilot'
        })
      });

      if (!response.ok || !response.body) {
        // Fallback to chat endpoint
        const res = await api.copilot.chat({
          message: userMsg,
          sessionId,
          activeModule: `${activeModule.label} (${currentPath})`
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? {
                  ...m,
                  text: res.message?.content || 'Action completed.',
                  sources: res.message?.sources || [],
                  proposal: res.message?.proposals?.[0]
                }
              : m
          )
        );
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';
      let currentAgent = activeAgentName;
      let streamSources: any[] = [];

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
              } else if (event.type === 'rag_retrieval' || event.sources) {
                streamSources = event.sources || [];
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId
                      ? { ...m, sources: streamSources }
                      : m
                  )
                );
              }
            } catch {
              // Non-JSON or SSE comment frame
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
          text: `✅ Approved workflow step for execution \`${runId.slice(0, 8)}\`. Step execution resumed.`,
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
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'var(--accent)',
              color: '#fff'
            }}
          >
            <Icon name="sparkles" size={16} />
          </div>
          <span className="copilot-launcher__text" style={{ fontWeight: 650, fontSize: 13.5 }}>Operza Copilot</span>
          <span
            className="copilot-launcher__badge"
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 7px',
              background: 'var(--accent-soft)',
              color: 'var(--accent-ink)',
              borderRadius: 'var(--r-pill)'
            }}
          >
            2.0 AI
          </span>
          {pendingApprovals.length > 0 && (
            <span
              style={{
                backgroundColor: 'var(--red, #ef4444)',
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
            width: isExpanded ? '720px' : '440px',
            height: isExpanded ? '740px' : '600px',
            backgroundColor: 'var(--glass-bg, #0f172a)',
            color: 'var(--text)',
            borderRadius: 'var(--r-2xl, 20px)',
            boxShadow: 'var(--shadow-xl)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            border: '1px solid var(--glass-border, rgba(255,255,255,0.12))',
            backdropFilter: 'var(--glass-blur, blur(16px))',
            WebkitBackdropFilter: 'var(--glass-blur, blur(16px))',
            zIndex: 1000
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
              <span
                style={{
                  color: 'var(--accent)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--r-md)',
                  background: 'var(--accent-soft)'
                }}
              >
                <Icon name="sparkles" size={18} />
              </span>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text)' }}>
                    Operza Copilot 2.0
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      background: 'var(--accent-soft)',
                      color: 'var(--accent-ink)',
                      borderRadius: 'var(--r-pill)',
                      padding: '1px 6px'
                    }}
                  >
                    Polyglot RAG
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: 'var(--green-soft)',
                      color: 'var(--green)',
                      borderRadius: '4px',
                      padding: '1px 6px',
                      fontSize: '10px',
                      fontWeight: 650
                    }}
                  >
                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--green)' }} />
                    Active: {activeModule.label}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-3)' }}>
                    {isStreaming ? `Generating response...` : `Swarm Agent: ${activeAgentName.toUpperCase()}`}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                type="button"
                onClick={handleNewConversation}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-2)',
                  cursor: 'pointer',
                  padding: '5px 7px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  borderRadius: 'var(--r-sm)',
                  fontSize: 11
                }}
                title="Start a new conversation"
              >
                <Icon name="plus" size={14} />
                <span style={{ fontSize: 11 }}>New</span>
              </button>
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
            {messages.map((m) => {
              const isRtl = isRtlText(m.text);

              return (
                <div
                  key={m.id}
                  style={{
                    alignSelf: m.sender === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: isExpanded ? '80%' : '90%',
                    width: 'fit-content'
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
                    dir={isRtl ? 'rtl' : 'ltr'}
                    style={{
                      backgroundColor: m.sender === 'user' ? 'var(--accent)' : 'var(--surface-2, #1e293b)',
                      color: m.sender === 'user' ? '#ffffff' : 'var(--text)',
                      padding: '10px 14px',
                      borderRadius: 'var(--r-lg, 12px)',
                      fontSize: '13px',
                      lineHeight: '1.55',
                      border: '1px solid var(--line, rgba(255, 255, 255, 0.08))',
                      boxShadow: 'var(--shadow-xs)',
                      textAlign: isRtl ? 'right' : 'left'
                    }}
                  >
                    {m.text ? (
                      <MarkdownContent text={m.text} isRtl={isRtl} />
                    ) : isStreaming ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-3)' }}>
                        <span style={{ animation: 'pulse 1.2s infinite' }}>Analyzing context & formulating response...</span>
                      </span>
                    ) : null}

                    {/* Source Citations */}
                    {m.sources && m.sources.length > 0 && (
                      <div
                        style={{
                          marginTop: '8px',
                          paddingTop: '6px',
                          borderTop: '1px solid var(--line, rgba(255, 255, 255, 0.06))',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 5
                        }}
                      >
                        <span style={{ fontSize: 10, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Icon name="shield" size={10} /> Cited Knowledge:
                        </span>
                        {m.sources.map((src, sIdx) => (
                          <span
                            key={sIdx}
                            style={{
                              fontSize: 10,
                              background: 'var(--surface, #1e293b)',
                              border: '1px solid var(--line)',
                              color: 'var(--accent-ink)',
                              padding: '1px 6px',
                              borderRadius: 'var(--r-pill)'
                            }}
                          >
                            📄 {src.title || src.docTitle || 'Doc'}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Inline Human-in-the-Loop Proposal Card */}
                    {m.proposal && (
                      <div
                        style={{
                          marginTop: '10px',
                          padding: '10px 12px',
                          backgroundColor: 'var(--surface, #0f172a)',
                          borderRadius: 'var(--r-md, 8px)',
                          border: '1px solid var(--accent, #4f46e5)',
                          direction: 'ltr',
                          textAlign: 'left'
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
                          <span
                            style={{
                              fontSize: '11px',
                              color: 'var(--accent)',
                              fontWeight: 650,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4
                            }}
                          >
                            <Icon name="shield" size={12} /> Action Proposal: {m.proposal.toolName}
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
                            {m.proposal.status === 'approved'
                              ? 'Approved'
                              : m.proposal.status === 'rejected'
                              ? 'Rejected'
                              : 'Pending Human Review'}
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

                        {(!m.proposal.status || m.proposal.status === 'pending' || m.proposal.status === 'pending_review') && (
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
              );
            })}
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
              { label: '🇵🇰 Mera business grow nahi ho raha', query: 'Mera business grow nahi ho raha, kya karun?' },
              { label: '💡 Lead Qualification Flow', query: 'Generate workflow for Inbound High-Ticket Lead Qualification with Zapier notification' },
              { label: '📊 Deal Velocity', query: 'Summarize CRM pipeline opportunities and stages' },
              { label: '🔍 Find Contacts', query: 'Search contacts with active enterprise tags' },
              { label: '🇪🇸 ¿Cómo creo contacto?', query: '¿Cómo puedo agregar un contacto en el CRM de Operza?' },
              { label: '🇫🇷 Créer automatisation', query: 'Comment créer une automatisation visuelle dans Operza?' },
              { label: '🇩🇪 Wie erstelle ich Workflow?', query: 'Wie erstelle ich einen Workflow in Operza?' }
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
              placeholder="Ask Copilot in any language (English, Roman Urdu, Español, Français, Deutsch)..."
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
