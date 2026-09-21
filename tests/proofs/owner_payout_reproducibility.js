/**
 * tests/proofs/owner_payout_reproducibility.js
 * 
 * Committed, self-contained, reproducible proof for Owner Payouts:
 * 1. ₹1,800 Net Fixture: Validates get_owner_financial_summary returns unsettled_payable_minor: 180000.
 * 2. Ledger Triple: Validates get_owner_statement returns:
 *    - owner_payable_net: -180000
 *    - gateway_clearing_net: 200000
 *    - platform_commission_net: -20000
 * 3. Already Planned Idempotency: Validates plan_owner_payout returns:
 *    - Call 1: status = 'planned', amount_minor = 180000
 *    - Call 2: status = 'already_planned', amount_minor = 180000
 * 4. Deterministic Teardown: Restores zero-residue baseline.
 */

const { Client } = require('pg');
const crypto = require('crypto');

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function run() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  console.log('================================================================');
  console.log('OWNER PAYOUTS REPRODUCIBILITY & NUMERIC PROOF SUITE');
  console.log('================================================================');

  const createdIds = {
    bookingIds: [],
    journalEventKeys: [],
    payoutIds: [],
    accountIds: []
  };

  try {
    // 1. Resolve Demo Master Owner and Resource
    const moRes = await client.query(`
      SELECT mo.id, mo.owner_user_id 
      FROM public.master_owners mo 
      WHERE mo.business_name = 'Box Codex Demo Venues'
      LIMIT 1;
    `);
    if (moRes.rows.length === 0) {
      throw new Error('DEMO_OWNER_NOT_FOUND: Box Codex Demo Venues master owner missing');
    }
    const masterOwnerId = moRes.rows[0].id;
    const ownerUserId = moRes.rows[0].owner_user_id;

    const resCourt = await client.query(`
      SELECT r.id, r.turf_id 
      FROM public.resources r 
      WHERE r.master_owner_id = $1 
      LIMIT 1;
    `, [masterOwnerId]);
    if (resCourt.rows.length === 0) {
      throw new Error('RESOURCE_NOT_FOUND: No court found for master owner');
    }
    const resourceId = resCourt.rows[0].id;
    const turfId = resCourt.rows[0].turf_id;

    // 2. Setup verified financial account
    const accRes = await client.query(`
      INSERT INTO private.owner_financial_accounts (
        master_owner_id, provider, provider_account_id, masked_bank_label, verification_status, active
      ) VALUES (
        $1, 'razorpay_route', 'acc_repro_' || $2, 'HDFC Bank ****9876', 'verified', true
      ) RETURNING id;
    `, [masterOwnerId, Date.now()]);
    const accountId = accRes.rows[0].id;
    createdIds.accountIds.push(accountId);

    // 3. Setup honest online booking for ₹2,000 (200,000 paise)
    const bookingId = crypto.randomUUID();
    createdIds.bookingIds.push(bookingId);

    const slotStart = new Date(Date.now() + 180 * 86400000); // 180 days in future
    const slotEnd = new Date(slotStart.getTime() + 3600000);
    const refCode = `BK-REPRO-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;

    await client.query(`
      INSERT INTO public.bookings (
        id, reference_code, master_owner_id, turf_id, resource_id, player_user_id, created_by,
        source, status, starts_at, ends_at, hold_expires_at,
        total_minor, required_online_minor, currency,
        pricing_snapshot, cancellation_snapshot, commission_snapshot
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $6,
        'online', 'confirmed', $7, $8, now() + interval '10 minutes',
        200000, 200000, 'INR', '{}'::jsonb, '{}'::jsonb, '{"basis_points": 1000, "estimated_commission_minor": 20000}'::jsonb
      );
    `, [bookingId, refCode, masterOwnerId, turfId, resourceId, ownerUserId, slotStart.toISOString(), slotEnd.toISOString()]);

    const eventKey = `repro_pay_captured_${Date.now()}`;
    createdIds.journalEventKeys.push(eventKey);

    await client.query(`
      SELECT private.post_journal(
        $1, 'payment_captured', 'INR',
        $2::uuid,
        jsonb_build_array(
          jsonb_build_object('account_id', (SELECT id FROM private.ledger_accounts WHERE code = 'gateway_clearing' AND currency = 'INR'), 'amount_minor', 200000),
          jsonb_build_object('account_id', private.get_or_create_owner_account($3, 'owner_payable', 'INR'), 'amount_minor', -180000),
          jsonb_build_object('account_id', (SELECT id FROM private.ledger_accounts WHERE code = 'platform_commission' AND currency = 'INR'), 'amount_minor', -20000)
        )
      );
    `, [eventKey, bookingId, masterOwnerId]);

    // Authenticate as owner for authoritative RPC calls within a transaction block
    await client.query('BEGIN;');
    await client.query('SET LOCAL ROLE authenticated;');
    await client.query(`SET LOCAL "request.jwt.claims" = '${JSON.stringify({ sub: ownerUserId })}';`);

    // -------------------------------------------------------------
    // PROOF 1: ₹1,800 NET FIXTURE (get_owner_financial_summary)
    // -------------------------------------------------------------
    console.log('\n--- PROOF 1: ₹1,800 NET FIXTURE (get_owner_financial_summary) ---');
    const summaryRes = await client.query(`SELECT public.get_owner_financial_summary($1) as summary;`, [masterOwnerId]);
    const summary = summaryRes.rows[0].summary;
    console.log('Raw Financial Summary JSON:');
    console.log(JSON.stringify(summary, null, 2));

    if (summary.unsettled_payable_minor !== 180000) {
      throw new Error(`ASSERTION_FAILED: Expected unsettled_payable_minor 180000, got ${summary.unsettled_payable_minor}`);
    }
    console.log('CONFIRMED: Unsettled net payable matches exactly ₹1,800 (180,000 paise).');

    // -------------------------------------------------------------
    // PROOF 2: LEDGER TRIPLE (get_owner_statement)
    // -------------------------------------------------------------
    console.log('\n--- PROOF 2: LEDGER TRIPLE (get_owner_statement) ---');
    const stmtRes = await client.query(`SELECT public.get_owner_statement($1) as stmt;`, [masterOwnerId]);
    const stmt = stmtRes.rows[0].stmt;
    console.log('Raw Statement JSON:');
    console.log(JSON.stringify(stmt, null, 2));

    const balances = stmt.ledger_balances;
    if (balances.owner_payable_net !== -180000) {
      throw new Error(`ASSERTION_FAILED: Expected owner_payable_net -180000, got ${balances.owner_payable_net}`);
    }
    if (balances.gateway_clearing_net !== 200000) {
      throw new Error(`ASSERTION_FAILED: Expected gateway_clearing_net 200000, got ${balances.gateway_clearing_net}`);
    }
    if (balances.platform_commission_net !== -20000) {
      throw new Error(`ASSERTION_FAILED: Expected platform_commission_net -20000, got ${balances.platform_commission_net}`);
    }
    console.log('CONFIRMED: Ledger triple matches:');
    console.log('  owner_payable_net:       -₹1,800 (-180,000 paise)');
    console.log('  gateway_clearing_net:     ₹2,000 ( 200,000 paise)');
    console.log('  platform_commission_net:   -₹200 ( -20,000 paise)');

    // -------------------------------------------------------------
    // PROOF 3: IDEMPOTENCY PROOF (plan_owner_payout)
    // -------------------------------------------------------------
    console.log('\n--- PROOF 3: ALREADY_PLANNED IDEMPOTENCY PROOF (plan_owner_payout) ---');
    const idempKey = `repro-key-${Date.now()}`;

    // Call 1:
    const plan1Res = await client.query(`
      SELECT public.plan_owner_payout($1, NULL, NULL, $2) as plan;
    `, [masterOwnerId, idempKey]);
    const plan1 = plan1Res.rows[0].plan;
    console.log('Call 1 Result (First execution):');
    console.log(JSON.stringify(plan1, null, 2));

    if (plan1.status !== 'planned' || plan1.amount_minor !== 180000) {
      throw new Error(`ASSERTION_FAILED: Expected status 'planned' and amount_minor 180000, got ${JSON.stringify(plan1)}`);
    }
    createdIds.payoutIds.push(plan1.payout_id);

    // Call 2: Same idempotency key
    const plan2Res = await client.query(`
      SELECT public.plan_owner_payout($1, NULL, NULL, $2) as plan;
    `, [masterOwnerId, idempKey]);
    const plan2 = plan2Res.rows[0].plan;
    console.log('Call 2 Result (Repeated idempotency key):');
    console.log(JSON.stringify(plan2, null, 2));

    if (plan2.status !== 'already_planned' || plan2.amount_minor !== 180000) {
      throw new Error(`ASSERTION_FAILED: Expected status 'already_planned' and amount_minor 180000, got ${JSON.stringify(plan2)}`);
    }
    console.log('CONFIRMED: Idempotency preserved; repeated call returned status "already_planned" with identical amount.');

    // Commit transaction and return to postgres role for teardown
    await client.query(`COMMIT;`);

  } finally {
    // -------------------------------------------------------------
    // DETERMINISTIC TEARDOWN
    // -------------------------------------------------------------
    console.log('\n--- DETERMINISTIC TEARDOWN ---');
    await client.query(`ROLLBACK;`).catch(() => {});
    await client.query(`RESET ROLE;`).catch(() => {});

    // Temporarily disable immutability triggers for test cleanup
    try {
      await client.query(`
        ALTER TABLE private.ledger_journals DISABLE TRIGGER trg_immutable_ledger_journals;
        ALTER TABLE private.ledger_journals DISABLE TRIGGER trg_enforce_journal_balance;
        ALTER TABLE private.ledger_entries DISABLE TRIGGER trg_immutable_ledger_entries;
        ALTER TABLE private.ledger_entries DISABLE TRIGGER trg_enforce_entry_balance;
        ALTER TABLE private.audit_events DISABLE TRIGGER trg_audit_events_immutability;
      `);

      if (createdIds.payoutIds.length > 0) {
        await client.query(`DELETE FROM private.audit_events WHERE entity_id = ANY($1::uuid[]);`, [createdIds.payoutIds]);
        await client.query(`DELETE FROM private.outbox_events WHERE aggregate_id = ANY($1::uuid[]);`, [createdIds.payoutIds]);
        await client.query(`DELETE FROM private.payout_allocations WHERE payout_id = ANY($1::uuid[]);`, [createdIds.payoutIds]);
        await client.query(`DELETE FROM private.payouts WHERE id = ANY($1::uuid[]);`, [createdIds.payoutIds]);
      }
      if (createdIds.journalEventKeys.length > 0) {
        await client.query(`
          DELETE FROM private.ledger_entries WHERE journal_id IN (
            SELECT id FROM private.ledger_journals WHERE event_key = ANY($1::text[])
          );
        `, [createdIds.journalEventKeys]);
        await client.query(`
          DELETE FROM private.ledger_journals WHERE event_key = ANY($1::text[]);
        `, [createdIds.journalEventKeys]);
      }
      if (createdIds.bookingIds.length > 0) {
        await client.query(`DELETE FROM public.bookings WHERE id = ANY($1::uuid[]);`, [createdIds.bookingIds]);
      }
      if (createdIds.accountIds.length > 0) {
        await client.query(`DELETE FROM private.owner_financial_accounts WHERE id = ANY($1::uuid[]);`, [createdIds.accountIds]);
      }
    } finally {
      // Re-enable triggers
      await client.query(`
        ALTER TABLE private.ledger_journals ENABLE TRIGGER trg_immutable_ledger_journals;
        ALTER TABLE private.ledger_journals ENABLE TRIGGER trg_enforce_journal_balance;
        ALTER TABLE private.ledger_entries ENABLE TRIGGER trg_immutable_ledger_entries;
        ALTER TABLE private.ledger_entries ENABLE TRIGGER trg_enforce_entry_balance;
        ALTER TABLE private.audit_events ENABLE TRIGGER trg_audit_events_immutability;
      `);

      const trigCheck = await client.query(`
        SELECT tgname, tgenabled 
        FROM pg_trigger 
        WHERE tgname IN (
          'trg_immutable_ledger_journals',
          'trg_immutable_ledger_entries',
          'trg_enforce_journal_balance',
          'trg_enforce_entry_balance',
          'trg_audit_events_immutability'
        );
      `);
      const disabled = trigCheck.rows.filter(r => r.tgenabled !== 'O');
      if (disabled.length > 0) {
        throw new Error(`CRITICAL: Immutability triggers failed to re-enable in teardown: ${JSON.stringify(disabled)}`);
      }
    }

    // Residue Audit
    const check = await client.query(`
      SELECT 
        (SELECT count(*)::int FROM private.payouts) as payouts,
        (SELECT count(*)::int FROM private.payout_allocations) as payout_allocations,
        (SELECT count(*)::int FROM private.owner_financial_accounts) as owner_financial_accounts,
        (SELECT count(*)::int FROM private.ledger_journals) as ledger_journals,
        (SELECT count(*)::int FROM private.ledger_entries) as ledger_entries,
        (SELECT count(*)::int FROM private.payments) as payments,
        (SELECT count(*)::int FROM public.bookings) as bookings;
    `);
    const r = check.rows[0];
    console.log(`Residue Verification: payouts=${r.payouts}, allocations=${r.payout_allocations}, accounts=${r.owner_financial_accounts}, journals=${r.ledger_journals}, entries=${r.ledger_entries}, payments=${r.payments}, bookings=${r.bookings}`);
    if (Object.values(r).some(v => v !== 0)) {
      throw new Error(`TEARDOWN_RESIDUE_DETECTED: Non-zero test residue remaining: ${JSON.stringify(r)}`);
    }
    console.log('CONFIRMED: Clean teardown completed with 0 test residue.');
    console.log('================================================================');
    console.log('ALL OWNER PAYOUTS REPRODUCIBILITY PROOFS PASSED (100%)');
    console.log('================================================================');

    await client.end();
  }
}

run().catch(err => {
  console.error('PROOFS FAILED:', err);
  process.exit(1);
});
