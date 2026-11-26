/**
 * Phase 5 — Grounded RAG Pipeline & Prompt-Injection Defense
 * Provides offset-preserving chunking, durable ingestion orchestration,
 * untrusted-content sanitization, and citation-verified grounded retrieval.
 */

import { randomUUID } from 'node:crypto';

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /system\s*prompt\s*override/gi,
  /you\s+are\s+now\s+(root|admin|developer|unrestricted)/gi,
  /execute\s+tool\s*:/gi
];

export function sanitizeUntrustedText(text = '') {
  let clean = String(text || '');
  for (const re of INJECTION_PATTERNS) {
    clean = clean.replace(re, '[FILTERED_UNTRUSTED_DIRECTIVE]');
  }
  return clean;
}

export function chunkDocumentWithOffsets(content = '', { targetWords = 120, overlapWords = 20 } = {}) {
  const raw = String(content || '');
  if (!raw.trim()) return [];

  const chunks = [];
  const lines = raw.split(/\r?\n/);
  let currentHeading = null;
  let buffer = [];
  let bufferStart = 0;
  let cursor = 0;
  let chunkIndex = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,4}\s+/.test(trimmed)) {
      currentHeading = trimmed.replace(/^#{1,4}\s+/, '').trim();
    }

    const words = trimmed ? trimmed.split(/\s+/) : [];
    if (buffer.length + words.length > targetWords && buffer.length > 0) {
      const chunkText = buffer.join(' ');
      chunks.push({
        id: randomUUID(),
        index: chunkIndex++,
        text: chunkText,
        tokenCount: Math.max(1, Math.ceil(chunkText.length / 4)),
        startOffset: bufferStart,
        endOffset: cursor,
        heading: currentHeading,
        pageNumber: null
      });
      const tail = overlapWords > 0 ? buffer.slice(-overlapWords) : [];
      buffer = [...tail, ...words];
      bufferStart = Math.max(0, cursor - tail.join(' ').length);
    } else {
      if (buffer.length === 0) bufferStart = cursor;
      buffer.push(...words);
    }
    cursor += line.length + 1;
  }

  if (buffer.length > 0) {
    const chunkText = buffer.join(' ');
    chunks.push({
      id: randomUUID(),
      index: chunkIndex++,
      text: chunkText,
      tokenCount: Math.max(1, Math.ceil(chunkText.length / 4)),
      startOffset: bufferStart,
      endOffset: Math.min(raw.length, cursor),
      heading: currentHeading,
      pageNumber: null
    });
  }

  return chunks;
}

export async function ingestDocumentPipeline({
  tx,
  repository,
  providerGateway,
  title,
  fileType = 'text',
  content,
  metadata = {},
  embeddingProviderId = 'local_embeddings'
} = {}) {
  const source = await repository.createSource(tx, {
    title,
    fileType,
    content,
    metadata
  });

  try {
    const rawChunks = chunkDocumentWithOffsets(content);
    if (rawChunks.length === 0) {
      await repository.markSourceFailed(tx, source.id, 'Document produced zero chunks');
      throw Object.assign(new Error('Document produced zero chunks'), { code: 'EMPTY_DOCUMENT' });
    }

    let embeddingModel = 'operza-trigram-v1';
    let embeddingVersion = '1';
    const embeddedChunks = [];
    for (const ch of rawChunks) {
      const emb = await providerGateway.embedText(ch.text, { providerId: embeddingProviderId });
      embeddingModel = emb.model || embeddingModel;
      embeddingVersion = emb.version || embeddingVersion;
      embeddedChunks.push({
        ...ch,
        vector: emb.vector
      });
    }

    const readySource = await repository.indexChunks(tx, source.id, embeddedChunks, {
      embeddingModel,
      embeddingVersion
    });
    return { source: readySource, chunksCount: embeddedChunks.length };
  } catch (err) {
    await repository.markSourceFailed(tx, source.id, err?.message || 'Ingestion failed');
    throw err;
  }
}

export function buildUntrustedRagContext(chunks = []) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return 'No matching knowledge base sources found. If the answer requires workspace-specific facts, state clearly that the knowledge base does not contain this information.';
  }

  return chunks
    .map((ch, idx) => {
      const safeText = sanitizeUntrustedText(ch.content);
      return [
        `<untrusted_knowledge_source index="${idx + 1}" source_id="${ch.sourceId}" title="${ch.sourceTitle}" chunk_id="${ch.chunkId}" offset="${ch.startOffset}-${ch.endOffset}">`,
        safeText,
        `</untrusted_knowledge_source>`
      ].join('\n');
    })
    .join('\n\n');
}

export async function retrieveGroundedKnowledge({
  tx,
  repository,
  providerGateway,
  query,
  topK = 4,
  minScore = 0.08,
  sourceIds = null,
  embeddingProviderId = 'local_embeddings'
} = {}) {
  const emb = await providerGateway.embedText(query, { providerId: embeddingProviderId });
  const chunks = await repository.searchHybrid(tx, {
    query,
    queryVector: emb.vector,
    topK,
    minScore,
    sourceIds
  });

  if (chunks.length === 0) {
    return {
      answerable: false,
      citations: [],
      retrievedChunks: [],
      untrustedContext: buildUntrustedRagContext([])
    };
  }

  const citations = chunks.map((ch) => ({
    sourceId: ch.sourceId,
    sourceTitle: ch.sourceTitle,
    chunkId: ch.chunkId,
    chunkIndex: ch.chunkIndex,
    startOffset: ch.startOffset,
    endOffset: ch.endOffset,
    heading: ch.heading,
    score: ch.score
  }));

  return {
    answerable: true,
    citations,
    retrievedChunks: chunks,
    untrustedContext: buildUntrustedRagContext(chunks)
  };
}
