import { randomUUID } from 'node:crypto';
import { validatePageSchema, STARTER_TEMPLATES, buildConversionDedupKey } from '../../platform-core/src/sites-2-0.mjs';
import { createSiteVersionsRepository } from './site-versions-repository.mjs';

const versionsRepo = createSiteVersionsRepository();

function scope(tx, agencyId, locationId) {
  const a = agencyId || tx?.agencyId;
  const l = locationId || tx?.locationId;
  if (!a || !l) throw new Error('Sites2Repository requires agencyId and locationId');
  return { agencyId: a, locationId: l };
}

export function createSites2Repository() {
  return {
    async listSites(tx, { agencyId, locationId } = {}) {
      const s = scope(tx, agencyId, locationId);
      const res = await tx.query(
        `SELECT * FROM sites_2 WHERE agency_id = $1 AND location_id = $2 ORDER BY updated_at DESC`,
        [s.agencyId, s.locationId]
      );
      return res.rows;
    },

    async createSite(tx, input = {}) {
      const s = scope(tx, input.agencyId, input.locationId);
      const siteId = input.id || randomUUID();
      const slug = String(input.slug || input.name || 'site')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-');
      const res = await tx.query(
        `INSERT INTO sites_2 (
          agency_id, location_id, id, name, slug, status, branding, navigation, seo_defaults, created_by
        ) VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9)
        RETURNING *`,
        [
          s.agencyId,
          s.locationId,
          siteId,
          String(input.name || 'Untitled Site').trim(),
          slug,
          JSON.stringify(input.branding || {}),
          JSON.stringify(input.navigation || []),
          JSON.stringify(input.seoDefaults || {}),
          input.createdBy || tx?.actorId || 'system'
        ]
      );
      if (input.templateId) {
        const tpl = STARTER_TEMPLATES.find((t) => t.id === input.templateId);
        if (tpl) {
          for (const p of tpl.pages) {
            await this.savePageDraft(tx, { siteId, slug: p.slug, title: p.title, sections: p.sections });
          }
        }
      }
      return res.rows[0];
    },

    async listPages(tx, { agencyId, locationId, siteId } = {}) {
      const s = scope(tx, agencyId, locationId);
      const res = await tx.query(
        `SELECT * FROM site_pages_2 WHERE agency_id = $1 AND location_id = $2 AND site_id = $3 ORDER BY created_at ASC`,
        [s.agencyId, s.locationId, siteId]
      );
      return res.rows;
    },

    async savePageDraft(tx, { agencyId, locationId, siteId, pageId = null, slug = '/', title, description = '', sections = [], seoMeta = {}, expectedVersionLock = null } = {}) {
      const s = scope(tx, agencyId, locationId);
      const check = validatePageSchema({ slug, title, sections, seoMeta });
      if (!check.valid) {
        throw Object.assign(new Error(check.error), { code: check.code });
      }
      if (pageId && expectedVersionLock !== null) {
        const upd = await tx.query(
          `UPDATE site_pages_2
           SET slug = $4, title = $5, description = $6, sections = $7::jsonb, seo_meta = $8::jsonb,
               version_lock = version_lock + 1, updated_at = now()
           WHERE agency_id = $1 AND location_id = $2 AND id = $3 AND version_lock = $9
           RETURNING *`,
          [s.agencyId, s.locationId, pageId, slug, title, description, JSON.stringify(sections), JSON.stringify(seoMeta), Number(expectedVersionLock)]
        );
        if (upd.rowCount === 0) {
          throw Object.assign(new Error('Page was modified by another editor'), { code: 'VERSION_CONFLICT' });
        }
        return upd.rows[0];
      }
      const res = await tx.query(
        `INSERT INTO site_pages_2 (
          agency_id, location_id, id, site_id, slug, title, description, schema_version, sections, seo_meta, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,2,$8::jsonb,$9::jsonb,'draft')
        ON CONFLICT (agency_id, location_id, site_id, slug) DO UPDATE
          SET title = EXCLUDED.title,
              description = EXCLUDED.description,
              sections = EXCLUDED.sections,
              seo_meta = EXCLUDED.seo_meta,
              version_lock = site_pages_2.version_lock + 1,
              updated_at = now()
        RETURNING *`,
        [s.agencyId, s.locationId, pageId || randomUUID(), siteId, slug, title, description, JSON.stringify(sections), JSON.stringify(seoMeta)]
      );
      return res.rows[0];
    },

    async publishSite(tx, { agencyId, locationId, siteId, actorId = 'system' } = {}) {
      const s = scope(tx, agencyId, locationId);
      const pages = await this.listPages(tx, { agencyId: s.agencyId, locationId: s.locationId, siteId });
      for (const p of pages) {
        const check = validatePageSchema({ slug: p.slug, title: p.title, sections: p.sections, seoMeta: p.seo_meta });
        if (!check.valid) {
          throw Object.assign(new Error(`Page ${p.slug} failed publish validation: ${check.error}`), { code: check.code });
        }
      }
      const version = await versionsRepo.publishVersion(tx, {
        siteId,
        snapshot: { pages },
        seoMeta: {},
        actorId
      });
      await tx.query(
        `UPDATE sites_2
         SET status = 'published', published_version_id = $4, published_version_number = $5, updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
        [s.agencyId, s.locationId, siteId, version.id, version.version_number]
      );
      return version;
    },

    async rollbackSite(tx, { agencyId, locationId, siteId, versionNumber, actorId = 'system' } = {}) {
      const s = scope(tx, agencyId, locationId);
      const version = await versionsRepo.rollbackToVersion(tx, { siteId, versionNumber, actorId });
      await tx.query(
        `UPDATE sites_2
         SET status = 'published', published_version_id = $4, published_version_number = $5, updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
        [s.agencyId, s.locationId, siteId, version.id, version.version_number]
      );
      return version;
    },

    async recordConversionEvent(tx, { agencyId, locationId, siteId = null, funnelId = null, pageId = null, eventType, sessionKey = '', timestampBucket = '', sourceMetadata = {} } = {}) {
      const s = scope(tx, agencyId, locationId);
      const dedupKey = buildConversionDedupKey({ siteId: siteId || '', funnelId: funnelId || '', pageId: pageId || '', eventType, sessionKey, timestampBucket });
      const res = await tx.query(
        `INSERT INTO site_conversion_events (
          agency_id, location_id, id, site_id, funnel_id, page_id, event_type, dedup_key, source_metadata
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
        ON CONFLICT (agency_id, location_id, dedup_key) DO NOTHING
        RETURNING *`,
        [s.agencyId, s.locationId, randomUUID(), siteId, funnelId, pageId, eventType, dedupKey, JSON.stringify(sourceMetadata)]
      );
      return { recorded: res.rows.length > 0, event: res.rows[0] || null };
    }
  };
}
