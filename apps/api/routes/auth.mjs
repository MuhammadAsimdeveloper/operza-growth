/**
 * ============================================================================
 * Operza Authentication & Session Routes
 * ============================================================================
 */

import { randomInt } from 'node:crypto';
import { verifyGoogleIdToken } from '../lib/google-auth.mjs';

export async function handleAuthRoutes(req, res, ctx) {
  const {
    method,
    pathname,
    readBody,
    sendJson,
    state,
    saveState,
    auditLog,
    scrypt,
    randomBytes,
    randomUUID,
    hash,
    safeEqual,
    setSessionCookies,
    clearSessionCookies,
    getActor,
    pgPool,
    cookieSession,
    isStagingOrProd = process.env.NODE_ENV === 'staging' || process.env.NODE_ENV === 'production',
    platformDbEnabled = process.env.PLATFORM_DB_ENABLED === 'true'
  } = ctx;

  // 1. AUTH: Signup
  if (method === 'POST' && pathname === '/api/auth/signup') {
    const body = await readBody(req);
    const { name, email, password, agencyName } = body;
    if (!name || !email || !password) {
      sendJson(res, 400, { error: 'Name, email, and password required' });
      return true;
    }

    const emailKey = email.toLowerCase().trim();
    if (state.users.some(u => u.email === emailKey)) {
      sendJson(res, 409, { error: 'An account with this email already exists' });
      return true;
    }

    const salt = randomBytes(16);
    const passBuf = await scrypt(password, salt, 64);
    const passwordHash = `${salt.toString('hex')}:${passBuf.toString('hex')}`;

    const userId = randomUUID();
    const agencyId = randomUUID();
    const locationId = randomUUID();

    const user = { id: userId, name: name.trim(), email: emailKey, passwordHash, status: 'active', createdAt: new Date().toISOString() };
    const agency = { id: agencyId, name: (agencyName || `${name.trim()}'s Agency`).trim(), slug: emailKey.split('@')[0], status: 'active', createdAt: new Date().toISOString() };
    const location = { id: locationId, agencyId, name: 'Main Workspace', timezone: 'UTC', status: 'active', createdAt: new Date().toISOString() };
    const membership = { id: randomUUID(), agencyId, userId, role: 'owner', status: 'active', createdAt: new Date().toISOString() };

    state.users.push(user);
    state.agencies.push(agency);
    state.locations.push(location);
    state.memberships.push(membership);

    // Seed tenant defaults (Calendar, Payment Link, Public Form, Pipeline)
    state.records.calendars = state.records.calendars || [];
    const defaultCalId = randomUUID();
    state.records.calendars.push({
      id: defaultCalId,
      agencyId,
      locationId,
      name: 'Discovery & Strategy Session',
      slug: 'discovery-strategy',
      color: '#6366f1',
      durationMin: 30,
      description: '30-minute discovery call to evaluate automation requirements and team fit.',
      status: 'active',
      roundRobin: true,
      availability: [
        { weekday: 1, start: '09:00', end: '17:00' },
        { weekday: 2, start: '09:00', end: '17:00' },
        { weekday: 3, start: '09:00', end: '17:00' },
        { weekday: 4, start: '09:00', end: '17:00' },
        { weekday: 5, start: '09:00', end: '17:00' }
      ],
      createdAt: new Date().toISOString()
    });

    state.records.paymentLinks = state.records.paymentLinks || [];
    state.records.paymentLinks.push({
      id: randomUUID(),
      agencyId,
      locationId,
      name: 'Growth Retainer - Starter Pack',
      slug: 'starter-retainer',
      amount: 1500,
      currency: 'USD',
      productIds: [],
      visits: 0,
      conversions: 0,
      active: true,
      description: 'Full-service automation retainer including workflow builds, CRM setup, and AI copilot agents.',
      createdAt: new Date().toISOString()
    });

    state.records.forms = state.records.forms || [];
    state.records.forms.push({
      id: randomUUID(),
      agencyId,
      locationId,
      name: 'Inbound Consultation Request',
      publicSlug: 'contact-us',
      fields: ['firstName', 'lastName', 'email', 'phone', 'company', 'projectDetails'],
      status: 'published',
      submissions: 0,
      description: 'Book your strategy consultation with our growth engineering team.',
      createdAt: new Date().toISOString()
    });

    state.records.pipelines = state.records.pipelines || [];
    state.records.pipelines.push({
      id: randomUUID(),
      agencyId,
      locationId,
      name: 'Lead Pipeline',
      stages: ['New Inbound Lead', 'Discovery Call Booked', 'Proposal Sent', 'Won', 'Lost'],
      status: 'active',
      description: 'Primary customer acquisition pipeline',
      createdAt: new Date().toISOString()
    });

    state.records.workflows = state.records.workflows || [];
    state.records.workflows.push({
      id: randomUUID(),
      agencyId,
      locationId,
      name: 'Automated Lead Qualification & AI Scoring',
      description: 'Auto-scores new leads with Copilot AI, applies qualification tags, and creates team follow-up tasks.',
      status: 'published',
      triggerType: 'form',
      triggerConfig: { formName: 'contact-us' },
      nodes: [
        {
          id: 'node-ai-score',
          name: 'AI Lead Evaluation',
          type: 'ai_agent',
          config: { prompt: 'Analyze lead data and score purchase intent from 1 to 100.' }
        },
        {
          id: 'node-tag',
          name: 'Apply High-Intent Tag',
          type: 'tag',
          config: { tag: 'ai-qualified' }
        },
        {
          id: 'node-task',
          name: 'Create Priority Outreach Task',
          type: 'task',
          config: { title: 'High-Intent Lead Review', priority: 'high', dueInDays: 1 }
        },
        {
          id: 'node-approval',
          name: 'Executive Proposal Gate',
          type: 'condition',
          requiresApproval: true,
          config: { message: 'Review enterprise proposal before final transmission' }
        }
      ],
      createdAt: new Date().toISOString()
    });

    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(24).toString('hex');
    const sessionId = randomUUID();
    const tokenHash = hash(token);
    const csrfHash = hash(csrf);
    const expiresAtMs = Date.now() + 12 * 3600 * 1000;
    state.sessions.push({
      id: sessionId,
      tokenHash,
      csrfHash,
      userId,
      agencyId,
      expiresAt: expiresAtMs
    });

    if (pgPool) {
      const authClient = await pgPool.connect();
      try {
        await authClient.query('BEGIN');
        await authClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.user_id', $2, true)", [agencyId, userId]);
        await authClient.query(
          'INSERT INTO agencies (id, name, slug, status) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
          [agencyId, agency.name, agency.slug, 'active']
        );
        await authClient.query(
          'INSERT INTO users (id, name, email, password_hash, status) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING',
          [userId, user.name, user.email, user.passwordHash, 'active']
        );
        await authClient.query(
          'INSERT INTO agency_memberships (id, agency_id, user_id, role, status) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (agency_id, user_id) DO NOTHING',
          [membership.id, agencyId, userId, membership.role || 'owner', 'active']
        );
        await authClient.query(
          'INSERT INTO locations (id, agency_id, name, status) VALUES ($1, $2, $3, $4) ON CONFLICT (agency_id, id) DO NOTHING',
          [locationId, agencyId, location.name, 'active']
        );
        await authClient.query(
          'INSERT INTO auth_sessions (id, token_hash, csrf_hash, user_id, agency_id, expires_at) VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0)) ON CONFLICT (token_hash) DO NOTHING',
          [sessionId, tokenHash, csrfHash, userId, agencyId, expiresAtMs]
        );
        await authClient.query('COMMIT');
      } catch (dbErr) {
        await authClient.query('ROLLBACK').catch(() => {});
        if (isStagingOrProd || platformDbEnabled) {
          sendJson(res, 500, { error: 'Failed to persist session to database: ' + dbErr.message, code: 'DATABASE_SESSION_WRITE_FAILED' });
          return true;
        }
        console.warn('[AUTH-PG-SYNC] Failed to write auth record to PostgreSQL:', dbErr.message);
      } finally {
        authClient.release();
      }
    }

    setSessionCookies(res, token, csrf);
    await saveState();
    auditLog('auth.signup', { user, agency, membership, locations: [location], activeLocation: location }, { email: emailKey });

    sendJson(res, 201, {
      user: { id: user.id, name: user.name, email: user.email },
      agency: { id: agency.id, name: agency.name },
      locations: [location],
      activeLocationId: location.id
    });
    return true;
  }

  // 2. AUTH: Google Sign-In & Sign-Up (Cryptographic RS256 Verification)
  if (method === 'POST' && pathname === '/api/auth/google') {
    const body = await readBody(req);
    const idToken = body?.credential || body?.idToken;
    if (!idToken || typeof idToken !== 'string') {
      sendJson(res, 400, { error: 'Google ID token (credential or idToken) is required' });
      return true;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      sendJson(res, 503, { error: 'Google Sign-In is not configured on this server' });
      return true;
    }

    let verifiedPayload;
    try {
      verifiedPayload = await verifyGoogleIdToken(idToken, clientId);
    } catch (err) {
      sendJson(res, 401, { error: 'Invalid or unverified Google token', details: err.message });
      return true;
    }

    const emailKey = verifiedPayload.email;
    let user = state.users.find(u => u.email === emailKey);
    let agency, location, membership;

    if (!user) {
      const userId = randomUUID();
      const agencyId = randomUUID();
      const locationId = randomUUID();

      user = {
        id: userId,
        name: (verifiedPayload.name || emailKey.split('@')[0]).trim(),
        email: emailKey,
        avatar: verifiedPayload.picture || null,
        googleId: verifiedPayload.sub,
        provider: 'google',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      agency = {
        id: agencyId,
        name: `${user.name}'s Agency`,
        slug: emailKey.split('@')[0],
        status: 'active',
        createdAt: new Date().toISOString()
      };

      location = {
        id: locationId,
        agencyId,
        name: 'Main Workspace',
        timezone: 'UTC',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      membership = {
        id: randomUUID(),
        agencyId,
        userId,
        role: 'owner',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      state.users.push(user);
      state.agencies.push(agency);
      state.locations.push(location);
      state.memberships.push(membership);

      state.records.pipelines = state.records.pipelines || [];
      state.records.pipelines.push({
        id: randomUUID(),
        agencyId,
        locationId,
        name: 'Lead Pipeline',
        stages: ['New Lead', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost'],
        status: 'active',
        description: 'Primary customer acquisition pipeline',
        createdAt: new Date().toISOString()
      });
    } else {
      // Account takeover prevention:
      // If account was created with password authentication and has no linked googleId,
      // prevent silent automatic account takeover.
      if (user.passwordHash && user.provider !== 'google' && (!user.googleId || user.googleId !== verifiedPayload.sub)) {
        sendJson(res, 409, {
          error: 'An account with this email already exists with password authentication. Please log in with password first to link Google Sign-In.'
        });
        return true;
      }

      if (user.googleId && user.googleId !== verifiedPayload.sub) {
        sendJson(res, 403, { error: 'Google identity mismatch for this account' });
        return true;
      }

      if (!user.googleId) {
        user.googleId = verifiedPayload.sub;
      }

      membership = state.memberships.find(m => m.userId === user.id && m.status === 'active');
      agency = state.agencies.find(a => a.id === membership?.agencyId && a.status === 'active') || state.agencies[0];
      const locs = state.locations.filter(l => l.agencyId === agency?.id && l.status === 'active');
      location = locs[0] || state.locations[0];
    }

    const locations = state.locations.filter(l => l.agencyId === agency.id && l.status === 'active');
    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(24).toString('hex');
    const sessionId = randomUUID();
    const tokenHash = hash(token);
    const csrfHash = hash(csrf);
    const expiresAtMs = Date.now() + 12 * 3600 * 1000;
    state.sessions.push({
      id: sessionId,
      tokenHash,
      csrfHash,
      userId: user.id,
      agencyId: agency.id,
      expiresAt: expiresAtMs
    });

    if (pgPool) {
      try {
        await pgPool.query(
          'INSERT INTO auth_sessions (id, token_hash, csrf_hash, user_id, agency_id, expires_at) VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0)) ON CONFLICT (token_hash) DO NOTHING',
          [sessionId, tokenHash, csrfHash, user.id, agency.id, expiresAtMs]
        );
      } catch (dbErr) {
        if (isStagingOrProd || platformDbEnabled) {
          sendJson(res, 500, { error: 'Failed to persist session to database: ' + dbErr.message, code: 'DATABASE_SESSION_WRITE_FAILED' });
          return true;
        }
        console.warn('[AUTH-LOGIN-PG] Failed to write session to PostgreSQL:', dbErr.message);
      }
    }

    setSessionCookies(res, token, csrf);
    await saveState();
    auditLog('auth.google', { user, agency, membership, locations, activeLocation: location }, { email: emailKey });

    sendJson(res, 200, {
      user: { id: user.id, name: user.name, email: user.email },
      agency: { id: agency.id, name: agency.name },
      locations,
      activeLocationId: location?.id || locations[0]?.id
    });
    return true;
  }

  // 3. AUTH: Request Magic Link / OTP Code
  if (method === 'POST' && pathname === '/api/auth/magic-link') {
    const body = await readBody(req);
    const email = (body.email || '').toLowerCase().trim();
    if (!email || !email.includes('@')) {
      sendJson(res, 400, { error: 'Valid email address is required' });
      return true;
    }

    state.otps = state.otps || {};
    const existing = state.otps[email];
    const now = Date.now();

    // Anti-abuse rate limiting: max 1 request every 15 seconds per email
    if (existing && existing.lastRequestedAt && (now - existing.lastRequestedAt < 15_000)) {
      sendJson(res, 429, { error: 'Please wait before requesting another verification code' });
      return true;
    }

    // Cryptographically secure 6-digit random code
    const code = String(randomInt(100000, 1000000));
    const salt = randomBytes(16).toString('hex');
    const codeHash = hash(`${salt}:${code}`);

    state.otps[email] = {
      salt,
      codeHash,
      attempts: 0,
      maxAttempts: 3,
      createdAt: now,
      lastRequestedAt: now,
      expiresAt: now + 10 * 60 * 1000
    };

    // Isolated test sink strictly enabled in test mode for automated test suites
    if (process.env.NODE_ENV === 'test') {
      globalThis.__testLastOtp = { email, code };
      if (process.env.TEST_OTP_SINK_FILE) {
        try {
          const { writeFileSync } = await import('node:fs');
          writeFileSync(process.env.TEST_OTP_SINK_FILE, JSON.stringify({ email, code }), 'utf8');
        } catch {}
      }
    }

    // NEVER leak code, devCode, or OTP in HTTP responses or operational logs!
    sendJson(res, 200, {
      success: true,
      message: 'If an account exists or is eligible, a verification code has been dispatched.'
    });
    return true;
  }

  // 4. AUTH: Verify OTP Code
  if (method === 'POST' && pathname === '/api/auth/verify-otp') {
    const body = await readBody(req);
    const emailKey = (body.email || '').toLowerCase().trim();
    const code = String(body.code || '').trim();
    const name = (body.name || '').trim();

    state.otps = state.otps || {};
    const record = state.otps[emailKey];
    if (!record || Date.now() > record.expiresAt) {
      if (record) delete state.otps[emailKey];
      sendJson(res, 400, { error: 'Invalid or expired verification code' });
      return true;
    }

    // Attempt lockout protection
    if (record.attempts >= record.maxAttempts) {
      delete state.otps[emailKey];
      sendJson(res, 400, { error: 'Verification code expired due to too many failed attempts' });
      return true;
    }

    const testHash = hash(`${record.salt}:${code}`);
    const matches = safeEqual(testHash, record.codeHash);

    if (!matches) {
      record.attempts++;
      if (record.attempts >= record.maxAttempts) {
        delete state.otps[emailKey];
      }
      sendJson(res, 400, { error: 'Invalid or expired verification code' });
      return true;
    }

    // One-time use: delete code immediately to prevent replay attacks
    delete state.otps[emailKey];

    let user = state.users.find(u => u.email === emailKey);
    let agency, location, membership;

    if (!user) {
      const userId = randomUUID();
      const agencyId = randomUUID();
      const locationId = randomUUID();

      const salt = randomBytes(16);
      const passBuf = await scrypt(randomUUID(), salt, 64);
      const passwordHash = `${salt.toString('hex')}:${passBuf.toString('hex')}`;

      user = {
        id: userId,
        name: name || emailKey.split('@')[0],
        email: emailKey,
        passwordHash,
        status: 'active',
        provider: 'otp',
        createdAt: new Date().toISOString()
      };

      agency = {
        id: agencyId,
        name: `${user.name}'s Agency`,
        slug: emailKey.split('@')[0],
        status: 'active',
        createdAt: new Date().toISOString()
      };

      location = {
        id: locationId,
        agencyId,
        name: 'Main Workspace',
        timezone: 'UTC',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      membership = {
        id: randomUUID(),
        agencyId,
        userId,
        role: 'owner',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      state.users.push(user);
      state.agencies.push(agency);
      state.locations.push(location);
      state.memberships.push(membership);

      state.records.pipelines = state.records.pipelines || [];
      state.records.pipelines.push({
        id: randomUUID(),
        agencyId,
        locationId,
        name: 'Lead Pipeline',
        stages: ['New Lead', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost'],
        status: 'active',
        description: 'Primary customer acquisition pipeline',
        createdAt: new Date().toISOString()
      });
    } else {
      membership = state.memberships.find(m => m.userId === user.id && m.status === 'active');
      agency = state.agencies.find(a => a.id === membership?.agencyId && a.status === 'active') || state.agencies[0];
      const locs = state.locations.filter(l => l.agencyId === agency?.id && l.status === 'active');
      location = locs[0] || state.locations[0];
    }

    const locations = state.locations.filter(l => l.agencyId === agency.id && l.status === 'active');
    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(24).toString('hex');
    const sessionId = randomUUID();
    const tokenHash = hash(token);
    const csrfHash = hash(csrf);
    const expiresAtMs = Date.now() + 12 * 3600 * 1000;
    state.sessions.push({
      id: sessionId,
      tokenHash,
      csrfHash,
      userId: user.id,
      agencyId: agency.id,
      expiresAt: expiresAtMs
    });

    if (pgPool) {
      try {
        await pgPool.query(
          'INSERT INTO auth_sessions (id, token_hash, csrf_hash, user_id, agency_id, expires_at) VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0)) ON CONFLICT (token_hash) DO NOTHING',
          [sessionId, tokenHash, csrfHash, user.id, agency.id, expiresAtMs]
        );
      } catch (dbErr) {
        if (isStagingOrProd || platformDbEnabled) {
          sendJson(res, 500, { error: 'Failed to persist session to database: ' + dbErr.message, code: 'DATABASE_SESSION_WRITE_FAILED' });
          return true;
        }
        console.warn('[AUTH-LOGIN-PG] Failed to write session to PostgreSQL:', dbErr.message);
      }
    }

    setSessionCookies(res, token, csrf);
    await saveState();
    auditLog('auth.otp_login', { user, agency, membership, locations, activeLocation: location }, { email: emailKey });

    sendJson(res, 200, {
      user: { id: user.id, name: user.name, email: user.email },
      agency: { id: agency.id, name: agency.name },
      locations,
      activeLocationId: location?.id || locations[0]?.id
    });
    return true;
  }

  // 5. AUTH: Login
  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await readBody(req);
    const { email, password } = body;
    const emailKey = String(email || '').toLowerCase().trim();

    let user = state.users.find(u => u.email === emailKey && u.status === 'active');

    // Authoritative user credential lookup via security-definer function in PostgreSQL
    if (pgPool) {
      try {
        const uRes = await pgPool.query('SELECT id, name, email, password_hash, status FROM lookup_user_for_auth($1)', [emailKey]);
        if (uRes.rows.length > 0) {
          const dbUser = uRes.rows[0];
          if (!user) {
            user = { id: dbUser.id, name: dbUser.name, email: dbUser.email, passwordHash: dbUser.password_hash, status: dbUser.status };
            state.users.push(user);
          } else {
            user.passwordHash = dbUser.password_hash;
          }
        }
      } catch (err) {
        console.warn('[AUTH-LOGIN-PG] lookup_user_for_auth failed:', err.message);
      }
    }

    if (!user || !user.passwordHash) {
      sendJson(res, 401, { error: 'Invalid email or password' });
      return true;
    }

    const [saltHex, keyHex] = user.passwordHash.split(':');
    const testBuf = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
    if (!safeEqual(testBuf.toString('hex'), keyHex)) {
      sendJson(res, 401, { error: 'Invalid email or password' });
      return true;
    }

    let membership = state.memberships.find(m => m.userId === user.id && m.status === 'active');
    let agency = membership ? state.agencies.find(a => a.id === membership.agencyId && a.status === 'active') : null;
    let locations = agency ? state.locations.filter(l => l.agencyId === agency.id && l.status === 'active') : [];

    // If membership, agency, or locations are not cached in local memory, resolve authoritatively from PostgreSQL
    if ((!membership || !agency || locations.length === 0) && pgPool) {
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        const memRes = await client.query(
          'SELECT id, agency_id, user_id, role, status FROM agency_memberships WHERE user_id = $1 AND status = \'active\' LIMIT 1',
          [user.id]
        );
        if (memRes.rows.length > 0) {
          const mRow = memRes.rows[0];
          membership = { id: mRow.id, agencyId: mRow.agency_id, userId: mRow.user_id, role: mRow.role, status: mRow.status };
          state.memberships.push(membership);

          await client.query("SELECT set_config('app.agency_id', $1, true)", [mRow.agency_id]);

          const agRes = await client.query('SELECT id, name, slug, status FROM agencies WHERE id = $1', [mRow.agency_id]);
          if (agRes.rows.length > 0) {
            const aRow = agRes.rows[0];
            agency = { id: aRow.id, name: aRow.name, slug: aRow.slug, status: aRow.status };
            state.agencies.push(agency);
          }

          const locRes = await client.query('SELECT id, agency_id, name, status FROM locations WHERE agency_id = $1 AND status = \'active\'', [mRow.agency_id]);
          locations = locRes.rows.map(l => ({ id: l.id, agencyId: l.agency_id, name: l.name, status: l.status }));
          state.locations.push(...locations);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.warn('[AUTH-LOGIN-PG] Membership resolution failed:', err.message);
      } finally {
        client.release();
      }
    }

    if (!membership || !agency || locations.length === 0) {
      sendJson(res, 403, { error: 'No active agency found for user' });
      return true;
    }

    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(24).toString('hex');
    const sessionId = randomUUID();
    const tokenHash = hash(token);
    const csrfHash = hash(csrf);
    const expiresAtMs = Date.now() + 12 * 3600 * 1000;
    state.sessions.push({
      id: sessionId,
      tokenHash,
      csrfHash,
      userId: user.id,
      agencyId: agency.id,
      expiresAt: expiresAtMs
    });

    if (pgPool) {
      const sessClient = await pgPool.connect();
      try {
        await sessClient.query('BEGIN');
        await sessClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.user_id', $2, true)", [agency.id, user.id]);
        await sessClient.query(
          'INSERT INTO auth_sessions (id, token_hash, csrf_hash, user_id, agency_id, expires_at) VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0)) ON CONFLICT (token_hash) DO NOTHING',
          [sessionId, tokenHash, csrfHash, user.id, agency.id, expiresAtMs]
        );
        await sessClient.query('COMMIT');
      } catch (dbErr) {
        await sessClient.query('ROLLBACK').catch(() => {});
        if (isStagingOrProd || platformDbEnabled) {
          sendJson(res, 500, { error: 'Failed to persist session to database: ' + dbErr.message, code: 'DATABASE_SESSION_WRITE_FAILED' });
          return true;
        }
        console.warn('[AUTH-LOGIN-PG] Failed to write session to PostgreSQL:', dbErr.message);
      } finally {
        sessClient.release();
      }
    }

    setSessionCookies(res, token, csrf);
    await saveState();
    auditLog('auth.login', { user, agency, membership, locations, activeLocation: locations[0] }, {});

    sendJson(res, 200, {
      user: { id: user.id, name: user.name, email: user.email },
      agency: { id: agency.id, name: agency.name },
      locations,
      activeLocationId: locations[0]?.id
    });
    return true;
  }

  // 6. AUTH: Current Session Check
  if (method === 'GET' && pathname === '/api/auth/session') {
    const actor = await getActor(req);
    if (!actor) {
      sendJson(res, 401, { error: 'Not authenticated' });
      return true;
    }
    sendJson(res, 200, {
      user: { id: actor.user.id, name: actor.user.name, email: actor.user.email },
      agency: { id: actor.agency.id, name: actor.agency.name },
      locations: actor.locations,
      activeLocationId: actor.activeLocation.id,
      role: actor.membership.role
    });
    return true;
  }

  // 7. AUTH: Full user profile
  if (method === 'GET' && pathname === '/api/auth/me') {
    const actor = await getActor(req);
    if (!actor) {
      sendJson(res, 401, { error: 'Not authenticated' });
      return true;
    }
    sendJson(res, 200, {
      user: {
        id: actor.user.id,
        name: actor.user.name,
        email: actor.user.email,
        createdAt: actor.user.createdAt,
        status: actor.user.status
      },
      agency: {
        id: actor.agency.id,
        name: actor.agency.name,
        slug: actor.agency.slug,
        createdAt: actor.agency.createdAt
      },
      membership: {
        id: actor.membership.id,
        role: actor.membership.role
      },
      locations: actor.locations.map(l => ({ id: l.id, name: l.name, timezone: l.timezone })),
      activeLocation: {
        id: actor.activeLocation.id,
        name: actor.activeLocation.name,
        timezone: actor.activeLocation.timezone
      }
    });
    return true;
  }

  // 8. AUTH: Logout (Server-Side Session Revocation)
  if (method === 'POST' && pathname === '/api/auth/logout') {
    const cookieHeader = req.headers.cookie || '';
    let token = '';
    for (const part of cookieHeader.split(';')) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        const key = part.slice(0, idx).trim();
        if (key === 'operza_session' || key === '__Host-operza_session') {
          token = decodeURIComponent(part.slice(idx + 1).trim());
          break;
        }
      }
    }
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7).trim();
    }

    if (token) {
      const tokenHash = hash(token);
      if (Array.isArray(state.sessions)) {
        state.sessions = state.sessions.filter(s => s.tokenHash !== tokenHash);
      }
      if (pgPool) {
        try {
          await pgPool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [tokenHash]);
        } catch {}
      }
      await saveState();
    }

    clearSessionCookies(res);
    sendJson(res, 200, { success: true, message: 'Logged out successfully' });
    return true;
  }

  return false;
}
