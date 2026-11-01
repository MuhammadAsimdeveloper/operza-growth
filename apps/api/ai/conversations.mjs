/**
 * Operza Copilot — Persistent Conversation Management
 * Persists conversations, messages, tool execution snapshots, citations, and feedback
 * with composite tenant scoping (agencyId & userId).
 */

import { randomUUID } from 'crypto';

export function listAgencyConversations(state, agencyId, userId = null, { search = '', pinnedOnly = false } = {}) {
  state.records.ai_conversations = state.records.ai_conversations || [];
  let convs = state.records.ai_conversations.filter(c => c.agencyId === agencyId);

  if (userId) {
    convs = convs.filter(c => !c.userId || c.userId === userId);
  }

  if (pinnedOnly) {
    convs = convs.filter(c => c.pinned);
  }

  if (search.trim()) {
    const q = search.toLowerCase().trim();
    convs = convs.filter(c => c.title.toLowerCase().includes(q));
  }

  // Sort by updatedAt descending
  convs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return convs;
}

export async function createAgencyConversation(state, agencyId, userId, { title, agentId = 'general_business', model = 'gpt-4o' }, saveState) {
  state.records.ai_conversations = state.records.ai_conversations || [];

  const conversation = {
    id: `conv_${randomUUID()}`,
    agencyId,
    userId,
    title: (title || 'New Business Conversation').trim(),
    agentId,
    model,
    pinned: false,
    favorite: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  state.records.ai_conversations.unshift(conversation);
  await saveState();
  return conversation;
}

export function getAgencyConversation(state, agencyId, conversationId) {
  state.records.ai_conversations = state.records.ai_conversations || [];
  state.records.ai_messages = state.records.ai_messages || [];

  const conv = state.records.ai_conversations.find(c => c.id === conversationId && c.agencyId === agencyId);
  if (!conv) return null;

  const messages = state.records.ai_messages
    .filter(m => m.conversationId === conversationId && m.agencyId === agencyId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return {
    ...conv,
    messages
  };
}

export async function updateAgencyConversation(state, agencyId, conversationId, patch, saveState) {
  state.records.ai_conversations = state.records.ai_conversations || [];
  const conv = state.records.ai_conversations.find(c => c.id === conversationId && c.agencyId === agencyId);
  if (!conv) return null;

  if (patch.title !== undefined) conv.title = String(patch.title).trim();
  if (patch.pinned !== undefined) conv.pinned = Boolean(patch.pinned);
  if (patch.favorite !== undefined) conv.favorite = Boolean(patch.favorite);
  if (patch.agentId !== undefined) conv.agentId = patch.agentId;
  if (patch.model !== undefined) conv.model = patch.model;
  conv.updatedAt = new Date().toISOString();

  await saveState();
  return conv;
}

export async function deleteAgencyConversation(state, agencyId, conversationId, saveState) {
  state.records.ai_conversations = state.records.ai_conversations || [];
  state.records.ai_messages = state.records.ai_messages || [];

  const cIdx = state.records.ai_conversations.findIndex(c => c.id === conversationId && c.agencyId === agencyId);
  if (cIdx === -1) return false;

  state.records.ai_conversations.splice(cIdx, 1);
  state.records.ai_messages = state.records.ai_messages.filter(m => !(m.conversationId === conversationId && m.agencyId === agencyId));

  await saveState();
  return true;
}

export async function appendConversationMessage(
  state,
  agencyId,
  conversationId,
  {
    role,
    content,
    toolCalls = [],
    toolResults = [],
    approvalRequired = null,
    approvalStatus = null,
    citations = [],
    tokens = {}
  },
  saveState
) {
  state.records.ai_messages = state.records.ai_messages || [];
  state.records.ai_conversations = state.records.ai_conversations || [];

  const message = {
    id: `msg_${randomUUID()}`,
    conversationId,
    agencyId,
    role,
    content: content || '',
    toolCalls,
    toolResults,
    approvalRequired,
    approvalStatus,
    citations,
    tokens,
    timestamp: new Date().toISOString()
  };

  state.records.ai_messages.push(message);

  // Update conversation updatedAt timestamp and auto-generate title from first user message
  const conv = state.records.ai_conversations.find(c => c.id === conversationId && c.agencyId === agencyId);
  if (conv) {
    conv.updatedAt = new Date().toISOString();
    if (role === 'user' && conv.title === 'New Business Conversation') {
      conv.title = content.slice(0, 42).replace(/[\r\n]+/g, ' ').trim() + (content.length > 42 ? '...' : '');
    }
  }

  await saveState();
  return message;
}

export async function recordMessageFeedback(state, agencyId, messageId, rating, feedbackNote = '', saveState) {
  state.records.ai_messages = state.records.ai_messages || [];
  const msg = state.records.ai_messages.find(m => m.id === messageId && m.agencyId === agencyId);
  if (!msg) return false;

  msg.feedback = {
    rating: rating === 'up' ? 'positive' : 'negative',
    note: feedbackNote,
    timestamp: new Date().toISOString()
  };

  await saveState();
  return true;
}
