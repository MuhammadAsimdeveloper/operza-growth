import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import {
  BUILTIN_ROLE_TEMPLATES,
  assertOwnerProtected,
  computeOnboardingProgress,
  generateInvitationToken,
  hashInvitationToken,
  validateCustomRolePermissions,
  verifyInvitationRecord
} from '../src/agency-governance-2-0.mjs';
import { IsolatedTestPostgres } from '../../db/lib/test-postgres-server.mjs';
import { runInTenantTx } from '../../db/lib/tenant-tx.mjs';
import { createAgencyGovernanceRepository } from '../../db/lib/agency-governance-repository.mjs';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'packages/db/migrations');

test('Agency Governance 2.0: RBAC templates, privilege escalation guard, invitation tokens, owner protection & onboarding', () => {
  assert.ok(BUILTIN_ROLE_TEMPLATES.owner);
  assert.ok(BUILTIN_ROLE_TEMPLATES.read_only);

  // Privilege escalation prevention
  const esc1 = validateCustomRolePermissions({
    actorRole: 'admin',
    actorPermissions: BUILTIN_ROLE_TEMPLATES.admin.permissions,
    targetScope: 'location',
    requestedPermissions: ['agency:billing:manage']
  });
  assert.equal(esc1.valid, false);
  assert.equal(esc1.code, 'SCOPE_ESCALATION_DENIED');

  const esc2 = validateCustomRolePermissions({
    actorRole: 'support_agent',
    actorPermissions: BUILTIN_ROLE_TEMPLATES.support_agent.permissions,
    targetScope: 'location',
    requestedPermissions: ['refunds:approve']
  });
  assert.equal(esc2.valid, false);
  assert.equal(esc2.code, 'ESCALATION_DENIED');

  // Invitation token hashing & verification
  const { rawToken, tokenHash } = generateInvitationToken();
  assert.equal(hashInvitationToken(rawToken), tokenHash);
  assert.notEqual(rawToken, tokenHash);

  const future = new Date(Date.now() + 3600_000).toISOString();
  assert.equal(verifyInvitationRecord({ agency_id: 'a1', email: 'u@x.com', status: 'pending', expires_at: future }, { expectedAgencyId: 'a1', acceptingEmail: 'u@x.com' }).valid, true);
  assert.equal(verifyInvitationRecord({ agency_id: 'a1', email: 'u@x.com', status: 'pending', expires_at: future }, { expectedAgencyId: 'a2', acceptingEmail: 'u@x.com' }).code, 'INVITATION_AGENCY_MISMATCH');
  assert.equal(verifyInvitationRecord({ agency_id: 'a1', email: 'u@x.com', status: 'pending', expires_at: future }, { expectedAgencyId: 'a1', acceptingEmail: 'other@x.com' }).code, 'INVITATION_EMAIL_MISMATCH');
  assert.equal(verifyInvitationRecord({ agency_id: 'a1', email: 'u@x.com', status: 'accepted', expires_at: future }).code, 'INVITATION_ALREADY_ACCEPTED');

  // Last owner protection
  assert.throws(() => assertOwnerProtected({ activeOwnerCount: 1, targetCurrentRole: 'owner', deactivating: true }), { code: 'LAST_OWNER_PROTECTED' });

  // Onboarding progress
  const onb = computeOnboardingProgress({
    agency: { name: 'Acme', email: 'hi@acme.io', defaultTimezone: 'UTC', defaultCurrency: 'USD' },
    locations: [{ status: 'active' }],
    members: [{ id: '1' }],
    onboardingState: { completedSteps: [] }
  });
  assert.equal(onb.completedCount, 3);
  assert.equal(onb.percent, 60);
});

test('Agency Governance 2.0: PostgreSQL Migration 052, FORCE RLS, Locations, Invitations, Custom Roles & Offboarding', async (t) => {
  let pgServer = null;
  let adminPool = null;
  let appPool = null;
  let dbUrl = process.env.OPERZA_TEST_DATABASE_URL;

  if (!dbUrl) {
    try {
      pgServer = new IsolatedTestPostgres({ port: 0, dbName: 'operza_agency_gov_2_test' });
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
    `);
    await adminPool.query(`GRANT USAGE ON SCHEMA public TO operza_app`);
    await adminPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO operza_app`);

    const parsed = new URL(dbUrl);
    parsed.username = 'operza_app';
    parsed.password = 'operza_app_test_pw';
    appPool = new Pool({ connectionString: parsed.toString() });

    const agencyA = randomUUID();
    const locA = randomUUID();
    const agencyB = randomUUID();
    const locB = randomUUID();
    const ownerA = randomUUID();
    const inviteeA = randomUUID();

    await adminPool.query(`INSERT INTO agencies (id, name, slug) VALUES ($1, 'Gov A', $2), ($3, 'Gov B', $4)`, [
      agencyA, `gov-a-${agencyA.slice(0, 6)}`, agencyB, `gov-b-${agencyB.slice(0, 6)}`
    ]);
    await adminPool.query(`INSERT INTO locations (id, agency_id, name) VALUES ($1, $2, 'HQ A'), ($3, $4, 'HQ B')`, [
      locA, agencyA, locB, agencyB
    ]);
    await adminPool.query(
      `INSERT INTO users (id, name, email, password_hash) VALUES ($1, 'Owner A', $2, 'hash'), ($3, 'Invitee A', $4, 'hash')`,
      [ownerA, `owner-${ownerA.slice(0, 6)}@a.io`, inviteeA, `invitee-${inviteeA.slice(0, 6)}@a.io`]
    );
    await adminPool.query(
      `INSERT INTO agency_memberships (id, agency_id, user_id, role, status) VALUES ($1, $2, $3, 'owner', 'active')`,
      [randomUUID(), agencyA, ownerA]
    );
    await adminPool.query(
      `INSERT INTO auth_sessions (id, token_hash, csrf_hash, user_id, agency_id, expires_at)
       VALUES ($1, $2, 'csrf', $3, $4, now() + interval '1 day')`,
      [randomUUID(), `tok_${inviteeA}`, inviteeA, agencyA]
    );

    const repo = createAgencyGovernanceRepository();
    const ctxA = { agencyId: agencyA, locationId: locA, actorId: ownerA };
    const ctxB = { agencyId: agencyB, locationId: locB, actorId: ownerA };

    // 1. Cross-tenant isolation under FORCE RLS (operza_app)
    const locsB = await runInTenantTx(appPool, ctxB, tx => repo.listLocations(tx));
    assert.equal(locsB.length, 1);
    assert.equal(locsB[0].id, locB);

    // 2. Agency workspace update + duplicate slug check
    const updatedWs = await runInTenantTx(appPool, ctxA, tx =>
      repo.updateAgencyWorkspace(tx, { name: 'Gov A Updated', defaultTimezone: 'America/New_York', defaultCurrency: 'USD' })
    );
    assert.equal(updatedWs.name, 'Gov A Updated');
    await assert.rejects(
      () => runInTenantTx(appPool, ctxA, tx => repo.updateAgencyWorkspace(tx, { slug: `gov-b-${agencyB.slice(0, 6)}` })),
      { code: 'DUPLICATE_WORKSPACE_SLUG' }
    );

    // 3. Multi-location create, archive, restore
    const loc2 = await runInTenantTx(appPool, ctxA, tx => repo.createLocation(tx, { name: 'Branch West', timezone: 'America/Los_Angeles' }));
    const archived = await runInTenantTx(appPool, ctxA, tx => repo.setLocationStatus(tx, loc2.id, 'inactive'));
    assert.equal(archived.status, 'inactive');
    const restored = await runInTenantTx(appPool, ctxA, tx => repo.setLocationStatus(tx, loc2.id, 'active'));
    assert.equal(restored.status, 'active');

    // 4. Invitation creation, single-use acceptance, and replay prevention
    const inviteEmail = `invitee-${inviteeA.slice(0, 6)}@a.io`;
    const { rawToken } = await runInTenantTx(appPool, ctxA, tx =>
      repo.createInvitation(tx, { email: inviteEmail, role: 'member', locationIds: [locA], invitedBy: ownerA })
    );
    const accepted = await runInTenantTx(appPool, ctxA, tx =>
      repo.acceptInvitation(tx, { rawToken, acceptingUserId: inviteeA, acceptingEmail: inviteEmail })
    );
    assert.equal(accepted.success, true);

    await assert.rejects(
      () => runInTenantTx(appPool, ctxA, tx => repo.acceptInvitation(tx, { rawToken, acceptingUserId: inviteeA, acceptingEmail: inviteEmail })),
      { code: 'INVITATION_ALREADY_ACCEPTED' }
    );

    // 5. Location-scoped access enforcement
    const hasLocA = await runInTenantTx(appPool, ctxA, tx => repo.assertUserHasLocationAccess(tx, { userId: inviteeA, locationId: locA }));
    const hasLoc2 = await runInTenantTx(appPool, ctxA, tx => repo.assertUserHasLocationAccess(tx, { userId: inviteeA, locationId: loc2.id }));
    assert.equal(hasLocA, true);
    assert.equal(hasLoc2, false);

    // 6. Custom role creation & escalation block
    const customRole = await runInTenantTx(appPool, ctxA, tx =>
      repo.createCustomRole(tx, {
        name: 'Branch Support Lead',
        scope: 'location',
        permissions: ['contacts:read', 'conversations:read'],
        actorRole: 'owner',
        actorPermissions: ['*'],
        actorId: ownerA
      })
    );
    assert.equal(customRole.scope, 'location');

    // 7. Offboarding revokes sessions & protects last owner
    await assert.rejects(
      () => runInTenantTx(appPool, ctxA, tx => repo.offboardMember(tx, { userId: ownerA, actorId: ownerA })),
      { code: 'LAST_OWNER_PROTECTED' }
    );
    const offboarded = await runInTenantTx(appPool, ctxA, tx => repo.offboardMember(tx, { userId: inviteeA, actorId: ownerA }));
    assert.equal(offboarded.success, true);
    assert.equal(offboarded.revokedSessionsCount, 1);
  } finally {
    if (appPool) await appPool.end().catch(() => {});
    if (adminPool) await adminPool.end().catch(() => {});
    if (pgServer) await pgServer.stop().catch(() => {});
  }
});
