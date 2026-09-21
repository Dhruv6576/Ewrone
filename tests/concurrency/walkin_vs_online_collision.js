/**
 * Concurrency Test Suite: walkin_vs_online_collision.js
 * 
 * Verifies true race conditions between online customer holds and counter walk-in bookings:
 * 1. Simultaneous Collision: Online player calling create_booking_hold vs Counter staff calling create_walkin_booking
 *    for the exact same slot interval.
 *    Invariant: Exactly ONE succeeds; the other is rejected with SLOT_UNAVAILABLE (SQLSTATE 23P01).
 *    Zero overlapping active inventory allocations.
 * 2. Active Hold Collision: An active online hold blocks counter walk-in creation (SLOT_UNAVAILABLE).
 * 3. Expired Hold Opportunistic Release: Once an online hold expires, counter walk-in successfully claims the slot.
 * 4. Adjacent Non-Overlapping Slots: Concurrent online hold and walk-in on abutting time slots both succeed.
 * 5. Catalog Integrity Check: (id, slug) catalog comparison before and after to ensure zero catalog pollution.
 */

const { Client } = require('pg');
const crypto = require('crypto');
const {
  EXPECTED_BASE_PROFILES,
  EXPECTED_BASE_PLAYERS,
  insertTestAuthUsers
} = require('../test_constants');

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function getResidueSnapshot(client) {
  const qOutbox = await client.query(`SELECT count(*)::int as count FROM private.outbox_events;`);
  const qProfiles = await client.query(`SELECT count(*)::int as count FROM public.profiles;`);
  const qPlayers = await client.query(`SELECT count(*)::int as count FROM public.players;`);
  const qBookingEvents = await client.query(`SELECT count(*)::int as count FROM public.booking_events;`);
  const qAuditEvents = await client.query(`SELECT count(*)::int as count FROM private.audit_events;`);
  return {
    outbox_events: qOutbox.rows[0].count,
    profiles: qProfiles.rows[0].count,
    players: qPlayers.rows[0].count,
    booking_events: qBookingEvents.rows[0].count,
    audit_events: qAuditEvents.rows[0].count,
  };
}

function printResidueSnapshot(label, s) {
  console.log(`\n=== 5-TABLE RESIDUE SNAPSHOT: ${label} ===`);
  console.log(`  private.outbox_events: ${s.outbox_events}`);
  console.log(`  public.profiles:       ${s.profiles}`);
  console.log(`  public.players:        ${s.players}`);
  console.log(`  public.booking_events: ${s.booking_events}`);
  console.log(`  private.audit_events:  ${s.audit_events}`);
}

function assertCleanBaseline(label, residue, snapshot = null) {
  const leaks = [];
  if (residue.outbox_events !== 0) leaks.push(`outbox_events: ${residue.outbox_events} (expected 0)`);
  if (residue.booking_events !== 0) leaks.push(`booking_events: ${residue.booking_events} (expected 0)`);
  if (residue.audit_events !== 0) leaks.push(`audit_events: ${residue.audit_events} (expected 0)`);
  if (residue.profiles !== EXPECTED_BASE_PROFILES) leaks.push(`profiles: ${residue.profiles} (expected ${EXPECTED_BASE_PROFILES} seed users: owner + player)`);
  if (residue.players !== EXPECTED_BASE_PLAYERS) leaks.push(`players: ${residue.players} (expected ${EXPECTED_BASE_PLAYERS} seed players)`);
  if (snapshot && snapshot.length !== 3) leaks.push(`turfs: ${snapshot.length} (expected 3 seed turfs)`);

  if (leaks.length > 0) {
    console.error(`\n[FATAL PRE-CONDITION FAILURE]: Test residue leak detected at ${label}:`);
    leaks.forEach(l => console.error(`  - ${l}`));
    throw new Error(`PRE_RUN_RESIDUE_DETECTED: Database is not in clean baseline state. Suites cannot run in parallel or on dirty DB.`);
  }
}

async function setupFixtures(adminClient) {
  console.log('\n--- Setting up test fixtures for Walk-in vs Online collision ---');

  const ownerId = '90000000-0000-0000-0000-000000000002';
  const masterOwnerId = '91000000-0000-0000-0000-000000000002';
  const turfId = '92000000-0000-0000-0000-000000000002';
  const resourceId = '93000000-0000-0000-0000-000000000002';
  const policyId = '94000000-0000-0000-0000-000000000002';
  const staffUserId = '95000000-0000-0000-0000-000000000002';
  const onlinePlayerId = '96000000-0000-0000-0000-000000000002';

  // 1. Auth Users
  await insertTestAuthUsers(adminClient, [
    { id: ownerId, email: 'conc_owner_2@test.com', rawUserMetaData: { name: 'Collision Owner' } },
    { id: staffUserId, email: 'conc_staff_2@test.com', rawUserMetaData: { name: 'Collision Staff' } },
    { id: onlinePlayerId, email: 'conc_player_2@test.com', rawUserMetaData: { name: 'Collision Player' } }
  ]);

  // 2. Master Owner
  await adminClient.query(`
    INSERT INTO public.master_owners (id, owner_user_id, business_name, status)
    VALUES ($1, $2, 'Collision Arena Ltd', 'active')
    ON CONFLICT (id) DO UPDATE SET status = 'active';
  `, [masterOwnerId, ownerId]);

  // 3. Approved Turf (unarchived for test duration)
  await adminClient.query(`
    INSERT INTO public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status, timezone, archived_at)
    VALUES ($1, $2, 'collision-arena', 'Collision Arena', 'Highway 8', 'Ahmedabad',
            extensions.ST_SetSRID(extensions.ST_MakePoint(72.5714, 23.0225), 4326)::extensions.geography, 'approved', 'Asia/Kolkata', NULL)
    ON CONFLICT (id) DO UPDATE SET archived_at = NULL, approval_status = 'approved';
  `, [turfId, masterOwnerId]);

  // 4. Resource
  await adminClient.query(`
    INSERT INTO public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, active)
    VALUES ($1, $2, $3, 'Collision Pitch', 60, 60, 240, true)
    ON CONFLICT (id) DO UPDATE SET active = true;
  `, [resourceId, masterOwnerId, turfId]);

  // 5. Operating Hours
  await adminClient.query(`DELETE FROM public.operating_hours WHERE resource_id = $1;`, [resourceId]);
  await adminClient.query(`
    INSERT INTO public.operating_hours (resource_id, iso_weekday, opens_at, closes_at, valid_from)
    SELECT $1, gs, '06:00'::time, '23:00'::time, '2026-01-01'::date
    FROM generate_series(1, 7) gs;
  `, [resourceId]);

  // 6. Pricing Rule (₹1000 / 60-min = 100000 minor)
  await adminClient.query(`DELETE FROM public.pricing_rules WHERE resource_id = $1;`, [resourceId]);
  await adminClient.query(`
    INSERT INTO public.pricing_rules (master_owner_id, turf_id, resource_id, priority, valid_from, iso_weekdays, starts_local, ends_local, amount_per_increment_minor)
    VALUES ($1, $2, $3, 0, '2026-01-01', '{1,2,3,4,5,6,7}', '06:00', '23:00', 100000);
  `, [masterOwnerId, turfId, resourceId]);

  // 7. Booking Settings
  await adminClient.query(`
    INSERT INTO public.cancellation_policies (id, master_owner_id, name, version, rules)
    VALUES ($1, $2, 'Standard Collision Policy', 1, '[]'::jsonb)
    ON CONFLICT (id) DO NOTHING;
  `, [policyId, masterOwnerId]);

  await adminClient.query(`
    INSERT INTO public.turf_booking_settings (turf_id, master_owner_id, cancellation_policy_id, advance_basis_points, booking_horizon_days, minimum_lead_minutes, hold_seconds)
    VALUES ($1, $2, $3, 10000, 60, 0, 300)
    ON CONFLICT (turf_id) DO UPDATE SET hold_seconds = 300;
  `, [turfId, masterOwnerId, policyId]);

  // 8. Staff Employee Setup
  const empRes = await adminClient.query(`
    INSERT INTO public.employees (master_owner_id, user_id, status)
    VALUES ($1, $2, 'active')
    ON CONFLICT (master_owner_id, user_id) DO UPDATE SET status = 'active'
    RETURNING id;
  `, [masterOwnerId, staffUserId]);
  const empId = empRes.rows[0].id;

  const assignRes = await adminClient.query(`
    INSERT INTO public.employee_turf_assignments (employee_id, master_owner_id, turf_id, active)
    VALUES ($1, $2, $3, true)
    ON CONFLICT (employee_id, turf_id) DO UPDATE SET active = true
    RETURNING id;
  `, [empId, masterOwnerId, turfId]);
  const assignId = assignRes.rows[0].id;

  await adminClient.query(`
    INSERT INTO private.assignment_grants (assignment_id, capability, scope) VALUES
      ($1, 'bookings.create_walkin', 'turf'),
      ($1, 'payments.record_offline', 'turf'),
      ($1, 'bookings.read', 'turf')
    ON CONFLICT DO NOTHING;
  `, [assignId]);

  return { ownerId, masterOwnerId, turfId, resourceId, policyId, staffUserId, onlinePlayerId };
}

async function runSimultaneousCollisionTest(fixtures) {
  console.log(`\n================================================================`);
  console.log(`TEST 1: SIMULTANEOUS ONLINE HOLD VS WALKIN RACE (20 RUNNERS)`);
  console.log(`================================================================`);
  console.log(`Target: 18:00 to 19:00 IST on 2026-11-20 (12:30 to 13:30 UTC)`);

  const startsAt = '2026-11-20T12:30:00.000Z';
  const endsAt   = '2026-11-20T13:30:00.000Z';

  // 10 online hold requests and 10 walk-in requests concurrently
  const NUM_PAIRS = 10;
  const clients = [];
  const tasks = [];

  for (let i = 0; i < NUM_PAIRS; i++) {
    const holdKey = `race-hold-${i}-${crypto.randomUUID()}`;
    const walkinKey = `race-walkin-${i}-${crypto.randomUUID()}`;

    // Online Client
    const onlineClient = new Client({ connectionString: DB_URL });
    await onlineClient.connect();
    await onlineClient.query(`SET ROLE authenticated;`);
    await onlineClient.query(`SELECT set_config('request.jwt.claims', $1, false);`, [
      JSON.stringify({ sub: fixtures.onlinePlayerId, role: 'authenticated' })
    ]);
    clients.push(onlineClient);

    tasks.push(
      onlineClient.query(
        `SELECT public.create_booking_hold($1, $2, $3, $4, $5, $6, $7) as res;`,
        [fixtures.resourceId, startsAt, endsAt, holdKey, `Online Player ${i}`, '9876543210', `player_${i}@test.com`]
      ).then(r => ({ type: 'online_hold', success: true, data: r.rows[0].res }))
       .catch(err => ({ type: 'online_hold', success: false, code: err.code, message: err.message }))
    );

    // Walk-in Client
    const walkinClient = new Client({ connectionString: DB_URL });
    await walkinClient.connect();
    await walkinClient.query(`SET ROLE authenticated;`);
    await walkinClient.query(`SELECT set_config('request.jwt.claims', $1, false);`, [
      JSON.stringify({ sub: fixtures.staffUserId, role: 'authenticated' })
    ]);
    clients.push(walkinClient);

    tasks.push(
      walkinClient.query(
        `SELECT public.create_walkin_booking($1, $2, $3, $4, $5, $6, $7, $8, $9) as res;`,
        [fixtures.resourceId, startsAt, endsAt, `Counter Customer ${i}`, '+919999999999', `counter_${i}@test.com`, 'cash', null, walkinKey]
      ).then(r => ({ type: 'walkin', success: true, data: r.rows[0].res }))
       .catch(err => ({ type: 'walkin', success: false, code: err.code, message: err.message }))
    );
  }

  const results = await Promise.all(tasks);

  for (const c of clients) {
    await c.end();
  }

  const successes = results.filter(r => r.success);
  const failures = results.filter(r => !r.success);

  console.log(`Results: ${successes.length} SUCCEEDED, ${failures.length} REJECTED.`);
  if (successes.length === 1) {
    console.log(`Winner type: ${successes[0].type}`);
  }

  const slotUnavailableFailures = failures.filter(f => f.code === '23P01' || (f.message && f.message.includes('SLOT_UNAVAILABLE')));
  console.log(`SLOT_UNAVAILABLE error count: ${slotUnavailableFailures.length} / ${failures.length}`);

  const testPassed = (successes.length === 1) && (failures.length === (NUM_PAIRS * 2 - 1)) && (slotUnavailableFailures.length === failures.length);

  if (testPassed) {
    console.log(`TEST 1 RESULT: PASSED (Exact exclusion invariant preserved under concurrency)`);
  } else {
    console.error(`TEST 1 RESULT: FAILED (Expected 1 winner, found ${successes.length})`);
  }

  return testPassed;
}

async function runActiveHoldVsWalkinTest(adminClient, fixtures) {
  console.log(`\n================================================================`);
  console.log(`TEST 2: ACTIVE ONLINE HOLD BLOCKS COUNTER WALKIN`);
  console.log(`================================================================`);
  console.log(`Target: 20:00 to 21:00 IST on 2026-11-20 (14:30 to 15:30 UTC)`);

  const startsAt = '2026-11-20T14:30:00.000Z';
  const endsAt   = '2026-11-20T15:30:00.000Z';
  const holdKey = `active-hold-${crypto.randomUUID()}`;

  // 1. Online player creates hold
  const playerClient = new Client({ connectionString: DB_URL });
  await playerClient.connect();
  await playerClient.query(`SET ROLE authenticated;`);
  await playerClient.query(`SELECT set_config('request.jwt.claims', $1, false);`, [
    JSON.stringify({ sub: fixtures.onlinePlayerId, role: 'authenticated' })
  ]);

  const holdRes = await playerClient.query(
    `SELECT public.create_booking_hold($1, $2, $3, $4, $5, $6, $7) as res;`,
    [fixtures.resourceId, startsAt, endsAt, holdKey, 'Active Hold Player', '9876543210', 'active@test.com']
  );
  console.log(`Online hold created: ${holdRes.rows[0].res.booking_id}`);
  await playerClient.end();

  // 2. Staff tries to book walkin for same slot -> MUST FAIL
  const staffClient = new Client({ connectionString: DB_URL });
  await staffClient.connect();
  await staffClient.query(`SET ROLE authenticated;`);
  await staffClient.query(`SELECT set_config('request.jwt.claims', $1, false);`, [
    JSON.stringify({ sub: fixtures.staffUserId, role: 'authenticated' })
  ]);

  let walkinBlocked = false;
  try {
    await staffClient.query(
      `SELECT public.create_walkin_booking($1, $2, $3, $4, $5, $6, $7);`,
      [fixtures.resourceId, startsAt, endsAt, 'Blocked Walkin', '+919876543210', null, 'cash']
    );
  } catch (err) {
    if (err.code === '23P01' || (err.message && err.message.includes('SLOT_UNAVAILABLE'))) {
      walkinBlocked = true;
      console.log(`Walkin correctly rejected by active hold: ${err.message}`);
    } else {
      console.error(`Unexpected error: ${err.code} - ${err.message}`);
    }
  }
  await staffClient.end();

  if (walkinBlocked) {
    console.log(`TEST 2 RESULT: PASSED (Active online hold strictly blocks walk-in booking)`);
  } else {
    console.error(`TEST 2 RESULT: FAILED (Walkin was not blocked by active online hold)`);
  }

  return walkinBlocked;
}

async function runExpiredHoldOpportunisticReleaseTest(adminClient, fixtures) {
  console.log(`\n================================================================`);
  console.log(`TEST 3: EXPIRED HOLD OPPORTUNISTIC RELEASE BY WALKIN`);
  console.log(`================================================================`);
  console.log(`Target: 21:00 to 22:00 IST on 2026-11-20 (15:30 to 16:30 UTC)`);

  const startsAt = '2026-11-20T15:30:00.000Z';
  const endsAt   = '2026-11-20T16:30:00.000Z';
  const holdKey = `exp-hold-${crypto.randomUUID()}`;

  // 1. Create a hold with an already expired timestamp
  const playerClient = new Client({ connectionString: DB_URL });
  await playerClient.connect();
  await playerClient.query(`SET ROLE authenticated;`);
  await playerClient.query(`SELECT set_config('request.jwt.claims', $1, false);`, [
    JSON.stringify({ sub: fixtures.onlinePlayerId, role: 'authenticated' })
  ]);

  const holdRes = await playerClient.query(
    `SELECT public.create_booking_hold($1, $2, $3, $4, $5, $6, $7) as res;`,
    [fixtures.resourceId, startsAt, endsAt, holdKey, 'Expired Hold Player', '9876543210', 'exp@test.com']
  );
  const bookingId = holdRes.rows[0].res.booking_id;
  await playerClient.end();

  // Manually expire the hold in database
  await adminClient.query(`
    UPDATE public.inventory_allocations
    SET expires_at = now() - interval '1 minute'
    WHERE booking_id = $1;
  `, [bookingId]);
  await adminClient.query(`
    UPDATE public.bookings
    SET hold_expires_at = now() - interval '1 minute'
    WHERE id = $1;
  `, [bookingId]);

  console.log(`Hold manually expired in DB: ${bookingId}`);

  // 2. Staff calls create_walkin_booking -> Should opportunistically release expired hold and succeed
  const staffClient = new Client({ connectionString: DB_URL });
  await staffClient.connect();
  await staffClient.query(`SET ROLE authenticated;`);
  await staffClient.query(`SELECT set_config('request.jwt.claims', $1, false);`, [
    JSON.stringify({ sub: fixtures.staffUserId, role: 'authenticated' })
  ]);

  let walkinSucceeded = false;
  try {
    const walkinRes = await staffClient.query(
      `SELECT public.create_walkin_booking($1, $2, $3, $4, $5, null, 'cash') as res;`,
      [fixtures.resourceId, startsAt, endsAt, 'Counter Player Post Expiry', '+919876543210']
    );
    if (walkinRes.rows[0].res.status === 'confirmed') {
      walkinSucceeded = true;
      console.log(`Walkin booking succeeded after expired hold release: ${walkinRes.rows[0].res.booking_id}`);
    }
  } catch (err) {
    console.error(`Walkin failed unexpectedly: ${err.message}`);
  }
  await staffClient.end();

  if (walkinSucceeded) {
    console.log(`TEST 3 RESULT: PASSED (Opportunistic hold release enabled walkin to succeed)`);
  } else {
    console.error(`TEST 3 RESULT: FAILED (Walkin could not claim slot from expired hold)`);
  }

  return walkinSucceeded;
}

async function runAdjacentSlotsTest(fixtures) {
  console.log(`\n================================================================`);
  console.log(`TEST 4: ADJACENT NON-OVERLAPPING SLOTS`);
  console.log(`================================================================`);
  console.log(`Slot 1: 08:00 to 09:00 IST (Online Hold)`);
  console.log(`Slot 2: 09:00 to 10:00 IST (Counter Walk-in)`);

  const starts1 = '2026-11-21T02:30:00.000Z';
  const ends1   = '2026-11-21T03:30:00.000Z';
  const starts2 = '2026-11-21T03:30:00.000Z';
  const ends2   = '2026-11-21T04:30:00.000Z';

  const client1 = new Client({ connectionString: DB_URL });
  await client1.connect();
  await client1.query(`SET ROLE authenticated;`);
  await client1.query(`SELECT set_config('request.jwt.claims', $1, false);`, [
    JSON.stringify({ sub: fixtures.onlinePlayerId, role: 'authenticated' })
  ]);

  const client2 = new Client({ connectionString: DB_URL });
  await client2.connect();
  await client2.query(`SET ROLE authenticated;`);
  await client2.query(`SELECT set_config('request.jwt.claims', $1, false);`, [
    JSON.stringify({ sub: fixtures.staffUserId, role: 'authenticated' })
  ]);

  const holdKey = `adj-hold-${crypto.randomUUID()}`;
  const [res1, res2] = await Promise.all([
    client1.query(`SELECT public.create_booking_hold($1, $2, $3, $4, $5, $6, $7) as res;`, [fixtures.resourceId, starts1, ends1, holdKey, 'Adjacent Online', '9876543210', 'adj1@test.com']),
    client2.query(`SELECT public.create_walkin_booking($1, $2, $3, $4, $5, null, 'cash') as res;`, [fixtures.resourceId, starts2, ends2, 'Adjacent Walkin', '+919876543210'])
  ]);

  await client1.end();
  await client2.end();

  const success1 = res1.rows[0].res.status === 'held';
  const success2 = res2.rows[0].res.status === 'confirmed';

  if (success1 && success2) {
    console.log(`TEST 4 RESULT: PASSED (Both adjacent bookings succeeded without false collision)`);
    return true;
  } else {
    console.error(`TEST 4 RESULT: FAILED (Adjacent bookings suffered false conflict)`);
    return false;
  }
}

async function verifyDatabaseInvariants(adminClient, fixtures) {
  console.log(`\n================================================================`);
  console.log(`DATABASE INVARIANTS INSPECTION`);
  console.log(`================================================================`);

  const overlapCheck = await adminClient.query(`
    SELECT a1.id as id1, a2.id as id2, a1.starts_at, a1.ends_at
    FROM public.inventory_allocations a1
    JOIN public.inventory_allocations a2 ON a1.resource_id = a2.resource_id AND a1.id <> a2.id
    WHERE a1.resource_id = $1
      AND (a1.released_at IS NULL AND (a1.expires_at IS NULL OR a1.expires_at > now()))
      AND (a2.released_at IS NULL AND (a2.expires_at IS NULL OR a2.expires_at > now()))
      AND a1.occupied_period && a2.occupied_period;
  `, [fixtures.resourceId]);

  if (overlapCheck.rows.length === 0) {
    console.log(`Exclusion Invariant: 0 overlapping active allocations found in database. [CLEAN]`);
    return true;
  } else {
    console.error(`Exclusion Invariant VIOLATED: Found ${overlapCheck.rows.length} overlapping allocations!`);
    return false;
  }
}

function setupCrashSafety(adminClient) {
  const restoreTriggers = async () => {
    try {
      await adminClient.query(`
        ALTER TABLE private.ledger_entries ENABLE TRIGGER trg_immutable_ledger_entries;
        ALTER TABLE private.ledger_journals ENABLE TRIGGER trg_immutable_ledger_journals;
        ALTER TABLE private.audit_events ENABLE TRIGGER trg_audit_events_immutability;
      `);
    } catch (_) {}
  };

  ['SIGINT', 'SIGTERM', 'uncaughtException'].forEach(signal => {
    process.on(signal, async (err) => {
      console.error(`\n[CRASH SAFETY] Caught ${signal}, ensuring triggers are enabled...`, err || '');
      await restoreTriggers();
      process.exit(1);
    });
  });
}

async function main() {
  console.log(`================================================================`);
  console.log(`STARTING CONCURRENCY SUITE: WALKIN VS ONLINE COLLISION`);
  console.log(`================================================================`);

  const adminClient = new Client({ connectionString: DB_URL });
  await adminClient.connect();
  setupCrashSafety(adminClient);

  let fixtures;
  let exitCode = 0;

  // Pre-test Catalog Snapshot: (id, slug) of public turfs
  const preSnapshotRes = await adminClient.query(`
    SELECT id, slug FROM public.turfs ORDER BY slug;
  `);
  const preSnapshot = preSnapshotRes.rows;
  console.log(`Pre-test approved public turfs count: ${preSnapshot.length}`);
  console.log(`Pre-test catalog: ${preSnapshot.map(r => `(${r.id}, ${r.slug})`).join(', ')}`);

  const preResidue = await getResidueSnapshot(adminClient);
  printResidueSnapshot('BEFORE RUN', preResidue);
  assertCleanBaseline('BEFORE RUN', preResidue, preSnapshot);

  try {
    fixtures = await setupFixtures(adminClient);

    const midResidue = await getResidueSnapshot(adminClient);
    printResidueSnapshot('MID RUN (AFTER FIXTURES)', midResidue);

    const test1 = await runSimultaneousCollisionTest(fixtures);
    const test2 = await runActiveHoldVsWalkinTest(adminClient, fixtures);
    const test3 = await runExpiredHoldOpportunisticReleaseTest(adminClient, fixtures);
    const test4 = await runAdjacentSlotsTest(fixtures);
    const invariants = await verifyDatabaseInvariants(adminClient, fixtures);

    if (test1 && test2 && test3 && test4 && invariants) {
      console.log(`\n================================================================`);
      console.log(`ALL CONCURRENCY INVARIANTS PASSED!`);
      console.log(`================================================================`);
    } else {
      console.error(`\n================================================================`);
      console.error(`CONCURRENCY SUITE ENCOUNTERED FAILURES`);
      console.log(`================================================================`);
      exitCode = 1;
    }
  } catch (err) {
    console.error(`Fatal error during concurrency suite:`, err);
    exitCode = 1;
  } finally {
    if (fixtures) {
      console.log('\n--- Cleaning up test fixtures ---');
      await adminClient.query('BEGIN;');
      try {
        await adminClient.query(`
          ALTER TABLE private.ledger_entries DISABLE TRIGGER trg_immutable_ledger_entries;
          ALTER TABLE private.ledger_journals DISABLE TRIGGER trg_immutable_ledger_journals;
          ALTER TABLE private.audit_events DISABLE TRIGGER trg_audit_events_immutability;
        `);

        // 1. Outbox events for bookings on this resource
        await adminClient.query(`
          DELETE FROM private.outbox_events WHERE aggregate_type = 'booking' AND aggregate_id IN (
            SELECT id FROM public.bookings WHERE resource_id = $1
          )
        `, [fixtures.resourceId]);

        // 2. Booking events for bookings on this resource
        await adminClient.query(`
          DELETE FROM public.booking_events WHERE booking_id IN (
            SELECT id FROM public.bookings WHERE resource_id = $1
          )
        `, [fixtures.resourceId]);

        // 3. Inventory allocations
        await adminClient.query(`DELETE FROM public.inventory_allocations WHERE resource_id = $1`, [fixtures.resourceId]);

        // 4. Ledger entries and journals for bookings on this resource
        await adminClient.query(`
          DELETE FROM private.ledger_entries WHERE journal_id IN (
            SELECT id FROM private.ledger_journals WHERE booking_id IN (
              SELECT id FROM public.bookings WHERE resource_id = $1
            )
          )
        `, [fixtures.resourceId]);
        await adminClient.query(`
          DELETE FROM private.ledger_journals WHERE booking_id IN (
            SELECT id FROM public.bookings WHERE resource_id = $1
          )
        `, [fixtures.resourceId]);

        // 5. Bookings
        await adminClient.query(`DELETE FROM public.bookings WHERE resource_id = $1`, [fixtures.resourceId]);

        // 6. Audit events for master owner
        await adminClient.query(`DELETE FROM private.audit_events WHERE master_owner_id = $1`, [fixtures.masterOwnerId]);

        // 7. Ledger entries and accounts for master owner
        await adminClient.query(`DELETE FROM private.ledger_entries WHERE account_id IN (SELECT id FROM private.ledger_accounts WHERE master_owner_id = $1)`, [fixtures.masterOwnerId]);
        await adminClient.query(`DELETE FROM private.ledger_accounts WHERE master_owner_id = $1`, [fixtures.masterOwnerId]);

        // 8. Pricing rules, operating hours, slots
        await adminClient.query(`DELETE FROM public.pricing_rules WHERE resource_id = $1`, [fixtures.resourceId]);
        await adminClient.query(`DELETE FROM public.operating_hours WHERE resource_id = $1`, [fixtures.resourceId]);
        await adminClient.query(`DELETE FROM public.slots WHERE resource_id = $1`, [fixtures.resourceId]);

        // 9. Turf settings, cancellation policy
        await adminClient.query(`DELETE FROM public.turf_booking_settings WHERE turf_id = $1`, [fixtures.turfId]);
        await adminClient.query(`DELETE FROM public.cancellation_policies WHERE id = $1`, [fixtures.policyId]);

        // 10. Employee assignments, employees
        await adminClient.query(`DELETE FROM private.assignment_grants WHERE assignment_id IN (SELECT id FROM public.employee_turf_assignments WHERE turf_id = $1)`, [fixtures.turfId]);
        await adminClient.query(`DELETE FROM public.employee_turf_assignments WHERE turf_id = $1`, [fixtures.turfId]);
        await adminClient.query(`DELETE FROM public.employees WHERE master_owner_id = $1`, [fixtures.masterOwnerId]);

        // 11. Resources, turfs, master owners
        await adminClient.query(`DELETE FROM public.resources WHERE id = $1`, [fixtures.resourceId]);
        await adminClient.query(`DELETE FROM public.turfs WHERE id = $1`, [fixtures.turfId]);
        await adminClient.query(`DELETE FROM public.master_owners WHERE id = $1`, [fixtures.masterOwnerId]);

        // 12. Players, profiles, auth.users
        await adminClient.query(`DELETE FROM public.players WHERE user_id IN ($1, $2, $3)`, [fixtures.ownerId, fixtures.staffUserId, fixtures.onlinePlayerId]);
        await adminClient.query(`DELETE FROM public.profiles WHERE user_id IN ($1, $2, $3)`, [fixtures.ownerId, fixtures.staffUserId, fixtures.onlinePlayerId]);
        await adminClient.query(`DELETE FROM auth.users WHERE id IN ($1, $2, $3)`, [fixtures.ownerId, fixtures.staffUserId, fixtures.onlinePlayerId]);

        await adminClient.query(`
          ALTER TABLE private.ledger_entries ENABLE TRIGGER trg_immutable_ledger_entries;
          ALTER TABLE private.ledger_journals ENABLE TRIGGER trg_immutable_ledger_journals;
          ALTER TABLE private.audit_events ENABLE TRIGGER trg_audit_events_immutability;
        `);
        await adminClient.query('COMMIT;');
        console.log('Collision test fixtures deleted cleanly in dependency order.');
      } catch (err) {
        await adminClient.query('ROLLBACK;');
        try {
          await adminClient.query(`
            ALTER TABLE private.ledger_entries ENABLE TRIGGER trg_immutable_ledger_entries;
            ALTER TABLE private.ledger_journals ENABLE TRIGGER trg_immutable_ledger_journals;
            ALTER TABLE private.audit_events ENABLE TRIGGER trg_audit_events_immutability;
          `);
        } catch (_) {}
        throw err;
      }
    }

    // Catalog Integrity Check: Compare (id, slug) sets before and after
    const postSnapshotRes = await adminClient.query(`
      SELECT id, slug FROM public.turfs ORDER BY slug;
    `);
    const postSnapshot = postSnapshotRes.rows;

    const preMap = new Map(preSnapshot.map(r => [r.id, r.slug]));
    const postMap = new Map(postSnapshot.map(r => [r.id, r.slug]));

    const added = [];
    for (const [id, slug] of postMap.entries()) {
      if (!preMap.has(id)) added.push({ id, slug });
    }

    const removed = [];
    for (const [id, slug] of preMap.entries()) {
      if (!postMap.has(id)) removed.push({ id, slug });
    }

    console.log(`\n--- CATALOG INTEGRITY VERIFICATION ---`);
    if (added.length > 0 || removed.length > 0) {
      console.error(`CATALOG LEAK DETECTED!`);
      if (added.length > 0) console.error(`  Added:   ${JSON.stringify(added)}`);
      if (removed.length > 0) console.error(`  Removed: ${JSON.stringify(removed)}`);
      exitCode = 1;
    } else {
      console.log(`CATALOG INTEGRITY CONFIRMED: Public approved venues remained unchanged at exactly ${postSnapshot.length} entries.`);
      console.log(`Catalog: ${postSnapshot.map(r => `(${r.id}, ${r.slug})`).join(', ')}`);
    }

    // 5-table Residue Check
    const postResidue = await getResidueSnapshot(adminClient);
    printResidueSnapshot('AFTER TEARDOWN', postResidue);

    const residueMatch = postResidue.outbox_events === preResidue.outbox_events &&
                         postResidue.profiles === preResidue.profiles &&
                         postResidue.players === preResidue.players &&
                         postResidue.booking_events === preResidue.booking_events &&
                         postResidue.audit_events === preResidue.audit_events;

    const zeroResidue = postResidue.outbox_events === 0 &&
                        postResidue.booking_events === 0 &&
                        postResidue.audit_events === 0 &&
                        postResidue.profiles === EXPECTED_BASE_PROFILES &&
                        postResidue.players === EXPECTED_BASE_PLAYERS;

    if (!residueMatch || !zeroResidue) {
      console.error('RESIDUE LEAK DETECTED: postResidue !== preResidue or non-zero residue exists!');
      if (!residueMatch) console.error('  5-table residue mismatch detected.');
      if (!zeroResidue) console.error('  Non-zero test residue detected in post-run database.');
      exitCode = 1;
    } else {
      console.log('[PASS] RESIDUE INTEGRITY CONFIRMED: pre === post === 0 test residue.');
    }

    await adminClient.end();
  }

  process.exit(exitCode);
}

main();
