import { useEffect, useState, useRef, useMemo } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, StatusBadge } from '../components/ui';
import { api } from '../lib/api';

interface Conversation {
  id: string;
  title: string;
  agentId: string;
  model: string;
  pinned: boolean;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  messages?: Message[];
}

interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: any[];
  toolResults?: any[];
  approvalRequired?: {
    toolCallId: string;
    toolId: string;
    toolName: string;
    parameters: any;
    explanation: string;
  } | null;
  approvalStatus?: 'pending' | 'approved' | 'rejected' | null;
  citations?: Array<{ docTitle: string; chunkId: string; excerpt: string }>;
  tokens?: any;
  feedback?: { rating: 'positive' | 'negative'; note?: string };
  timestamp: string;
}

interface Agent {
  id: string;
  name: string;
  subtitle: string;
  icon: string;
  avatarTone: string;
  model: string;
  systemPrompt: string;
  allowedCategories: string[];
  suggestedPrompts: string[];
}

export default function Copilot() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('general_business');
  const [selectedModel, setSelectedModel] = useState('gpt-4o');
  const [models, setModels] = useState<any[]>([]);

  // Messages & Streaming
  const [inputMessage, setInputMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingDelta, setStreamingDelta] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // UI Panels
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');

  // Memory & Knowledge state
  const [memories, setMemories] = useState<any[]>([]);
  const [newMemoryKey, setNewMemoryKey] = useState('');
  const [newMemoryVal, setNewMemoryVal] = useState('');
  const [knowledgeDocs, setKnowledgeDocs] = useState<any[]>([]);
  const [usage, setUsage] = useState<any>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 1. Initial Load: Models, Agents, Conversations, Knowledge, Usage
  useEffect(() => {
    let active = true;

    Promise.all([
      api.copilot.models().catch(() => ({ models: [] })),
      api.copilot.agents().catch(() => ({ agents: [] })),
      api.copilot.listConversations().catch(() => ({ conversations: [] })),
      api.copilot.getUsage().catch(() => ({ usage: null })),
      api.aiTrainer.getKnowledge().catch(() => ({ documents: [] }))
    ]).then(([modelsRes, agentsRes, convsRes, usageRes, docsRes]) => {
      if (!active) return;
      if (modelsRes?.models) setModels(modelsRes.models);
      if (agentsRes?.agents) setAgents(agentsRes.agents);
      if (usageRes?.usage) setUsage(usageRes.usage);
      if (docsRes?.documents) setKnowledgeDocs(docsRes.documents);

      const convList = convsRes?.conversations || [];
      setConversations(convList);

      if (convList.length > 0) {
        selectConversation(convList[0].id);
      } else {
        createNewConversation();
      }
    });

    return () => { active = false; };
  }, []);

  // Scroll to bottom when messages update
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeConv?.messages, streamingDelta, isGenerating]);

  // Load Single Conversation
  const selectConversation = async (id: string) => {
    try {
      const res = await api.copilot.getConversation(id);
      if (res?.conversation) {
        setActiveConvId(id);
        setActiveConv(res.conversation);
        setSelectedAgentId(res.conversation.agentId || 'general_business');
        setSelectedModel(res.conversation.model || 'gpt-4o');
        setTitleInput(res.conversation.title);
      }
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
  };

  // Create New Conversation
  const createNewConversation = async (agentId = selectedAgentId) => {
    try {
      const res = await api.copilot.createConversation({
        title: 'New Business Conversation',
        agentId,
        model: selectedModel
      });
      if (res?.conversation) {
        setConversations(prev => [res.conversation, ...prev]);
        setActiveConvId(res.conversation.id);
        setActiveConv({ ...res.conversation, messages: [] });
        setTitleInput(res.conversation.title);
      }
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  };

  // Update Conversation Title or Pin
  const handleUpdateConversation = async (patch: Partial<Conversation>) => {
    if (!activeConvId) return;
    try {
      const res = await api.copilot.updateConversation(activeConvId, patch);
      if (res?.conversation) {
        setActiveConv(prev => prev ? { ...prev, ...patch } : null);
        setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, ...patch } : c));
      }
    } catch (err) {
      console.error('Failed to update conversation:', err);
    }
  };

  // Delete Conversation
  const handleDeleteConversation = async (id: string) => {
    if (!confirm('Are you sure you want to delete this conversation?')) return;
    try {
      await api.copilot.deleteConversation(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (activeConvId === id) {
        const remaining = conversations.filter(c => c.id !== id);
        if (remaining.length > 0) {
          selectConversation(remaining[0].id);
        } else {
          createNewConversation();
        }
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  // Send Message
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputMessage).trim();
    if (!text || !activeConvId || isGenerating) return;

    setInputMessage('');
    setIsGenerating(true);
    setStreamingDelta('');

    // Optimistic user message append
    const tempUserMsg: Message = {
      id: `temp_${Date.now()}`,
      conversationId: activeConvId,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    };

    setActiveConv(prev => prev ? { ...prev, messages: [...(prev.messages || []), tempUserMsg] } : null);

    try {
      const res = await api.copilot.sendMessage(activeConvId, {
        message: text,
        agentId: selectedAgentId,
        model: selectedModel
      });

      if (res?.message) {
        setActiveConv(prev => {
          if (!prev) return null;
          // Replace temp with verified messages
          const filtered = (prev.messages || []).filter(m => m.id !== tempUserMsg.id);
          return {
            ...prev,
            messages: [...filtered, tempUserMsg, res.message]
          };
        });

        // Refresh usage stats
        api.copilot.getUsage().then(u => { if (u?.usage) setUsage(u.usage); }).catch(() => {});
        // Refresh conversations list to update titles/timestamps
        api.copilot.listConversations().then(c => { if (c?.conversations) setConversations(c.conversations); }).catch(() => {});
      }
    } catch (err: any) {
      setActiveConv(prev => {
        if (!prev) return null;
        return {
          ...prev,
          messages: [
            ...(prev.messages || []),
            {
              id: `err_${Date.now()}`,
              conversationId: activeConvId,
              role: 'assistant',
              content: `⚠️ Request failed: ${err.message}`,
              timestamp: new Date().toISOString()
            }
          ]
        };
      });
    } finally {
      setIsGenerating(false);
      setStreamingDelta('');
      if (textareaRef.current) textareaRef.current.focus();
    }
  };

  // Sensitive Action Approval Execution
  const handleApproveAction = async (messageId: string, approved: boolean) => {
    if (!activeConvId) return;
    try {
      const res = await api.copilot.approveAction(activeConvId, { messageId, approved });
      if (res?.message) {
        setActiveConv(prev => {
          if (!prev) return null;
          return {
            ...prev,
            messages: (prev.messages || []).map(m => m.id === messageId ? { ...m, approvalStatus: (approved ? 'approved' : 'rejected') as 'approved' | 'rejected' } : m).concat(res.message)
          };
        });
      }
    } catch (err: any) {
      alert(`Approval execution failed: ${err.message}`);
    }
  };

  // Feedback recording
  const handleFeedback = async (messageId: string, rating: 'up' | 'down') => {
    if (!activeConvId) return;
    try {
      await api.copilot.recordFeedback(activeConvId, { messageId, rating });
      setActiveConv(prev => {
        if (!prev) return null;
        return {
          ...prev,
          messages: (prev.messages || []).map(m =>
            m.id === messageId ? { ...m, feedback: { rating: rating === 'up' ? 'positive' : 'negative' } } : m
          )
        };
      });
    } catch { /* ignore */ }
  };

  // Copy Message to Clipboard
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Memory Management
  const loadMemories = async () => {
    const res = await api.copilot.getMemories();
    if (res?.memories) setMemories(res.memories);
  };

  const handleAddMemory = async () => {
    if (!newMemoryKey.trim() || !newMemoryVal.trim()) return;
    await api.copilot.addMemory({ key: newMemoryKey.trim(), content: newMemoryVal.trim() });
    setNewMemoryKey('');
    setNewMemoryVal('');
    loadMemories();
  };

  const handleDeleteMemory = async (id: string) => {
    await api.copilot.deleteMemory(id);
    loadMemories();
  };

  // Filtered Conversations for Sidebar
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(c => c.title.toLowerCase().includes(q));
  }, [conversations, searchQuery]);

  const activeAgent = useMemo(() => {
    return agents.find(a => a.id === selectedAgentId) || agents[0] || {
      id: 'general_business',
      name: 'General Business Assistant',
      subtitle: 'Autonomous Operations',
      icon: 'sparkles',
      systemPrompt: '',
      suggestedPrompts: [
        'Summarize my agency performance this month',
        'Show my highest-value deals in the pipeline',
        'Which leads need immediate follow-up?',
        'Check my calendar availability for today'
      ]
    };
  }, [agents, selectedAgentId]);

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 64px)', overflow: 'hidden', background: 'var(--surface)' }}>
      {/* ======================================================== */}
      {/* 1. LEFT SIDEBAR: Conversations, Agents, History, Search  */}
      {/* ======================================================== */}
      <aside
        style={{
          width: '280px',
          borderRight: '1px solid var(--line)',
          background: 'var(--surface-2)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0
        }}
      >
        {/* New Chat & Action Header */}
        <div style={{ padding: '16px', borderBottom: '1px solid var(--line)' }}>
          <button
            className="btn btn--primary"
            style={{ width: '100%', justifyContent: 'center', gap: '8px', padding: '10px' }}
            onClick={() => createNewConversation()}
          >
            <Icon name="plus" size={15} /> New Conversation
          </button>

          {/* Search Bar */}
          <div className="search" style={{ marginTop: '12px' }}>
            <Icon name="search" size={14} />
            <input
              className="input input--sm"
              placeholder="Search chat history..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ fontSize: '12px' }}
            />
            {searchQuery && (
              <button
                type="button"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}
                onClick={() => setSearchQuery('')}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Specialized Agents Selector */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <label style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', fontWeight: 600 }}>
            Specialized Agent
          </label>
          <select
            className="select"
            style={{ width: '100%', marginTop: '6px', fontSize: '12.5px' }}
            value={selectedAgentId}
            onChange={e => {
              const newAgentId = e.target.value;
              setSelectedAgentId(newAgentId);
              if (activeConvId) {
                handleUpdateConversation({ agentId: newAgentId });
              }
            }}
          >
            {agents.map(a => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        {/* Conversation List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {filteredConversations.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: '12px' }}>
              No conversations found
            </div>
          ) : (
            filteredConversations.map(c => {
              const isActive = c.id === activeConvId;
              return (
                <div
                  key={c.id}
                  onClick={() => selectConversation(c.id)}
                  style={{
                    padding: '9px 12px',
                    borderRadius: 'var(--r-md)',
                    marginBottom: '4px',
                    cursor: 'pointer',
                    background: isActive ? 'var(--accent-soft)' : 'transparent',
                    color: isActive ? 'var(--accent)' : 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '13px',
                    transition: 'background 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                    <Icon name={c.pinned ? 'star' : 'message'} size={14} style={{ flexShrink: 0, color: c.pinned ? '#f59e0b' : 'inherit' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isActive ? 600 : 400 }}>
                      {c.title}
                    </span>
                  </div>

                  <div className="row" style={{ gap: '4px', opacity: isActive ? 1 : 0.4 }} onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ padding: '3px' }}
                      title={c.pinned ? 'Unpin' : 'Pin'}
                      onClick={() => handleUpdateConversation({ pinned: !c.pinned })}
                    >
                      <Icon name="star" size={12} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ padding: '3px' }}
                      title="Delete conversation"
                      onClick={() => handleDeleteConversation(c.id)}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer: Memory & Token Budget Indicator */}
        <div style={{ padding: '14px 16px', borderTop: '1px solid var(--line)', background: 'var(--surface-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <button
              type="button"
              className="btn btn--sm"
              style={{ fontSize: '11.5px', padding: '4px 8px' }}
              onClick={() => {
                loadMemories();
                setShowMemoryModal(true);
              }}
            >
              <Icon name="sliders" size={12} /> Memory & Rules
            </button>
            <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>
              ${usage?.todayCostUsd || '0.00'} / ${usage?.dailyBudgetLimit || '50'}
            </span>
          </div>

          {/* Budget progress bar */}
          <div style={{ width: '100%', height: '4px', background: 'var(--line)', borderRadius: '2px', overflow: 'hidden' }}>
            <div
              style={{
                width: `${usage?.usagePercentage || 4}%`,
                height: '100%',
                background: (usage?.usagePercentage || 0) > 85 ? 'var(--red)' : 'var(--accent)',
                transition: 'width 0.3s'
              }}
            />
          </div>
        </div>
      </aside>

      {/* ======================================================== */}
      {/* 2. MAIN WORKSPACE: Chat Stream, Tools, Inputs, Approvals */}
      {/* ======================================================== */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
        {/* Workspace Top Header Bar */}
        <header
          style={{
            height: '56px',
            padding: '0 20px',
            borderBottom: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--surface)'
          }}
        >
          {/* Conversation Title & Rename */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            {editingTitle ? (
              <input
                className="input input--sm"
                value={titleInput}
                onChange={e => setTitleInput(e.target.value)}
                onBlur={() => {
                  setEditingTitle(false);
                  handleUpdateConversation({ title: titleInput });
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    setEditingTitle(false);
                    handleUpdateConversation({ title: titleInput });
                  }
                }}
                autoFocus
                style={{ width: '260px' }}
              />
            ) : (
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                onClick={() => setEditingTitle(true)}
                title="Click to rename"
              >
                <strong style={{ fontSize: '15px' }}>{activeConv?.title || 'Business Assistant'}</strong>
                <Icon name="edit" size={13} style={{ color: 'var(--text-3)' }} />
              </div>
            )}
            <Badge tone="amber">{activeAgent.name}</Badge>
          </div>

          {/* Controls: Model Picker & Context Drawer Toggle */}
          <div className="row" style={{ gap: '10px' }}>
            <select
              className="select select--sm"
              value={selectedModel}
              onChange={e => {
                const newModel = e.target.value;
                setSelectedModel(newModel);
                if (activeConvId) handleUpdateConversation({ model: newModel });
              }}
              style={{ fontSize: '12px' }}
            >
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.provider})
                </option>
              ))}
            </select>

            <button
              type="button"
              className={`btn btn--sm ${showRightPanel ? 'btn--primary' : ''}`}
              onClick={() => setShowRightPanel(!showRightPanel)}
              title="Toggle Business Context Panel"
            >
              <Icon name="layout" size={13} /> {showRightPanel ? 'Hide Context' : 'Context'}
            </button>
          </div>
        </header>

        {/* Message Stream Area */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
          {(!activeConv?.messages || activeConv.messages.length === 0) ? (
            /* Welcome / Zero State View */
            <div style={{ maxWidth: '640px', margin: '40px auto', textAlign: 'center' }}>
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, #FFA028 0%, #E65100 100%)',
                  margin: '0 auto 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '32px',
                  boxShadow: '0 0 24px rgba(245, 158, 11, 0.4)'
                }}
              >
                ⏰
              </div>
              <h2 style={{ fontSize: '22px', fontWeight: 700, margin: '0 0 8px' }}>
                {activeAgent.name}
              </h2>
              <p style={{ color: 'var(--text-2)', fontSize: '14px', lineHeight: 1.6, margin: '0 0 24px' }}>
                {activeAgent.subtitle}. Grounded in your CRM records, pipelines, campaigns, and internal knowledge docs.
              </p>

              {/* Suggested Prompt Cards */}
              <div className="grid grid--2" style={{ gap: '12px', textAlign: 'left' }}>
                {activeAgent.suggestedPrompts.map((prompt, idx) => (
                  <div
                    key={idx}
                    className="card card--interactive"
                    style={{ padding: '14px 16px', cursor: 'pointer', borderRadius: 'var(--r-md)' }}
                    onClick={() => handleSendMessage(prompt)}
                  >
                    <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>
                      {prompt}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--accent)', marginTop: '4px' }}>
                      Click to analyze →
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Stream of Messages */
            <div style={{ maxWidth: '840px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {activeConv.messages.map((m) => {
                const isUser = m.role === 'user';
                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isUser ? 'flex-end' : 'flex-start',
                      width: '100%'
                    }}
                  >
                    {/* Message Bubble Container */}
                    <div
                      style={{
                        maxWidth: '85%',
                        padding: '14px 18px',
                        borderRadius: 'var(--r-lg)',
                        background: isUser ? 'var(--accent)' : 'var(--surface-2)',
                        color: isUser ? '#ffffff' : 'var(--text)',
                        border: isUser ? 'none' : '1px solid var(--line)',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.06)'
                      }}
                    >
                      {/* Sender label */}
                      <div style={{ fontSize: '11px', opacity: 0.8, marginBottom: '6px', fontWeight: 600 }}>
                        {isUser ? 'You' : `⏰ ${activeAgent.name}`}
                      </div>

                      {/* Content Body */}
                      <div style={{ fontSize: '14px', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {m.content}
                      </div>

                      {/* Tool Execution Results */}
                      {m.toolResults && m.toolResults.length > 0 && (
                        <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {m.toolResults.map((tr, idx) => (
                            <span
                              key={idx}
                              style={{
                                fontSize: '11px',
                                padding: '3px 8px',
                                borderRadius: 'var(--r-sm)',
                                background: tr.success ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                color: tr.success ? '#22c55e' : '#ef4444',
                                border: `1px solid ${tr.success ? '#22c55e' : '#ef4444'}`
                              }}
                            >
                              {tr.success ? '✓' : '✗'} {tr.name}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Sensitive Action Approval Card */}
                      {m.approvalRequired && m.approvalStatus === 'pending' && (
                        <div
                          style={{
                            marginTop: '14px',
                            padding: '12px 14px',
                            borderRadius: 'var(--r-md)',
                            background: '#7f1d1d',
                            color: '#fef2f2',
                            border: '1px solid #ef4444'
                          }}
                        >
                          <div style={{ fontWeight: 700, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>⚠️ Human Approval Required</span>
                          </div>
                          <p style={{ fontSize: '12px', margin: '6px 0 10px', lineHeight: 1.5 }}>
                            {m.approvalRequired.explanation}
                          </p>
                          <div className="row" style={{ gap: '8px' }}>
                            <button
                              type="button"
                              className="btn btn--sm"
                              style={{ background: '#22c55e', color: '#fff', border: 'none', fontWeight: 600 }}
                              onClick={() => handleApproveAction(m.id, true)}
                            >
                              Approve & Execute
                            </button>
                            <button
                              type="button"
                              className="btn btn--sm"
                              style={{ background: '#374151', color: '#fff', border: 'none' }}
                              onClick={() => handleApproveAction(m.id, false)}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Source Citations */}
                      {m.citations && m.citations.length > 0 && (
                        <div style={{ marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '8px' }}>
                          <span style={{ fontSize: '11px', color: 'var(--text-3)', display: 'block', marginBottom: '4px' }}>
                            Sources cited:
                          </span>
                          <div className="row" style={{ gap: '6px', flexWrap: 'wrap' }}>
                            {m.citations.map((c, idx) => (
                              <span
                                key={idx}
                                title={c.excerpt}
                                style={{
                                  fontSize: '10.5px',
                                  padding: '2px 6px',
                                  borderRadius: 'var(--r-sm)',
                                  background: 'var(--surface-3)',
                                  border: '1px solid var(--line)',
                                  color: 'var(--accent)'
                                }}
                              >
                                📄 {c.docTitle}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Message Actions Toolbar */}
                    <div className="row" style={{ gap: '6px', marginTop: '4px', fontSize: '11px', color: 'var(--text-3)' }}>
                      <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ padding: '2px 4px' }}
                        title="Copy to clipboard"
                        onClick={() => handleCopy(m.id, m.content)}
                      >
                        <Icon name="copy" size={11} /> {copiedId === m.id ? 'Copied!' : ''}
                      </button>
                      {!isUser && (
                        <>
                          <button
                            type="button"
                            className="icon-btn"
                            style={{ padding: '2px 4px', color: m.feedback?.rating === 'positive' ? 'var(--green)' : 'inherit' }}
                            title="Helpful"
                            onClick={() => handleFeedback(m.id, 'up')}
                          >
                            👍
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            style={{ padding: '2px 4px', color: m.feedback?.rating === 'negative' ? 'var(--red)' : 'inherit' }}
                            title="Not helpful"
                            onClick={() => handleFeedback(m.id, 'down')}
                          >
                            👎
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Streaming In-Flight Loading Skeleton */}
              {isGenerating && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-3)', fontSize: '13px' }}>
                  <span style={{ animation: 'spin 1.5s linear infinite' }}>⏰</span>
                  <span>Miss Minutes is reasoning and executing tools...</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input Bar Area */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
          <div
            style={{
              maxWidth: '840px',
              margin: '0 auto',
              background: 'var(--surface-2)',
              borderRadius: 'var(--r-lg)',
              border: '1px solid var(--line)',
              padding: '10px 14px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
            }}
          >
            {/* Active context pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '11px', color: 'var(--text-3)' }}>
              <span>Context:</span>
              <Badge tone="default">CRM + Pipelines</Badge>
              {knowledgeDocs.length > 0 && <Badge tone="default">{knowledgeDocs.length} Docs</Badge>}
              <Badge tone="default">{selectedModel}</Badge>
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              className="input"
              rows={2}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                resize: 'none',
                padding: '4px 0',
                outline: 'none',
                fontSize: '14px',
                color: 'var(--text)'
              }}
              placeholder={`Ask ${activeAgent.name} to analyze deals, draft campaigns, search contacts, or trigger workflows...`}
              value={inputMessage}
              onChange={e => setInputMessage(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              disabled={isGenerating}
            />

            {/* Input Action Controls */}
            <div className="row row--between" style={{ marginTop: '8px' }}>
              <span className="hint" style={{ fontSize: '11px' }}>
                Press <strong>Enter</strong> to send, <strong>Shift + Enter</strong> for newline
              </span>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                style={{ padding: '6px 14px' }}
                onClick={() => handleSendMessage()}
                disabled={isGenerating || !inputMessage.trim()}
              >
                <Icon name="send" size={13} /> Send
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* ======================================================== */}
      {/* 3. RIGHT CONTEXTUAL PANEL: Agent, Records, Audit, Docs    */}
      {/* ======================================================== */}
      {showRightPanel && (
        <aside
          style={{
            width: '320px',
            borderLeft: '1px solid var(--line)',
            background: 'var(--surface-2)',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            padding: '20px',
            flexShrink: 0
          }}
        >
          {/* Agent Persona Card */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <div style={{ padding: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <span style={{ fontSize: '24px' }}>⏰</span>
                <div>
                  <strong style={{ fontSize: '14px', display: 'block' }}>{activeAgent.name}</strong>
                  <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>{activeAgent.subtitle}</span>
                </div>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>
                {activeAgent.systemPrompt.slice(0, 160)}...
              </p>
            </div>
          </div>

          {/* Connected Capabilities & Tools */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <div className="card__head" style={{ padding: '10px 14px' }}>
              <div className="card__title" style={{ fontSize: '12.5px' }}>Authorized Tools</div>
            </div>
            <div style={{ padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              <Badge tone="green">CRM Search</Badge>
              <Badge tone="green">Deal Creator</Badge>
              <Badge tone="green">Calendar Availability</Badge>
              <Badge tone="green">Workflow Trigger</Badge>
              <Badge tone="green">Revenue Reporting</Badge>
              <Badge tone="green">Duplicate Scanner</Badge>
            </div>
          </div>

          {/* Attached Knowledge Sources */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <div className="card__head" style={{ padding: '10px 14px' }}>
              <div className="card__title" style={{ fontSize: '12.5px' }}>Knowledge Base Docs</div>
              <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>{knowledgeDocs.length} active</span>
            </div>
            <div style={{ padding: '6px 14px 12px' }}>
              {knowledgeDocs.length === 0 ? (
                <div style={{ fontSize: '11.5px', color: 'var(--text-3)' }}>No documents indexed yet.</div>
              ) : (
                knowledgeDocs.slice(0, 4).map(doc => (
                  <div key={doc.id} style={{ fontSize: '12px', padding: '5px 0', borderBottom: '1px solid var(--line-soft)' }}>
                    📄 {doc.title}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Live Platform Status */}
          <div className="card">
            <div className="card__head" style={{ padding: '10px 14px' }}>
              <div className="card__title" style={{ fontSize: '12.5px' }}>Platform Sync</div>
              <StatusBadge status="connected" />
            </div>
            <div style={{ padding: '10px 14px', fontSize: '11.5px', color: 'var(--text-2)', lineHeight: 1.6 }}>
              <div>• Tenant isolation active</div>
              <div>• Dual-step confirmation enforced</div>
              <div>• Real-time WebSocket timeline synced</div>
            </div>
          </div>
        </aside>
      )}

      {/* ======================================================== */}
      {/* 4. MODAL: User Memory Management                         */}
      {/* ======================================================== */}
      {showMemoryModal && (
        <Modal
          title="Persistent Copilot Memories & Rules"
          onClose={() => setShowMemoryModal(false)}
          footer={
            <button className="btn" type="button" onClick={() => setShowMemoryModal(false)}>
              Close
            </button>
          }
        >
          <div className="stack" style={{ gap: '14px' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.5 }}>
              Memories are persistent rules and preferences that Copilot remembers across all conversations in this workspace.
            </p>

            {/* Add memory form */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                className="input"
                placeholder="Key (e.g. tone)"
                style={{ flex: '1 1 120px' }}
                value={newMemoryKey}
                onChange={e => setNewMemoryKey(e.target.value)}
              />
              <input
                className="input"
                placeholder="Rule or preference content..."
                style={{ flex: '2 1 200px' }}
                value={newMemoryVal}
                onChange={e => setNewMemoryVal(e.target.value)}
              />
              <button className="btn btn--primary" type="button" onClick={handleAddMemory}>
                Add
              </button>
            </div>

            {/* Memory List */}
            <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
              {memories.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-3)', fontSize: '12px' }}>
                  No persistent memories saved yet.
                </div>
              ) : (
                memories.map(m => (
                  <div
                    key={m.id}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 'var(--r-md)',
                      background: 'var(--surface-2)',
                      marginBottom: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '12px' }}>{m.key}: </strong>
                      <span style={{ fontSize: '12px', color: 'var(--text-2)' }}>{m.content}</span>
                    </div>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => handleDeleteMemory(m.id)}
                      title="Delete memory"
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
