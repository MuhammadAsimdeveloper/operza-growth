import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { Icon } from './Icon';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export function CopilotHub() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Welcome to Operza Copilot. I can query your contacts, analyze pipelines, summarize inbound leads, and trigger background automations.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
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

  const handleSend = () => {
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
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, userMessageObj, assistantMessageObj]);
    setIsStreaming(true);

    api.copilot.stream(
      userMsg,
      (delta) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId ? { ...m, text: m.text + delta } : m
          )
        );
      },
      () => {
        setIsStreaming(false);
      }
    );
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
                <div style={{ fontWeight: 600, fontSize: '14px' }}>Operza Copilot Hub</div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  {isStreaming ? 'Streaming response...' : 'Autonomous Assistant Ready'}
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

