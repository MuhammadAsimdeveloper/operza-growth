/**
 * Phase 5 — PostgreSQL Knowledge Base & Hybrid Vector Repository
 * Enforces TenantTx boundaries, FORCE RLS, durable ingestion states,
 * source traceability, and tenant-isolated hybrid vector + lexical retrieval.
 */

import { createHash, randomUUID } from 'node:crypto';
import { cosineSimilarity } from '../../platform-core/src/copilot/rag-engine.mjs';

const ALLOWED_FILE_TYPES = new Set(['text', 'markdown', 'md', 'txt', 'faq', 'crm', 'url', 'pdf', 'docx']);
const MAX_CONTENT_BYTES = 2 * 1024 * 1024; // 2 MB

export function createKnowledgeBaseRepository() {
  return {
    async createSource(tx, {
      id = randomUUID(),
      title,
      fileType = 'text',
      content = '',
      metadata = {}
    } = {}) {
      if (!title || typeof title !== 'string' || !title.trim()) {
        throw Object.assign(new TypeError('Knowledge document title is required'), { code: 'INVALID_DOCUMENT_TITLE' });
      }
      const normalizedType = String(fileType || 'text').toLowerCase().trim();
      if (!ALLOWED_FILE_TYPES.has(normalizedType)) {
        throw Object.assign(new TypeError(`Unsupported file type: ${normalizedType}`), { code: 'UNSUPPORTED_FILE_TYPE' });
      }
      const rawContent = String(content || '').trim();
      if (!rawContent) {
        throw Object.assign(new TypeError('Knowledge document content cannot be empty'), { code: 'EMPTY_DOCUMENT' });
      }
      const sizeBytes = Buffer.byteLength(rawContent, 'utf8');
      if (sizeBytes > MAX_CONTENT_BYTES) {
        throw Object.assign(new TypeError('Knowledge document exceeds 2 MB size limit'), { code: 'DOCUMENT_TOO_LARGE' });
      }

      const checksum = createHash('sha256').update(rawContent).digest('hex');
      const wordsCount = rawContent.split(/\s+/).filter(Boolean).length;

      const res = await tx.query(
        `INSERT INTO ai_knowledge_sources (
          agency_id, location_id, id, title, file_type, size_bytes, checksum,
          status, chunks_count, words_count, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing', 0, $8, $9)
        RETURNING *`,
        [
          tx.agencyId,
          tx.locationId,
          id,
          title.trim(),
          normalizedType,
          sizeBytes,
          checksum,
          wordsCount,
          JSON.stringify(metadata || {})
        ]
      );
      return res.rows[0];
    },

    async indexChunks(tx, sourceId, chunks = [], {
      embeddingModel = 'operza-trigram-v1',
      embeddingVersion = '1',
      ingestionVersion = 1
    } = {}) {
      if (!Array.isArray(chunks) || chunks.length === 0) {
        await tx.query(
          `UPDATE ai_knowledge_sources
           SET status = 'failed', error_message = 'No chunks generated', updated_at = now()
           WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
          [tx.agencyId, tx.locationId, sourceId]
        );
        throw Object.assign(new Error('No chunks generated for document'), { code: 'EMPTY_CHUNKS' });
      }

      // Remove prior chunks if re-indexing
      await tx.query(
        `DELETE FROM ai_knowledge_chunks
         WHERE agency_id = $1 AND location_id = $2 AND source_id = $3`,
        [tx.agencyId, tx.locationId, sourceId]
      );

      for (let i = 0; i < chunks.length; i++) {
        const ch = chunks[i];
        const vec = Array.isArray(ch.vector) ? ch.vector : Array.from(ch.vector || []);
        await tx.query(
          `INSERT INTO ai_knowledge_chunks (
            agency_id, location_id, id, source_id, chunk_index, content,
            token_count, start_offset, end_offset, heading, page_number,
            embedding_model, embedding_version, embedding_dim, embedding_vector,
            ingestion_version, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            tx.agencyId,
            tx.locationId,
            ch.id || randomUUID(),
            sourceId,
            ch.index ?? i,
            ch.text,
            ch.tokenCount ?? Math.max(1, Math.ceil(ch.text.length / 4)),
            ch.startOffset ?? 0,
            ch.endOffset ?? ch.text.length,
            ch.heading || null,
            ch.pageNumber ?? null,
            embeddingModel,
            embeddingVersion,
            vec.length,
            vec,
            ingestionVersion,
            JSON.stringify(ch.metadata || {})
          ]
        );
      }

      const updated = await tx.query(
        `UPDATE ai_knowledge_sources
         SET status = 'ready', chunks_count = $4, ingestion_version = $5,
             error_message = NULL, updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND id = $3
         RETURNING *`,
        [tx.agencyId, tx.locationId, sourceId, chunks.length, ingestionVersion]
      );
      return updated.rows[0];
    },

    async markSourceFailed(tx, sourceId, errorMessage) {
      const res = await tx.query(
        `UPDATE ai_knowledge_sources
         SET status = 'failed', error_message = $4, updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND id = $3
         RETURNING *`,
        [tx.agencyId, tx.locationId, sourceId, String(errorMessage || 'Ingestion failed').slice(0, 500)]
      );
      return res.rows[0] || null;
    },

    async listSources(tx, { includeDeleted = false } = {}) {
      const sql = includeDeleted
        ? `SELECT * FROM ai_knowledge_sources WHERE agency_id = $1 AND location_id = $2 ORDER BY created_at DESC`
        : `SELECT * FROM ai_knowledge_sources WHERE agency_id = $1 AND location_id = $2 AND deleted_at IS NULL AND status != 'deleted' ORDER BY created_at DESC`;
      const res = await tx.query(sql, [tx.agencyId, tx.locationId]);
      return res.rows;
    },

    async softDeleteSource(tx, sourceId) {
      await tx.query(
        `DELETE FROM ai_knowledge_chunks
         WHERE agency_id = $1 AND location_id = $2 AND source_id = $3`,
        [tx.agencyId, tx.locationId, sourceId]
      );
      const res = await tx.query(
        `UPDATE ai_knowledge_sources
         SET status = 'deleted', deleted_at = now(), updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND id = $3
         RETURNING *`,
        [tx.agencyId, tx.locationId, sourceId]
      );
      return res.rows[0] || null;
    },

    async searchHybrid(tx, {
      query = '',
      queryVector = [],
      topK = 4,
      minScore = 0.08,
      sourceIds = null
    } = {}) {
      const params = [tx.agencyId, tx.locationId];
      let sourceFilter = '';
      if (Array.isArray(sourceIds) && sourceIds.length > 0) {
        params.push(sourceIds);
        sourceFilter = `AND c.source_id = ANY($${params.length}::uuid[])`;
      }

      const res = await tx.query(
        `SELECT c.id, c.source_id, c.chunk_index, c.content, c.start_offset, c.end_offset,
                c.heading, c.page_number, c.embedding_model, c.embedding_vector,
                s.title AS source_title, s.file_type AS source_type
         FROM ai_knowledge_chunks c
         JOIN ai_knowledge_sources s
           ON s.agency_id = c.agency_id AND s.location_id = c.location_id AND s.id = c.source_id
         WHERE c.agency_id = $1 AND c.location_id = $2
           AND s.status = 'ready' AND s.deleted_at IS NULL
           ${sourceFilter}`,
        params
      );

      const qTokens = String(query || '')
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 1);
      const qVec = Float32Array.from(queryVector || []);

      const scored = [];
      for (const row of res.rows) {
        const cVec = Float32Array.from(row.embedding_vector || []);
        const vecSim = qVec.length > 0 && cVec.length === qVec.length ? cosineSimilarity(qVec, cVec) : 0;

        const lower = String(row.content || '').toLowerCase();
        let lexHits = 0;
        for (const t of qTokens) {
          if (lower.includes(t)) lexHits++;
        }
        const lexScore = qTokens.length > 0 ? lexHits / qTokens.length : 0;
        const score = Number((vecSim * 0.55 + lexScore * 0.45).toFixed(4));
        if (score >= minScore) {
          scored.push({
            chunkId: row.id,
            sourceId: row.source_id,
            sourceTitle: row.source_title,
            sourceType: row.source_type,
            chunkIndex: row.chunk_index,
            content: row.content,
            startOffset: row.start_offset,
            endOffset: row.end_offset,
            heading: row.heading,
            pageNumber: row.page_number,
            embeddingModel: row.embedding_model,
            score
          });
        }
      }

      scored.sort((a, b) => b.score - a.score);
      // Deduplicate identical snippets
      const seen = new Set();
      const deduped = [];
      for (const item of scored) {
        const sig = item.content.slice(0, 120);
        if (seen.has(sig)) continue;
        seen.add(sig);
        deduped.push(item);
        if (deduped.length >= topK) break;
      }
      return deduped;
    }
  };
}
