import { useEffect, useState, useRef, useMemo } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, StatusBadge } from '../components/ui';
import { api } from '../lib/api';
import { MissMinutesAvatar } from '../components/MissMinutesAvatar';

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

const DEFAULT_MODELS = [
  { id: 'gpt-4o', name: 'GPT-4o (Omni Reasoning)', provider: 'openai' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast)', provider: 'openai' },
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet (Coding & Analysis)', provider: 'anthropic' },
  { id: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku (Real-time)', provider: 'anthropic' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (Deep Research)', provider: 'gemini' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash (Instant)', provider: 'gemini' },
  { id: 'ollama-llama3', name: 'Ollama Llama 3 (Local Air-gapped)', provider: 'ollama' }
];

const DEFAULT_AGENTS: Agent[] = [
  {
    id: 'general_business',
    name: 'General Business Assistant',
    subtitle: 'Autonomous Operations & Timeline Management',
    icon: 'sparkles',
    avatarTone: 'amber',
    model: 'gpt-4o',
    systemPrompt: 'You are Operza Copilot, an enterprise-grade AI executive assistant managing operations, contacts, revenue, and workflows.',
    allowedCategories: ['crm', 'calendar', 'conversations', 'marketing', 'workflows', 'reporting'],
    suggestedPrompts: [
      'Summarize my agency performance this month',
      'Show my highest-value deals in the pipeline',
      'Which leads need immediate follow-up?',
      'Check my calendar availability for today'
    ]
  },
  {
    id: 'sales_closer',
    name: 'Sales Pipeline Closer',
    subtitle: 'Deal Acceleration & Objection Handling',
    icon: 'kanban',
    avatarTone: 'green',
    model: 'claude-3-5-sonnet',
    systemPrompt: 'You are the Operza Sales Closer specializing in moving pipeline opportunities and closing deals.',
    allowedCategories: ['crm', 'conversations', 'reporting'],
    suggestedPrompts: [
      'Audit deals in the proposal stage',
      'Find high-value opportunities over $10,000',
      'Draft a follow-up offer for stalled leads',
      'Analyze stage conversion velocity'
    ]
  },
  {
    id: 'crm_specialist',
    name: 'CRM Operations Specialist',
    subtitle: 'Data Hygiene, Lead Qualification & Enrichment',
    icon: 'users',
    avatarTone: 'blue',
    model: 'gpt-4o-mini',
    systemPrompt: 'You are the CRM Operations Specialist focused on contact hygiene, deduplication, and lead routing.',
    allowedCategories: ['crm', 'calendar', 'conversations'],
    suggestedPrompts: [
      'Find duplicate contacts across my database',
      'Search contacts tagged copilot-lead',
      'Create a follow-up reminder task',
      'List recent unassigned inbound leads'
    ]
  },
  {
    id: 'workflow_architect',
    name: 'Workflow Automation Architect',
    subtitle: 'n8n Graph Design, Webhooks & Logic Engines',
    icon: 'zap',
    avatarTone: 'violet',
    model: 'claude-3-5-sonnet',
    systemPrompt: 'You are the Workflow Automation Architect designing n8n-style graphs, webhooks, and execution pipelines.',
    allowedCategories: ['workflows', 'reporting'],
    suggestedPrompts: [
      'List all active automation workflows',
      'Explain how the Lead Nurture workflow works',
      'Diagnose failed execution runs',
      'Trigger Inbound Lead Automation'
    ]
  },
  {
    id: 'marketing_strategist',
    name: 'Marketing Campaign Strategist',
    subtitle: 'Multi-Channel Sequences & A2P 10DLC Messaging',
    icon: 'megaphone',
    avatarTone: 'amber',
    model: 'gpt-4o',
    systemPrompt: 'You are the Marketing Campaign Strategist creating email sequences and compliant SMS campaigns.',
    allowedCategories: ['marketing', 'conversations', 'crm'],
    suggestedPrompts: [
      'Summarize active email and SMS campaigns',
      'Draft an SMS re-engagement blast for inactive leads',
      'Create an email nurture campaign draft',
      'Verify A2P 10DLC compliance on SMS drafts'
    ]
  },
  {
    id: 'financial_auditor',
    name: 'Financial & Revenue Auditor',
    subtitle: 'Invoice Reconciliation & Growth Velocity',
    icon: 'wallet',
    avatarTone: 'green',
    model: 'gpt-4o',
    systemPrompt: 'You are the Financial Auditor tracking collection rates, invoices, and ARR velocity.',
    allowedCategories: ['reporting', 'crm'],
    suggestedPrompts: [
      'Calculate paid revenue vs total invoiced',
      'Review agency collection rate metrics',
      'Audit monthly financial summary',
      'Identify overdue invoices pending payment'
    ]
  }
];

/**
 * Lightweight, robust markdown formatter for assistant responses.
 * Renders bold, code blocks with copy buttons, lists, and headers cleanly.
 */
function MarkdownContent({ content }: { content: string }) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyCode = (codeText: string, index: number) => {
    navigator.clipboard.writeText(codeText);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  if (!content) return null;

  // Split by code blocks
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', lineHeight: 1.6, fontSize: '14px' }}>
      {parts.map((part, pIdx) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const lines = part.slice(3, -3).trim().split('\n');
          const firstLine = lines[0].trim();
          const hasLang = /^[a-zA-Z0-9_-]+$/.test(firstLine);
          const lang = hasLang ? firstLine : '';
          const codeBody = (hasLang ? lines.slice(1) : lines).join('\n');

          return (
            <div
              key={pIdx}
              style={{
                borderRadius: '8px',
                overflow: 'hidden',
                background: '#0d1117',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                margin: '8px 0'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 12px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  fontSize: '11px',
                  color: '#8b949e'
                }}
              >
                <span>{lang || 'code'}</span>
                <button
                  type="button"
                  onClick={() => copyCode(codeBody, pIdx)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: copiedIndex === pIdx ? '#3fb950' : '#8b949e',
                    cursor: 'pointer',
                    fontSize: '11px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Icon name={copiedIndex === pIdx ? 'check' : 'copy'} size={12} />
                  <span>{copiedIndex === pIdx ? 'Copied!' : 'Copy code'}</span>
                </button>
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: '12px',
                  overflowX: 'auto',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12.5px',
                  lineHeight: 1.5,
                  color: '#e6edf3'
                }}
              >
                <code>{codeBody}</code>
              </pre>
            </div>
          );
        }

        // Parse paragraphs, lists, and bold text
        const paras = part.split('\n\n');
        return paras.map((para, paraIdx) => {
          const lines = para.split('\n');

          return (
            <div key={`${pIdx}-${paraIdx}`} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {lines.map((line, lIdx) => {
                const trimmed = line.trim();
                if (!trimmed) return null;

                // Headers
                if (trimmed.startsWith('### ')) {
                  return (
                    <h4 key={lIdx} style={{ fontSize: '15px', fontWeight: 700, margin: '8px 0 2px', color: 'inherit' }}>
                      {renderInline(trimmed.slice(4))}
                    </h4>
                  );
                }
                if (trimmed.startsWith('## ')) {
                  return (
                    <h3 key={lIdx} style={{ fontSize: '16px', fontWeight: 700, margin: '10px 0 4px', color: 'inherit' }}>
                      {renderInline(trimmed.slice(3))}
                    </h3>
                  );
                }
                if (trimmed.startsWith('# ')) {
                  return (
                    <h2 key={lIdx} style={{ fontSize: '18px', fontWeight: 700, margin: '12px 0 6px', color: 'inherit' }}>
                      {renderInline(trimmed.slice(2))}
                    </h2>
                  );
                }

                // Bullet item
                if (trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                  return (
                    <div key={lIdx} style={{ display: 'flex', gap: '8px', paddingLeft: '4px' }}>
                      <span style={{ color: 'var(--accent)', flexShrink: 0 }}>•</span>
                      <span>{renderInline(trimmed.slice(2))}</span>
                    </div>
                  );
                }

                // Numbered list item
                const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
                if (numMatch) {
                  return (
                    <div key={lIdx} style={{ display: 'flex', gap: '8px', paddingLeft: '4px' }}>
                      <span style={{ fontWeight: 600, color: 'var(--accent)', flexShrink: 0 }}>{numMatch[1]}.</span>
                      <span>{renderInline(numMatch[2])}</span>
                    </div>
                  );
                }

                // Regular paragraph line
                return (
                  <p key={lIdx} style={{ margin: 0 }}>
                    {renderInline(line)}
                  </p>
                );
              })}
            </div>
          );
        });
      })}
    </div>
  );
}

/**
 * Parses bold **text**, italic *text*, and inline `code`.
 */
function renderInline(text: string) {
  const tokens = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);

  return tokens.map((token, idx) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={idx}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith('*') && token.endsWith('*')) {
      return <em key={idx}>{token.slice(1, -1)}</em>;
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      return (
        <code
          key={idx}
          style={{
            background: 'var(--surface-3)',
            padding: '2px 5px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'var(--font-mono)'
          }}
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    return token;
  });
}

export default function Copilot() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [agents, setAgents] = useState<Agent[]>(DEFAULT_AGENTS);
  const [selectedAgentId, setSelectedAgentId] = useState('general_business');
  const [selectedModel, setSelectedModel] = useState('gpt-4o');
  const [models, setModels] = useState<any[]>(DEFAULT_MODELS);

  // Messages & Input
  const [inputMessage, setInputMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // UI Panels & Mobile Layout
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
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
      api.copilot.models().catch(() => ({ models: DEFAULT_MODELS })),
      api.copilot.agents().catch(() => ({ agents: DEFAULT_AGENTS })),
      api.copilot.listConversations().catch(() => ({ conversations: [] })),
      api.copilot.getUsage().catch(() => ({ usage: null })),
      api.aiTrainer.getKnowledge().catch(() => ({ documents: [] }))
    ]).then(([modelsRes, agentsRes, convsRes, usageRes, docsRes]) => {
      if (!active) return;
      if (modelsRes?.models && modelsRes.models.length > 0) setModels(modelsRes.models);
      if (agentsRes?.agents && agentsRes.agents.length > 0) setAgents(agentsRes.agents);
      if (usageRes?.usage) setUsage(usageRes.usage);
      if (docsRes?.documents) setKnowledgeDocs(docsRes.documents);

      const convList = convsRes?.conversations || [];
      setConversations(convList);

      if (convList.length > 0) {
        selectConversation(convList[0].id);
      }
    });

    return () => { active = false; };
  }, []);

  // Scroll to bottom when messages update
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeConv?.messages, isGenerating]);

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
        setMobileSidebarOpen(false);
      }
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
  };

  // Create New Conversation or Reset to Fresh Draft
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
        setMobileSidebarOpen(false);
      }
    } catch (err) {
      // Local fallback draft
      const draftId = `draft_${Date.now()}`;
      const draftConv: Conversation = {
        id: draftId,
        title: 'New Business Conversation',
        agentId,
        model: selectedModel,
        pinned: false,
        favorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: []
      };
      setConversations(prev => [draftConv, ...prev]);
      setActiveConvId(draftId);
      setActiveConv(draftConv);
      setTitleInput(draftConv.title);
      setMobileSidebarOpen(false);
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
          setActiveConvId(null);
          setActiveConv(null);
        }
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  // Send Message (Ensures conversation exists before sending)
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputMessage).trim();
    if (!text || isGenerating) return;

    setInputMessage('');
    setIsGenerating(true);

    let targetConvId = activeConvId;

    // If no active conversation exists or current is a temporary draft, create real one first
    if (!targetConvId || targetConvId.startsWith('draft_')) {
      try {
        const shortTitle = text.length > 34 ? `${text.slice(0, 34)}...` : text;
        const createRes = await api.copilot.createConversation({
          title: shortTitle,
          agentId: selectedAgentId,
          model: selectedModel
        });
        if (createRes?.conversation) {
          targetConvId = createRes.conversation.id;
          setActiveConvId(targetConvId);
          setConversations(prev => [createRes.conversation, ...prev.filter(c => !c.id.startsWith('draft_'))]);
          setActiveConv({ ...createRes.conversation, messages: [] });
          setTitleInput(createRes.conversation.title);
        }
      } catch (err) {
        console.error('Failed to initialize conversation for message:', err);
      }
    }

    if (!targetConvId) {
      setIsGenerating(false);
      return;
    }

    // Optimistic user message append
    const tempUserMsg: Message = {
      id: `temp_${Date.now()}`,
      conversationId: targetConvId,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    };

    setActiveConv(prev => prev ? { ...prev, messages: [...(prev.messages || []), tempUserMsg] } : null);

    try {
      const res = await api.copilot.sendMessage(targetConvId, {
        message: text,
        agentId: selectedAgentId,
        model: selectedModel
      });

      if (res?.message) {
        setActiveConv(prev => {
          if (!prev) return null;
          const filtered = (prev.messages || []).filter(m => m.id !== tempUserMsg.id);
          return {
            ...prev,
            messages: [...filtered, tempUserMsg, res.message]
          };
        });

        // Refresh usage stats & conversations list
        api.copilot.getUsage().then(u => { if (u?.usage) setUsage(u.usage); }).catch(() => {});
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
              conversationId: targetConvId,
              role: 'assistant',
              content: `⚠️ Request failed: ${err.message || 'Unknown error occurred'}`,
              timestamp: new Date().toISOString()
            }
          ]
        };
      });
    } finally {
      setIsGenerating(false);
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
            messages: (prev.messages || []).map(m =>
              m.id === messageId ? { ...m, approvalStatus: (approved ? 'approved' : 'rejected') as 'approved' | 'rejected' } : m
            ).concat(res.message)
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
    return agents.find(a => a.id === selectedAgentId) || DEFAULT_AGENTS[0];
  }, [agents, selectedAgentId]);

  return (
    <div className="content content--flush">
      <div
        className="copilot-workspace"
        style={{
          display: 'flex',
          height: '100%',
          width: '100%',
          overflow: 'hidden',
          background: 'var(--surface)',
          position: 'relative'
        }}
      >
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
            flexShrink: 0,
            zIndex: 30,
            transition: 'transform 0.2s ease',
            position: mobileSidebarOpen ? 'absolute' : 'relative',
            left: 0,
            top: 0,
            bottom: 0,
            boxShadow: mobileSidebarOpen ? '4px 0 24px rgba(0,0,0,0.2)' : 'none'
          }}
        >
          {/* New Chat & Action Header */}
          <div style={{ padding: '16px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <button
                className="btn btn--primary"
                style={{ flex: 1, justifyContent: 'center', gap: '8px', padding: '9px 12px' }}
                onClick={() => createNewConversation()}
              >
                <Icon name="plus" size={15} /> New Chat
              </button>
              {mobileSidebarOpen && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setMobileSidebarOpen(false)}
                  title="Close sidebar"
                >
                  <Icon name="x" size={16} />
                </button>
              )}
            </div>

            {/* Search Bar */}
            <div className="search">
              <Icon name="search" size={14} />
              <input
                className="input input--sm"
                placeholder="Search history..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ fontSize: '12px', paddingLeft: '32px' }}
              />
              {searchQuery && (
                <button
                  type="button"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: '0 6px' }}
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
              Autonomous Agent Persona
            </label>
            <select
              className="select"
              style={{ width: '100%', marginTop: '6px', fontSize: '12.5px', height: '34px' }}
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
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: '12px' }}>
                <div style={{ marginBottom: '6px' }}>No conversations found</div>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => createNewConversation()}
                  style={{ fontSize: '11.5px' }}
                >
                  Start a new conversation
                </button>
              </div>
            ) : (
              filteredConversations.map(c => {
                const isActive = c.id === activeConvId;
                return (
                  <div
                    key={c.id}
                    onClick={() => selectConversation(c.id)}
                    style={{
                      padding: '8px 12px',
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
                      <Icon
                        name={c.pinned ? 'star' : 'message'}
                        size={14}
                        style={{ flexShrink: 0, color: c.pinned ? '#f59e0b' : 'inherit' }}
                      />
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

        {/* Scrim for Mobile Sidebar */}
        {mobileSidebarOpen && (
          <div
            onClick={() => setMobileSidebarOpen(false)}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.4)',
              zIndex: 25
            }}
          />
        )}

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
              background: 'var(--surface)',
              flexShrink: 0
            }}
          >
            {/* Conversation Title & Rename */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <button
                type="button"
                className="icon-btn sidebar__toggle"
                onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
                style={{ display: 'inline-flex' }}
                aria-label="Toggle history sidebar"
              >
                <Icon name="menu" size={17} />
              </button>

              <MissMinutesAvatar size={28} />

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
                  style={{ width: '220px' }}
                />
              ) : (
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', minWidth: 0 }}
                  onClick={() => setEditingTitle(true)}
                  title="Click to rename"
                >
                  <strong style={{ fontSize: '14.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activeConv?.title || 'Operza Copilot'}
                  </strong>
                  <Icon name="edit" size={12} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
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
                style={{ fontSize: '12px', height: '32px' }}
              >
                {models.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name}
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
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '24px 20px' }}>
            {(!activeConv?.messages || activeConv.messages.length === 0) ? (
              /* Welcome / Zero State View */
              <div style={{ maxWidth: '680px', margin: '30px auto', textAlign: 'center' }}>
                <MissMinutesAvatar size={68} animated={false} style={{ margin: '0 auto 16px' }} />
                <h2 style={{ fontSize: '22px', fontWeight: 700, margin: '0 0 6px' }}>
                  {activeAgent.name}
                </h2>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginBottom: '14px' }}>
                  <span style={{ fontSize: '11px', background: 'rgba(245, 158, 11, 0.15)', color: '#d97706', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                    TVA AUTONOMOUS COPILOT
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>•</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-2)' }}>{selectedModel}</span>
                </div>
                <p style={{ color: 'var(--text-2)', fontSize: '13.5px', lineHeight: 1.6, margin: '0 0 24px', maxWidth: '580px', marginInline: 'auto' }}>
                  {activeAgent.subtitle}. Connected live to your contacts, pipeline deals, campaigns, calendar, and internal documents.
                </p>

                {/* Suggested Prompt Cards */}
                <div className="grid grid--2" style={{ gap: '12px', textAlign: 'left' }}>
                  {(activeAgent.suggestedPrompts || []).map((prompt, idx) => (
                    <div
                      key={idx}
                      className="card card--interactive"
                      style={{
                        padding: '14px 16px',
                        cursor: 'pointer',
                        borderRadius: 'var(--r-md)',
                        border: '1px solid var(--line)',
                        background: 'var(--surface-2)',
                        transition: 'all 0.15s ease'
                      }}
                      onClick={() => handleSendMessage(prompt)}
                    >
                      <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>
                        {prompt}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--accent)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>Run automation</span> →
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
                      {/* Sender Avatar & Name Header */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          marginBottom: '4px',
                          fontSize: '11.5px',
                          color: 'var(--text-3)',
                          paddingInline: '4px'
                        }}
                      >
                        {!isUser && <MissMinutesAvatar size={18} />}
                        <span>{isUser ? 'You' : activeAgent.name}</span>
                        <span>•</span>
                        <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>

                      {/* Message Bubble Container */}
                      <div
                        style={{
                          maxWidth: '88%',
                          padding: '14px 18px',
                          borderRadius: 'var(--r-lg)',
                          background: isUser ? 'var(--accent)' : 'var(--surface-2)',
                          color: isUser ? '#ffffff' : 'var(--text)',
                          border: isUser ? 'none' : '1px solid var(--line)',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.04)'
                        }}
                      >
                        {/* Content Body */}
                        {isUser ? (
                          <div style={{ fontSize: '14px', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {m.content}
                          </div>
                        ) : (
                          <MarkdownContent content={m.content} />
                        )}

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
                                {tr.success ? '✓' : '✗'} {tr.name || tr.toolId || 'Tool'}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Sensitive Action Approval Card */}
                        {m.approvalRequired && m.approvalStatus === 'pending' && (
                          <div
                            style={{
                              marginTop: '14px',
                              padding: '14px',
                              borderRadius: 'var(--r-md)',
                              background: '#7f1d1d',
                              color: '#fef2f2',
                              border: '1px solid #ef4444'
                            }}
                          >
                            <div style={{ fontWeight: 700, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                              <span>⚠️ Operator Confirmation Required</span>
                            </div>
                            <p style={{ fontSize: '12.5px', margin: '0 0 12px', lineHeight: 1.5, opacity: 0.95 }}>
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
                              Grounding Sources:
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
                      <div className="row" style={{ gap: '8px', marginTop: '4px', fontSize: '11px', color: 'var(--text-3)', paddingInline: '4px' }}>
                        <button
                          type="button"
                          className="icon-btn"
                          style={{ padding: '2px 4px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px' }}
                          title="Copy to clipboard"
                          onClick={() => handleCopy(m.id, m.content)}
                        >
                          <Icon name="copy" size={11} /> {copiedId === m.id ? 'Copied!' : 'Copy'}
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

                {/* Streaming / In-Flight Loading Indicator */}
                {isGenerating && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-2)', fontSize: '13px', padding: '12px 16px', background: 'var(--surface-2)', borderRadius: 'var(--r-md)', width: 'fit-content', border: '1px solid var(--line)' }}>
                    <MissMinutesAvatar size={24} animated={true} />
                    <span>Miss Minutes is reasoning, retrieving context, and executing tools...</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Input Bar Area */}
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--line)', background: 'var(--surface)', flexShrink: 0 }}>
            <div
              style={{
                maxWidth: '840px',
                margin: '0 auto',
                background: 'var(--surface-2)',
                borderRadius: 'var(--r-lg)',
                border: '1.5px solid var(--line)',
                padding: '10px 14px',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 4px 16px rgba(0,0,0,0.06)'
              }}
            >
              {/* Active context pills */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '11px', color: 'var(--text-3)', overflowX: 'auto', paddingBottom: '2px' }}>
                <span style={{ fontWeight: 600 }}>Active Workspace:</span>
                <Badge tone="default">Live CRM</Badge>
                {knowledgeDocs.length > 0 && <Badge tone="default">{knowledgeDocs.length} Knowledge Docs</Badge>}
                <Badge tone="amber">{activeAgent.name}</Badge>
                <Badge tone="default">{selectedModel}</Badge>
              </div>

              {/* Textarea */}
              <textarea
                ref={textareaRef}
                rows={2}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  resize: 'none',
                  minHeight: '48px',
                  maxHeight: '160px',
                  padding: '4px 0',
                  outline: 'none',
                  fontSize: '13.5px',
                  lineHeight: 1.5,
                  color: 'var(--text)',
                  fontFamily: 'inherit'
                }}
                placeholder={`Ask ${activeAgent.name} to audit deals, search contacts, run workflows, or draft campaigns...`}
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
              <div className="row row--between" style={{ marginTop: '8px', alignItems: 'center' }}>
                <span className="hint" style={{ fontSize: '11px', color: 'var(--text-3)' }}>
                  Press <strong>Enter</strong> to send, <strong>Shift + Enter</strong> for newline
                </span>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  style={{ padding: '6px 14px', fontWeight: 600 }}
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
                  <MissMinutesAvatar size={36} />
                  <div>
                    <strong style={{ fontSize: '13.5px', display: 'block' }}>{activeAgent.name}</strong>
                    <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>{activeAgent.subtitle}</span>
                  </div>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>
                  {activeAgent.systemPrompt}
                </p>
              </div>
            </div>

            {/* Connected Capabilities & Tools */}
            <div className="card" style={{ marginBottom: '16px' }}>
              <div className="card__head" style={{ padding: '10px 14px' }}>
                <div className="card__title" style={{ fontSize: '12.5px' }}>Authorized Tools (18)</div>
              </div>
              <div style={{ padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                <Badge tone="green">CRM Search</Badge>
                <Badge tone="green">Deal Creator</Badge>
                <Badge tone="green">Calendar Availability</Badge>
                <Badge tone="green">Workflow Trigger</Badge>
                <Badge tone="green">Revenue Reporting</Badge>
                <Badge tone="green">Duplicate Scanner</Badge>
                <Badge tone="green">A2P 10DLC Messaging</Badge>
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
                    <div key={doc.id} style={{ fontSize: '12px', padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
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
                <div>• Two-step confirmation enforced</div>
                <div>• Real-time timeline synced</div>
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
              <p style={{ fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>
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
    </div>
  );
}
