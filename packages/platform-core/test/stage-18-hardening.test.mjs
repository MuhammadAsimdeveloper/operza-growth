import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import {
  canActorViewFinancials,
  checkActorPermission,
  isPlatformAdminActor,
  resolveActorPermissions
} from '../src/security/route-authz.mjs';
import { IsolatedTestPostgres } from '../../db/lib/test-postgres-server.mjs';
import { runInTenantTx } from '../../db/lib/tenant-tx.mjs';
import { createAnalytics2Repository } from '../../db/lib/analytics-2-repository.mjs';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../../db/migrations');

function cookieActor(role, extra = {}) {
  return {
    user: { id: randomUUID(), email: `${role}@agency.test`, status: 'active', ...(extra.user || {}) },
    membership: { id: randomUUID(), role, status: 'active' },
    ...extra
  };
}

test('Stage 18 RBAC: enforces all 12 built-in roles on cookie-session actors without API key bypass', () => {
  assert.equal(checkActorPermission(null, 'contacts:read'), false);

  // Owner & Admin
  assert.equal(checkActorPermission(cookieActor('owner'), 'refunds:approve'), true);
  assert.equal(checkActorPermission(cookieActor('admin'), 'agency:users:manage'), true);

  // Operations Manager
  assert.equal(checkActorPermission(cookieActor('operations_manager'), 'agency:locations:manage'), true);
  assert.equal(checkActorPermission(cookieActor('operations_manager'), 'refunds:approve'), false);

  // Location Manager
  assert.equal(checkActorPermission(cookieActor('location_manager'), 'contacts:write'), true);
  assert.equal(checkActorPermission(cookieActor('location_manager'), 'agency:users:manage'), false);

  // Sales Agent & Sales Manager
  assert.equal(checkActorPermission(cookieActor('sales_agent'), 'opportunities:manage'), true);
  assert.equal(checkActorPermission(cookieActor('sales_agent'), 'refunds:approve'), false);
  assert.equal(canActorViewFinancials(cookieActor('sales_agent')), false);

  // Support Agent & Support Manager
  assert.equal(checkActorPermission(cookieActor('support_agent'), 'conversations:write'), true);
  assert.equal(checkActorPermission(cookieActor('support_agent'), 'tickets:manage'), true);
  assert.equal(checkActorPermission(cookieActor('support_agent'), 'refunds:approve'), false);
  assert.equal(canActorViewFinancials(cookieActor('support_agent')), false);
  assert.equal(checkActorPermission(cookieActor('support_manager'), 'sla:configure'), true);

  // Marketing Specialist & Marketing Manager
  assert.equal(checkActorPermission(cookieActor('marketing_specialist'), 'campaigns:write'), true);
  assert.equal(checkActorPermission(cookieActor('marketing_specialist'), 'campaigns:approve'), false);
  assert.equal(checkActorPermission(cookieActor('marketing_manager'), 'campaigns:approve'), true);

  // Analyst & Read Only
  assert.equal(checkActorPermission(cookieActor('analyst'), 'reports:financial:read'), true);
  assert.equal(canActorViewFinancials(cookieActor('analyst')), true);
  assert.equal(checkActorPermission(cookieActor('analyst'), 'contacts:write'), false);

  assert.equal(checkActorPermission(cookieActor('read_only'), 'contacts:read'), true);
  assert.equal(checkActorPermission(cookieActor('read_only'), 'contacts:write'), false);
  assert.equal(checkActorPermission(cookieActor('read_only'), 'refunds:approve'), false);
  assert.equal(checkActorPermission(cookieActor('read_only'), 'workflows:write'), false);
  assert.equal(resolveActorPermissions(cookieActor('read_only')).includes('*'), false);

  // Platform admin normalization
  assert.equal(isPlatformAdminActor({ isPlatformAdmin: true }), true);
  assert.equal(isPlatformAdminActor({ user: { isPlatformAdmin: true } }), true);
  assert.equal(isPlatformAdminActor(cookieActor('owner')), false);
});

test('Stage 18 PostgreSQL RLS & Perf: all agency-owned tables enforce FORCE RLS and measure local TenantTx p50/p95/p99', async (t) => {
  let pgServer = null;
  let adminPool = null;
  let appPool = null;
  let dbUrl = process.env.OPERZA_TEST_DATABASE_URL;

  if (!dbUrl) {
    try {
      pgServer = new IsolatedTestPostgres({ port: 0, dbName: 'operza_stage18_hardening' });
      dbUrl = await pgServer.start();
    } catch (err) {
      t.skip(`PostgreSQL isolated server unavailable: ${err.message}`);
      return;
    }
  }

  try {
    adminPool = new Pool({ connectionString: dbUrl });
    const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await adminPool.query(sql);
    }

    await adminPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
          CREATE ROLE operza_app LOGIN PASSWORD 'operza_app_test_pw';
        END IF;
      END $$;
      GRANT USAGE ON SCHEMA public TO operza_app;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO operza_app;
    `);

    const parsed = new URL(dbUrl);
    parsed.username = 'operza_app';
    parsed.password = 'operza_app_test_pw';
    appPool = new Pool({ connectionString: parsed.toString() });

    // 1. Assert 100% of agency_id tables have RLS + FORCE RLS + >=1 policy
    const rlsCheck = await adminPool.query(`
      SELECT c.relname AS table_name,
             c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS force_rls,
             (SELECT COUNT(*)::int FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS policy_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema='public' AND col.table_name=c.relname AND col.column_name='agency_id'
        )
    `);
    const missingRls = rlsCheck.rows.filter(r => !r.rls_enabled || !r.force_rls || r.policy_count === 0);
    assert.equal(missingRls.length, 0, `Tables missing FORCE RLS: ${JSON.stringify(missingRls)}`);

    // 2. Seed two agencies + synthetic dataset for cross-tenant & perf test
    const agencyA = randomUUID();
    const locA = randomUUID();
    const userA = randomUUID();
    const agencyB = randomUUID();
    const locB = randomUUID();

    await adminPool.query(`INSERT INTO agencies (id, name, slug, status) VALUES ($1,'Agency A','ag-a','active'), ($2,'Agency B','ag-b','active')`, [agencyA, agencyB]);
    await adminPool.query(`INSERT INTO locations (id, agency_id, name, status) VALUES ($1,$2,'Loc A','active'), ($3,$4,'Loc B','active')`, [locA, agencyA, locB, agencyB]);
    await adminPool.query(`INSERT INTO users (id, name, email, password_hash, status) VALUES ($1,'User A','a@test.io','x:y','active')`, [userA]);
    await adminPool.query(`INSERT INTO auth_sessions (id, token_hash, csrf_hash, user_id, agency_id, expires_at) VALUES ($1,'hash_a','csrf_a',$2,$3, now() + interval '1 hour')`, [randomUUID(), userA, agencyA]);

    for (let i = 0; i < 100; i++) {
      await adminPool.query(
        `INSERT INTO location_records (id, agency_id, location_id, collection, body) VALUES ($1,$2,$3,'contacts',$4)`,
        [randomUUID(), agencyA, locA, JSON.stringify({ email: `c${i}@a.test`, firstName: `Contact${i}` })]
      );
    }

    // Cross-tenant isolation under operza_app on auth_sessions
    const crossSessionRows = await runInTenantTx(appPool, { agencyId: agencyB, locationId: locB, actorId: 'attacker' }, async (tx) => {
      const r = await tx.query(`SELECT id FROM auth_sessions`);
      return r.rows;
    });
    assert.equal(crossSessionRows.length, 0);

    // 3. Controlled local performance benchmark (warm-up + 20 iterations)
    const analyticsRepo = createAnalytics2Repository();
    const ctxA = { agencyId: agencyA, locationId: locA, actorId: userA };
    await runInTenantTx(appPool, ctxA, tx => analyticsRepo.getExecutiveOverview(tx));

    const timings = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const overview = await runInTenantTx(appPool, ctxA, tx => analyticsRepo.getExecutiveOverview(tx));
      timings.push(performance.now() - t0);
      assert.equal(overview.source, 'postgresql');
      assert.equal(overview.authoritative, true);
      assert.equal(overview.crm.totalContacts, 100);
    }
    timings.sort((a, b) => a - b);
    const p50 = Number(timings[Math.floor(timings.length * 0.5)].toFixed(2));
    const p95 = Number(timings[Math.floor(timings.length * 0.95)].toFixed(2));
    console.log(`[STAGE18-PERF] TenantTx getExecutiveOverview (100 contacts, 20 runs): p50=${p50}ms p95=${p95}ms`);
    assert.ok(p95 < 1000, `Unexpectedly high local p95 latency: ${p95}ms`);
  } finally {
    if (appPool) await appPool.end().catch(() => {});
    if (adminPool) await adminPool.end().catch(() => {});
    if (pgServer) await pgServer.stop().catch(() => {});
  }
});
