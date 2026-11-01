/**
 * Operza Copilot — User & Workspace Memory System
 * Stores and retrieves user preferences and operational facts with strict tenant isolation.
 */

import { randomUUID } from 'crypto';

export function getAgencyMemories(state, agencyId, userId = null) {
  state.records.ai_memories = state.records.ai_memories || [];
  return state.records.ai_memories.filter(m => {
    if (m.agencyId !== agencyId) return false;
    if (userId && m.userId && m.userId !== userId) return false;
    return true;
  });
}

export async function addAgencyMemory(state, agencyId, userId, { key, content, category = 'preference' }, saveState) {
  state.records.ai_memories = state.records.ai_memories || [];

  const memory = {
    id: randomUUID(),
    agencyId,
    userId,
    key: (key || 'general_note').trim(),
    content: (content || '').trim(),
    category,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  state.records.ai_memories.unshift(memory);
  await saveState();
  return memory;
}

export async function deleteAgencyMemory(state, agencyId, memoryId, saveState) {
  state.records.ai_memories = state.records.ai_memories || [];
  const idx = state.records.ai_memories.findIndex(m => m.id === memoryId && m.agencyId === agencyId);
  if (idx === -1) return false;

  state.records.ai_memories.splice(idx, 1);
  await saveState();
  return true;
}

export function formatMemoriesForPrompt(memories = []) {
  if (!memories.length) return '';
  const lines = memories.map(m => `- [${m.category}] ${m.key}: ${m.content}`).join('\n');
  return `\n<user_memories>\nThe user has established the following persistent preferences and facts for this workspace:\n${lines}\n</user_memories>\n`;
}
