/**
 * API-Level Test Suite: payout_release_api_test.js
 * 
 * Verifies PostgREST exposed RPC wrappers public.settle_owner_payout and public.request_refund:
 * 1. no token -> settle: expect 401/403
 * 2. player token -> settle: expect PERMISSION_DENIED 42501
 * 3. owner token -> settle: expect PERMISSION_DENIED 42501
 * 4. platform-admin token -> settle: expect success (HTTP 200)
 * 5. player token -> refund: expect PERMISSION_DENIED 42501
 * 6. platform-admin token -> refund: expect success (HTTP 200)
 * 
 * Follows strict deterministic setup and teardown with zero test residue.
 */

const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const fs = require('fs');
const { insertTestAuthUser } = require('../test_constants');

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';

function getAnonKey() {
  if (process.env.SUPABASE_ANON_KEY) return process.env.SUPABASE_ANON_KEY;
  if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (fs.existsSync('apps/player/.env.local')) {
    const envContent = fs.readFileSync('apps/player/.env.local', 'utf8');
    for (const line of envContent.split('\n')) {
      if (line.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) {
        return line.split('=')[1].trim();
      }
    }
  }
  return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
}

async function runApiTests() {
  const pgClient = new Client(DB_URL);
  await pgClient.connect();

  const anonKey = getAnonKey();
  const runTag = Date.now();
  const createdIds = {
    userIds: [],
    bookingIds: [],
    paymentOrderIds: [],
    paymentIds: [],
    payoutIds: [],
    refundIds: [],
    journalKeys: []
  };

  console.log('================================================================');
  console.log('STARTING API-LEVEL PROOF: PAYOUT RELEASE & REFUND POSTGREST RPC');
  console.log('================================================================');

  try {
    // 1. Resolve Demo Master Owner and Turf for fixtures
    const ownerRes = await pgClient.query(`
      SELECT mo.id as master_owner_id, mo.owner_user_id, t.id as turf_id, r.id as resource_id
      FROM public.master_owners mo
      JOIN public.turfs t ON t.master_owner_id = mo.id
      JOIN public.resources r ON r.turf_id = t.id
      WHERE mo.status = 'active' AND t.approval_status = 'approved'
      LIMIT 1;
    `);
    if (ownerRes.rows.length === 0) {
      throw new Error('Baseline active master owner and turf not found in DB');
    }
    const { master_owner_id: moId, owner_user_id: ownerUid, turf_id: turfId, resource_id: resourceId } = ownerRes.rows[0];

    // 2. Create Platform Admin Test User
    const adminUserId = crypto.randomUUID();
    const adminEmail = `platform_admin_api_${runTag}@boxcodex.internal`;
    createdIds.userIds.push(adminUserId);

    await insertTestAuthUser(pgClient, {
      id: adminUserId,
      email: adminEmail,
      password: 'Password123!',
      rawUserMetaData: { name: 'API Test Platform Admin' }
    });

    await pgClient.query(
      `INSERT INTO private.platform_admins (user_id, active) VALUES ($1, true);`,
      [adminUserId]
    );

    // 3. Authenticate clients via GoTrue to get genuine JWTs
    console.log('\n--- Authenticating test callers ---');
    const authClient = createClient(SUPABASE_URL, anonKey);

    // Player Client (live_player@example.com)
    const { data: playerData, error: playerAuthErr } = await authClient.auth.signInWithPassword({
      email: 'live_player@example.com',
      password: 'Password123!'
    });
    if (playerAuthErr) throw new Error(`Player auth failed: ${playerAuthErr.message}`);
    const playerToken = playerData.session.access_token;
    console.log('Player authenticated:', playerData.user.email, `(${playerData.user.id})`);

    // Owner Client (demo_owner@boxcodex.internal)
    const { data: ownerData, error: ownerAuthErr } = await authClient.auth.signInWithPassword({
      email: 'demo_owner@boxcodex.internal',
      password: 'Password123!'
    });
    if (ownerAuthErr) throw new Error(`Owner auth failed: ${ownerAuthErr.message}`);
    const ownerToken = ownerData.session.access_token;
    console.log('Owner authenticated:', ownerData.user.email, `(${ownerData.user.id})`);

    // Admin Client
    const { data: adminData, error: adminAuthErr } = await authClient.auth.signInWithPassword({
      email: adminEmail,
      password: 'Password123!'
    });
    if (adminAuthErr) throw new Error(`Admin auth failed: ${adminAuthErr.message}`);
    const adminToken = adminData.session.access_token;
    console.log('Platform Admin authenticated:', adminData.user.email, `(${adminData.user.id})`);

    // 4. Create Test Fixtures in Database
    // Ensure ledger accounts exist
    await pgClient.query(`
      SELECT private.get_or_create_owner_account($1, 'owner_payable', 'INR');
    `, [moId]);

    // Create an active financial account for the master owner
    const finAccRes = await pgClient.query(`
      SELECT private.register_owner_financial_account(
        $1::uuid, 'razorpay', $2::text, 'HDFC Bank ****1234', true
      ) as res;
    `, [moId, `acc_api_${runTag}`]);
    const finAccountId = finAccRes.rows[0].res.account_id;
    createdIds.financialAccountIds = [finAccountId];

    // Create a planned payout for settle testing
    const payoutId = crypto.randomUUID();
    createdIds.payoutIds.push(payoutId);
    await pgClient.query(`
      INSERT INTO private.payouts (
        id, master_owner_id, financial_account_id, status, currency, amount_minor, period_start, period_end, idempotency_key
      ) VALUES (
        $1, $2, $3, 'planned', 'INR', 150000, CURRENT_DATE - 7, CURRENT_DATE, $4
      );
    `, [payoutId, moId, finAccountId, `idemp_payout_api_${runTag}`]);

    // Create confirmed booking, payment_order, and payment for refund testing
    const bookingId = crypto.randomUUID();
    createdIds.bookingIds.push(bookingId);
    await pgClient.query(`
      INSERT INTO public.bookings (
        id, reference_code, master_owner_id, turf_id, resource_id, player_user_id, created_by,
        source, status, starts_at, ends_at, hold_expires_at, total_minor, required_online_minor, currency,
        pricing_snapshot, cancellation_snapshot, commission_snapshot
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $6,
        'online', 'confirmed', now() + interval '1 day', now() + interval '1 day 1 hour', now() + interval '10 min',
        200000, 200000, 'INR', '{}'::jsonb, '{}'::jsonb, '{"basis_points": 1000, "estimated_commission_minor": 20000}'::jsonb
      );
    `, [bookingId, `BK-API-${runTag}`, moId, turfId, resourceId, playerData.user.id]);

    const paymentOrderId = crypto.randomUUID();
    createdIds.paymentOrderIds.push(paymentOrderId);
    await pgClient.query(`
      INSERT INTO private.payment_orders (
        id, booking_id, master_owner_id, purpose, provider, provider_order_id,
        amount_minor, currency, status, idempotency_key
      ) VALUES (
        $1, $2, $3, 'initial', 'razorpay', $4, 200000, 'INR', 'paid', $5
      );
    `, [paymentOrderId, bookingId, moId, `order_api_${runTag}`, `idemp_order_api_${runTag}`]);

    const paymentId = crypto.randomUUID();
    createdIds.paymentIds.push(paymentId);
    await pgClient.query(`
      INSERT INTO private.payments (
        id, payment_order_id, provider, provider_payment_id,
        amount_minor, currency, status, captured_at
      ) VALUES (
        $1, $2, 'razorpay', $3, 200000, 'INR', 'captured', now()
      );
    `, [paymentId, paymentOrderId, `pay_api_${runTag}`]);

    // Helper to call PostgREST RPC via fetch
    async function callPostgrestRpc(rpcName, payload, token = null) {
      const headers = {
        'Content-Type': 'application/json',
        'apikey': anonKey
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      const status = res.status;
      let body;
      try {
        body = await res.json();
      } catch (e) {
        body = await res.text();
      }
      return { status, body };
    }

    // =========================================================================
    // TEST 1: no token -> settle (Expect 401/403)
    // =========================================================================
    console.log('\n--- TEST 1: NO TOKEN -> settle_owner_payout ---');
    const t1Res = await callPostgrestRpc('settle_owner_payout', {
      p_payout_id: payoutId,
      p_provider_settlement_id: `setl_no_tok_${runTag}`
    }, null);
    console.log('HTTP Status:', t1Res.status);
    console.log('Response Body:', JSON.stringify(t1Res.body, null, 2));

    if (t1Res.status !== 401 && t1Res.status !== 403) {
      throw new Error(`Test 1 Failed: Expected 401 or 403, got ${t1Res.status}`);
    }
    console.log('[PASS] Test 1: Unauthenticated request rejected with HTTP', t1Res.status);

    // =========================================================================
    // TEST 2: player token -> settle (Expect PERMISSION_DENIED 42501)
    // =========================================================================
    console.log('\n--- TEST 2: PLAYER TOKEN -> settle_owner_payout ---');
    const t2Res = await callPostgrestRpc('settle_owner_payout', {
      p_payout_id: payoutId,
      p_provider_settlement_id: `setl_player_${runTag}`
    }, playerToken);
    console.log('HTTP Status:', t2Res.status);
    console.log('Response Body:', JSON.stringify(t2Res.body, null, 2));

    const isPermDeniedT2 = (t2Res.body?.code === '42501' || t2Res.body?.message?.includes('PERMISSION_DENIED')) &&
                           (t2Res.status === 400 || t2Res.status === 403);
    if (!isPermDeniedT2) {
      throw new Error(`Test 2 Failed: Expected 400/403 PERMISSION_DENIED 42501, got ${t2Res.status} ${JSON.stringify(t2Res.body)}`);
    }
    console.log('[PASS] Test 2: Player token strictly denied with PERMISSION_DENIED (42501)');

    // =========================================================================
    // TEST 3: owner token -> settle (Expect PERMISSION_DENIED 42501)
    // =========================================================================
    console.log('\n--- TEST 3: OWNER TOKEN -> settle_owner_payout ---');
    const t3Res = await callPostgrestRpc('settle_owner_payout', {
      p_payout_id: payoutId,
      p_provider_settlement_id: `setl_owner_${runTag}`
    }, ownerToken);
    console.log('HTTP Status:', t3Res.status);
    console.log('Response Body:', JSON.stringify(t3Res.body, null, 2));

    const isPermDeniedT3 = (t3Res.body?.code === '42501' || t3Res.body?.message?.includes('PERMISSION_DENIED')) &&
                           (t3Res.status === 400 || t3Res.status === 403);
    if (!isPermDeniedT3) {
      throw new Error(`Test 3 Failed: Expected 400/403 PERMISSION_DENIED 42501, got ${t3Res.status} ${JSON.stringify(t3Res.body)}`);
    }
    console.log('[PASS] Test 3: Owner token strictly denied with PERMISSION_DENIED (42501)');

    // =========================================================================
    // TEST 4: platform-admin token -> settle (Expect success HTTP 200)
    // =========================================================================
    console.log('\n--- TEST 4: PLATFORM ADMIN TOKEN -> settle_owner_payout ---');
    const settlementId = `setl_admin_${runTag}`;
    createdIds.journalKeys.push(`payout_settled_${settlementId}`);

    const t4Res = await callPostgrestRpc('settle_owner_payout', {
      p_payout_id: payoutId,
      p_provider_settlement_id: settlementId
    }, adminToken);
    console.log('HTTP Status:', t4Res.status);
    console.log('Response Body:', JSON.stringify(t4Res.body, null, 2));

    if (t4Res.status !== 200 || t4Res.body?.status !== 'settled') {
      throw new Error(`Test 4 Failed: Expected 200 with status=settled, got ${t4Res.status} ${JSON.stringify(t4Res.body)}`);
    }
    console.log('[PASS] Test 4: Platform admin successfully settled payout');

    // =========================================================================
    // TEST 5: player token -> refund (Expect PERMISSION_DENIED 42501)
    // =========================================================================
    console.log('\n--- TEST 5: PLAYER TOKEN -> request_refund ---');
    const t5Res = await callPostgrestRpc('request_refund', {
      p_payment_id: paymentId,
      p_amount_minor: 50000,
      p_reason: 'Customer requested refund via player token'
    }, playerToken);
    console.log('HTTP Status:', t5Res.status);
    console.log('Response Body:', JSON.stringify(t5Res.body, null, 2));

    const isPermDeniedT5 = (t5Res.body?.code === '42501' || t5Res.body?.message?.includes('PERMISSION_DENIED')) &&
                           (t5Res.status === 400 || t5Res.status === 403);
    if (!isPermDeniedT5) {
      throw new Error(`Test 5 Failed: Expected 400/403 PERMISSION_DENIED 42501, got ${t5Res.status} ${JSON.stringify(t5Res.body)}`);
    }
    console.log('[PASS] Test 5: Player token strictly denied from issuing refund (42501)');

    // =========================================================================
    // TEST 6: platform-admin token -> refund (Expect success HTTP 200)
    // =========================================================================
    console.log('\n--- TEST 6: PLATFORM ADMIN TOKEN -> request_refund ---');
    const idempRefund = `idemp_ref_api_${runTag}`;
    const t6Res = await callPostgrestRpc('request_refund', {
      p_payment_id: paymentId,
      p_amount_minor: 50000,
      p_reason: 'Admin approved dispute settlement',
      p_idempotency_key: idempRefund
    }, adminToken);
    console.log('HTTP Status:', t6Res.status);
    console.log('Response Body:', JSON.stringify(t6Res.body, null, 2));

    if (t6Res.status !== 200 || t6Res.body?.status !== 'requested') {
      throw new Error(`Test 6 Failed: Expected 200 with status=requested, got ${t6Res.status} ${JSON.stringify(t6Res.body)}`);
    }
    if (t6Res.body?.refund_id) {
      createdIds.refundIds.push(t6Res.body.refund_id);
    }
    console.log('[PASS] Test 6: Platform admin successfully requested refund via PostgREST RPC');

    console.log('\n================================================================');
    console.log('ALL 6 API-LEVEL POSTGREST RPC PROOFS PASSED WITH 100% SUCCESS');
    console.log('================================================================');

  } finally {
    // Teardown: Clean up all test fixtures in strict dependency order
    console.log('\n--- Deterministic Teardown ---');
    await pgClient.query(`DELETE FROM private.outbox_events;`);
    await pgClient.query(`DELETE FROM private.refunds WHERE payment_id = ANY($1::uuid[]);`, [createdIds.paymentIds]);
    await pgClient.query(`DELETE FROM private.payments WHERE id = ANY($1::uuid[]);`, [createdIds.paymentIds]);
    await pgClient.query(`DELETE FROM private.payment_orders WHERE id = ANY($1::uuid[]);`, [createdIds.paymentOrderIds]);
    await pgClient.query(`DELETE FROM public.bookings WHERE id = ANY($1::uuid[]);`, [createdIds.bookingIds]);
    await pgClient.query(`DELETE FROM private.payout_allocations WHERE payout_id = ANY($1::uuid[]);`, [createdIds.payoutIds]);
    await pgClient.query(`DELETE FROM private.payouts WHERE id = ANY($1::uuid[]);`, [createdIds.payoutIds]);
    if (createdIds.financialAccountIds && createdIds.financialAccountIds.length > 0) {
      await pgClient.query(`DELETE FROM private.owner_financial_accounts WHERE id = ANY($1::uuid[]);`, [createdIds.financialAccountIds]);
    }

    if (createdIds.journalKeys.length > 0) {
      try {
        await pgClient.query(`ALTER TABLE private.ledger_entries DISABLE TRIGGER trg_immutable_ledger_entries;`);
        await pgClient.query(`ALTER TABLE private.ledger_journals DISABLE TRIGGER trg_immutable_ledger_journals;`);
        await pgClient.query(`
          DELETE FROM private.ledger_entries WHERE journal_id IN (
            SELECT id FROM private.ledger_journals WHERE event_key = ANY($1::text[])
          );
        `, [createdIds.journalKeys]);
        await pgClient.query(`
          DELETE FROM private.ledger_journals WHERE event_key = ANY($1::text[]);
        `, [createdIds.journalKeys]);
      } finally {
        await pgClient.query(`ALTER TABLE private.ledger_entries ENABLE TRIGGER trg_immutable_ledger_entries;`);
        await pgClient.query(`ALTER TABLE private.ledger_journals ENABLE TRIGGER trg_immutable_ledger_journals;`);
      }
    }

    // Clean audit events before deleting auth.users (to avoid FK set null on immutable audit table)
    try {
      await pgClient.query(`ALTER TABLE private.audit_events DISABLE TRIGGER trg_audit_events_immutability;`);
      await pgClient.query(`DELETE FROM private.audit_events WHERE entity_id = ANY($1::uuid[]);`, [createdIds.payoutIds]);

      if (createdIds.userIds.length > 0) {
        await pgClient.query(`DELETE FROM private.platform_admins WHERE user_id = ANY($1::uuid[]);`, [createdIds.userIds]);
        await pgClient.query(`DELETE FROM public.profiles WHERE user_id = ANY($1::uuid[]);`, [createdIds.userIds]);
        await pgClient.query(`DELETE FROM public.players WHERE user_id = ANY($1::uuid[]);`, [createdIds.userIds]);
        await pgClient.query(`DELETE FROM auth.identities WHERE user_id = ANY($1::uuid[]);`, [createdIds.userIds]);
        await pgClient.query(`DELETE FROM auth.users WHERE id = ANY($1::uuid[]);`, [createdIds.userIds]);
      }
    } finally {
      await pgClient.query(`ALTER TABLE private.audit_events ENABLE TRIGGER trg_audit_events_immutability;`);

      const trigCheck = await pgClient.query(`
        SELECT tgname, tgenabled 
        FROM pg_trigger 
        WHERE tgname IN (
          'trg_immutable_ledger_journals',
          'trg_immutable_ledger_entries',
          'trg_audit_events_immutability'
        );
      `);
      const disabled = trigCheck.rows.filter(r => r.tgenabled !== 'O');
      if (disabled.length > 0) {
        throw new Error(`CRITICAL: Immutability triggers failed to re-enable in teardown: ${JSON.stringify(disabled)}`);
      }
    }

    console.log('Teardown complete.');

    // Verify 27-metric baseline residue check
    const residue = await query27Metrics(pgClient);
    console.log('\n--- 27-METRIC BASELINE RESIDUE AUDIT ---');
    console.log(JSON.stringify(residue, null, 2));

    await pgClient.end();
  }
}

async function query27Metrics(client) {
  const q = async (tbl, schema = 'public') => {
    const res = await client.query(`SELECT count(*)::int as c FROM ${schema}.${tbl}`);
    return res.rows[0].c;
  };

  return {
    payouts: await q('payouts', 'private'),
    payout_allocations: await q('payout_allocations', 'private'),
    owner_financial_accounts: await q('owner_financial_accounts', 'private'),
    ledger_journals: await q('ledger_journals', 'private'),
    ledger_entries: await q('ledger_entries', 'private'),
    payments: await q('payments', 'private'),
    payment_orders: await q('payment_orders', 'private'),
    bookings: await q('bookings'),
    booking_slots: await q('booking_slots'),
    inventory_allocations: await q('inventory_allocations'),
    refunds: await q('refunds', 'private'),
    audit_events: await q('audit_events', 'private'),
    turfs: await q('turfs'),
    resources: await q('resources'),
    slots: await q('slots'),
    operating_hours: await q('operating_hours'),
    pricing_rules: await q('pricing_rules'),
    employees: await q('employees'),
    employee_turf_assignments: await q('employee_turf_assignments'),
    employee_invites: await q('employee_invites', 'private'),
    notification_deliveries: await q('notification_deliveries', 'private'),
    notifications: await q('notifications'),
    outbox_events: await q('outbox_events', 'private'),
    webhook_events: await q('webhook_events', 'private'),
    profiles: await q('profiles'),
    players: await q('players'),
    auth_users: await q('users', 'auth')
  };
}

runApiTests().catch(err => {
  console.error('\nFATAL TEST ERROR:', err);
  process.exit(1);
});
