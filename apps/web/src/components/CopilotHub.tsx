import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { MissMinutesRobo } from './MissMinutesRobo';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export function CopilotHub() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: "Hey y'all! I'm Miss Minutes, your Operza Autonomous Copilot. I manage your agency timeline: searching contacts, tracking pipeline revenue, booking meetings, checking integrations, and triggering workflows. What can I do for you today?",
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

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    const userMsg = input.trim();
    setInput('');
    await sendMsg(userMsg);
  };

  const handleSendWithPrompt = async (promptText: string) => {
    if (!promptText.trim() || isStreaming) return;
    setInput('');
    await sendMsg(promptText.trim());
  };

  const sendMsg = async (userMsg: string) => {
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
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, userMessageObj, assistantMessageObj]);
    setIsStreaming(true);

    try {
      const res = await api.copilot.chat({ message: userMsg });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessageId
            ? { ...m, text: res.message?.content || 'Action completed.' }
            : m
        )
      );
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
      {/* Floating Toggle: TVA Miss Minutes Animated Mascot */}
      {!isOpen && (
        <MissMinutesRobo
          onClick={() => setIsOpen(true)}
          pendingCount={pendingApprovals.length}
          isStreaming={isStreaming}
        />
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
          {/* Header with Miss Minutes TVA Aesthetic */}
          <div
            style={{
              padding: '14px 18px',
              backgroundColor: '#0F172A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1.5px solid rgba(245, 158, 11, 0.25)',
              background: 'linear-gradient(180deg, #181E2E 0%, #0F172A 100%)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, #FFA028 0%, #E65100 100%)',
                  border: '1.5px solid #F59E0B',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '18px',
                  boxShadow: '0 0 10px rgba(245, 158, 11, 0.4)'
                }}
              >
                ⏰
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#FEF3C7', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>Miss Minutes</span>
                  <span style={{ fontSize: '10px', background: 'rgba(245, 158, 11, 0.2)', color: '#F59E0B', padding: '1px 6px', borderRadius: '4px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                    TVA AI
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                  {isStreaming ? 'Managing timeline...' : 'Operza Autonomous Copilot Ready'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                onClick={() => {
                  setIsOpen(false);
                  navigate('/copilot');
                }}
                style={{
                  background: 'rgba(245, 158, 11, 0.15)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  color: '#FEF3C7',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '3px 7px',
                  borderRadius: '5px'
                }}
                title="Open Full AI Workspace"
              >
                ⤢ Full Workspace
              </button>
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94A3B8',
                  cursor: 'pointer',
                  fontSize: '18px',
                  padding: '4px 6px',
                  borderRadius: '6px'
                }}
                title="Close Copilot"
              >
                ✕
              </button>
            </div>
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

          {/* Quick Action Chips */}
          <div
            style={{
              padding: '6px 12px',
              backgroundColor: '#0f172a',
              display: 'flex',
              gap: '6px',
              overflowX: 'auto',
              borderTop: '1px solid rgba(255, 255, 255, 0.05)'
            }}
          >
            {[
              '📊 Pipeline summary',
              '⚡ List workflows',
              '👥 Search contacts',
              '➕ Add lead Alex Hunter with alex@apex.io',
              '🚀 Trigger Inbound Lead Automation',
              '📅 Check calendar availability',
              '🔌 Integrations health',
              '📈 Agency metrics'
            ].map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => handleSendWithPrompt(chip.replace(/^[\p{Emoji}\s]+/u, ''))}
                disabled={isStreaming}
                style={{
                  background: 'rgba(245, 158, 11, 0.08)',
                  border: '1px solid rgba(245, 158, 11, 0.22)',
                  borderRadius: '12px',
                  color: '#FEF3C7',
                  padding: '4px 10px',
                  fontSize: '11px',
                  whiteSpace: 'nowrap',
                  cursor: isStreaming ? 'not-allowed' : 'pointer',
                  fontWeight: 500,
                  transition: 'all 0.15s ease'
                }}
              >
                {chip}
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

