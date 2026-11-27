/**
 * ============================================================================
 * Operza RAG & Knowledge Intelligence 2.0
 * ============================================================================
 * Adds magic-byte/MIME upload verification, hybrid keyword+semantic retrieval
 * with context-window token budgeting, deleted/tenant filtering, and source
 * conflict detection.
 */

import { sanitizeUntrustedText } from './rag.mjs';

const SUPPORTED_FORMATS = new Set(['text/plain', 'text/markdown', 'text/csv', 'text/html', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

export function validateDocumentUpload({ buffer, declaredMime = 'text/plain', filename = 'doc.txt', maxBytes = 5_000_000 } = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ''), 'utf8');
  if (buf.length === 0 || buf.length > maxBytes) {
    return { valid: false, code: 'INVALID_UPLOAD_SIZE', message: `Document size must be 1-${maxBytes} bytes` };
  }
  const headHex = buf.subarray(0, 4).toString('hex').toLowerCase();
  const isPdfMagic = headHex === '25504446'; // %PDF
  const isZipMagic = headHex === '504b0304'; // PK.. (DOCX/ZIP)

  if (declaredMime === 'application/pdf' && !isPdfMagic) {
    return { valid: false, code: 'MIME_SIGNATURE_MISMATCH', message: 'File content does not match PDF signature' };
  }
  if (declaredMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && !isZipMagic) {
    return { valid: false, code: 'MIME_SIGNATURE_MISMATCH', message: 'File content does not match DOCX/ZIP signature' };
  }
  if (!SUPPORTED_FORMATS.has(declaredMime)) {
    return { valid: false, code: 'UNSUPPORTED_DOCUMENT_TYPE', message: `Unsupported MIME type: ${declaredMime}` };
  }
  if (/\.(exe|bat|cmd|sh|ps1|dll|js|mjs)$/i.test(String(filename))) {
    return { valid: false, code: 'FORBIDDEN_FILE_EXTENSION', message: 'Executable file extensions are forbidden' };
  }
  return { valid: true, detectedSize: buf.length, mime: declaredMime };
}

export function hybridRetrieveWithBudget({
  query = '',
  chunks = [],
  agencyId,
  locationId,
  maxTokensBudget = 1200,
  topK = 5
} = {}) {
  const terms = String(query || '').toLowerCase().split(/\W+/).filter(t => t.length >= 2);
  const scored = [];
  const seenContent = new Set();

  for (const chunk of chunks) {
    if (!chunk || chunk.deletedAt || chunk.sourceStatus === 'deleted') continue;
    if (String(chunk.agencyId) !== String(agencyId) || String(chunk.locationId) !== String(locationId)) continue;
    const cleanText = sanitizeUntrustedText(chunk.content || '');
    if (seenContent.has(cleanText)) continue;
    seenContent.add(cleanText);

    const lower = cleanText.toLowerCase();
    let keywordHits = 0;
    for (const term of terms) {
      if (lower.includes(term)) keywordHits += 1;
    }
    const keywordScore = terms.length > 0 ? keywordHits / terms.length : 0;
    const semanticScore = Number(chunk.semanticScore) || 0;
    const score = Number((0.6 * keywordScore + 0.4 * semanticScore).toFixed(4));
    if (score > 0) {
      scored.push({
        chunkId: chunk.id,
        sourceId: chunk.sourceId,
        title: chunk.title || 'Workspace Document',
        heading: chunk.heading || null,
        pageNumber: chunk.pageNumber || null,
        score,
        tokenCount: Math.max(1, Number(chunk.tokenCount) || Math.ceil(cleanText.length / 4)),
        content: cleanText
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  const selected = [];
  let usedTokens = 0;
  for (const item of scored) {
    if (selected.length >= topK) break;
    if (usedTokens + item.tokenCount > maxTokensBudget && selected.length > 0) break;
    selected.push(item);
    usedTokens += item.tokenCount;
  }

  return {
    matches: selected,
    usedTokens,
    insufficientEvidence: selected.length === 0,
    citations: selected.map(s => ({
      sourceId: s.sourceId,
      chunkId: s.chunkId,
      title: s.title,
      heading: s.heading,
      pageNumber: s.pageNumber,
      score: s.score
    }))
  };
}

export function detectSourceConflicts(matches = []) {
  const conflicts = [];
  const numRe = /\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)|\b(\d{1,4})\s*(days|hours|minutes|percent|%)\b/gi;
  const valuesBySource = [];

  for (const m of matches) {
    const nums = [];
    let match;
    while ((match = numRe.exec(m.content || '')) !== null) {
      nums.push(match[0].toLowerCase().trim());
    }
    if (nums.length > 0) {
      valuesBySource.push({ sourceId: m.sourceId, title: m.title, values: nums });
    }
  }

  if (valuesBySource.length >= 2) {
    const first = valuesBySource[0];
    for (let i = 1; i < valuesBySource.length; i += 1) {
      const other = valuesBySource[i];
      if (first.sourceId !== other.sourceId && first.values.join(',') !== other.values.join(',')) {
        conflicts.push({
          sourceA: first.sourceId,
          sourceB: other.sourceId,
          valuesA: first.values,
          valuesB: other.values
        });
      }
    }
  }
  return conflicts;
}
