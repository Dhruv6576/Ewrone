/**
 * Concurrency Test Suite: booking_hold_concurrency.js
 * 
 * Verifies true multi-connection race conditions against local PostgreSQL:
 * 1. 50 simultaneous connections competing for the exact same slot interval.
 *    Invariant: Exactly 1 succeeds, 49 fail with SLOT_UNAVAILABLE / SQLSTATE 23P01.
 * 2. Simultaneous adjacent non-overlapping bookings.
 *    Invariant: Both succeed without false conflict.
 * 3. Direct SQL inspection proving 0 overlapping active allocations.
 */

const { Client } = require('pg');
const crypto = require('crypto');

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const CONCURRENCY_COUNT = 50;

async function setupFixtures(adminClient) {
  console.log('\n--- Setting up test fixtures ---');
  
  const ownerId = '90000000-0000-0000-0000-000000000001';
  const masterOwnerId = '91000000-0000-0000-0000-000000000001';
  const turfId = '92000000-0000-0000-0000-000000000001';
  const resourceId = '93000000-0000-0000-0000-000000000001';
  const policyId = '94000000-0000-0000-0000-000000000001';

  // 1. Create Master Owner
  await adminClient.query(`
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES ($1, 'conc_owner@test.com', '{"name": "Concurrency Owner"}')
    ON CONFLICT (id) DO NOTHING;
  `, [ownerId]);

  await adminClient.query(`
    INSERT INTO public.master_owners (id, owner_user_id, business_name, status)
    VALUES ($1, $2, 'Concurrency Test Turf Ltd', 'active')
    ON CONFLICT (id) DO UPDATE SET status = 'active';
  `, [masterOwnerId, ownerId]);

  // 2. Create Approved Turf
  await adminClient.query(`
    INSERT INTO public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status, timezone)
    VALUES ($1, $2, 'concurrency-arena', 'Concurrency Arena', 'Sector 15', 'Ahmedabad',
            extensions.ST_SetSRID(extensions.ST_MakePoint(72.5714, 23.0225), 4326)::extensions.geography, 'approved', 'Asia/Kolkata')
    ON CONFLICT (id) DO UPDATE SET archived_at = NULL, approval_status = 'approved';
  `, [turfId, masterOwnerId]);

  // 3. Create Resource
  await adminClient.query(`
    INSERT INTO public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, active)
    VALUES ($1, $2, $3, 'Ground Concurrency', 30, 60, 240, true)
    ON CONFLICT (id) DO NOTHING;
  `, [resourceId, masterOwnerId, turfId]);

  // 4. Operating Hours (06:00 to 23:00 all days)
  await adminClient.query(`DELETE FROM public.operating_hours WHERE resource_id = $1;`, [resourceId]);
  await adminClient.query(`
    INSERT INTO public.operating_hours (resource_id, iso_weekday, opens_at, closes_at, valid_from)
    SELECT $1, gs, '06:00'::time, '23:00'::time, '2026-01-01'::date
    FROM generate_series(1, 7) gs;
  `, [resourceId]);

  // 5. Pricing Rule (₹500 / 30-min slot = 50000 minor)
  await adminClient.query(`DELETE FROM public.pricing_rules WHERE resource_id = $1;`, [resourceId]);
  await adminClient.query(`
    INSERT INTO public.pricing_rules (master_owner_id, turf_id, resource_id, priority, valid_from, iso_weekdays, starts_local, ends_local, amount_per_increment_minor)
    VALUES ($1, $2, $3, 0, '2026-01-01', '{1,2,3,4,5,6,7}', '06:00', '23:00', 50000);
  `, [masterOwnerId, turfId, resourceId]);

  // 6. Booking settings
  await adminClient.query(`
    INSERT INTO public.cancellation_policies (id, master_owner_id, name, version, rules)
    VALUES ($1, $2, 'Standard Concurrency Policy', 1, '[]'::jsonb)
    ON CONFLICT (id) DO NOTHING;
  `, [policyId, masterOwnerId]);

  await adminClient.query(`
    INSERT INTO public.turf_booking_settings (turf_id, master_owner_id, cancellation_policy_id, advance_basis_points, booking_horizon_days, minimum_lead_minutes, hold_seconds)
    VALUES ($1, $2, $3, 10000, 60, 0, 300)
    ON CONFLICT (turf_id) DO UPDATE
    SET hold_seconds = 300;
  `, [turfId, masterOwnerId, policyId]);

  // 7. Create 50 distinct players in auth.users
  console.log(`Creating ${CONCURRENCY_COUNT} distinct player accounts...`);
  const playerIds = [];
  for (let i = 1; i <= CONCURRENCY_COUNT; i++) {
    const playerId = `a0000000-0000-0000-0000-${String(i).padStart(12, '0')}`;
    playerIds.push(playerId);
    await adminClient.query(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO NOTHING;
    `, [playerId, `player_${i}@concurrency.test`, JSON.stringify({ name: `Concurrent Player ${i}` })]);
  }

  return { resourceId, turfId, masterOwnerId, playerIds };
}

async function runExactSlotContentionTest(fixtures) {
  console.log(`\n================================================================`);
  console.log(`TEST 1: EXACT-SLOT CONTENTION (${CONCURRENCY_COUNT} SIMULTANEOUS CONNECTIONS)`);
  console.log(`================================================================`);
  console.log(`Target: 18:00 to 19:00 IST on 2026-11-15 (12:30 to 13:30 UTC)`);
  console.log(`Firing ${CONCURRENCY_COUNT} simultaneous create_booking_hold requests...`);

  const startsAt = '2026-11-15T12:30:00.000Z';
  const endsAt   = '2026-11-15T13:30:00.000Z';

  // Open 50 distinct database connections
  const clients = [];
  for (let i = 0; i < CONCURRENCY_COUNT; i++) {
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    // Authenticate session as distinct player
    await client.query(`SET ROLE authenticated;`);
    await client.query(`SELECT set_config('request.jwt.claims', $1, false);`, [
      JSON.stringify({ sub: fixtures.playerIds[i], role: 'authenticated' })
    ]);
    clients.push(client);
  }

  // Barrier sync: execute all 50 queries concurrently
  const startTime = Date.now();
  const results = await Promise.all(
    clients.map(async (client, index) => {
      const idempotencyKey = `race-${index}-${crypto.randomUUID()}`;
      try {
        const res = await client.query(
          `SELECT public.create_booking_hold($1, $2, $3, $4, $5, $6, $7) AS hold_result;`,
          [
            fixtures.resourceId,
            startsAt,
            endsAt,
            idempotencyKey,
            `Player ${index + 1}`,
            '9876543210',
            `player_${index + 1}@test.com`
          ]
        );
        return { success: true, index, data: res.rows[0].hold_result };
      } catch (err) {
        return {
          success: false,
          index,
          code: err.code,
          message: err.message
        };
      }
    })
  );

  const durationMs = Date.now() - startTime;

  // Disconnect all clients
  await Promise.all(clients.map(c => c.end()));

  // Analyze Results
  const successes = results.filter(r => r.success);
  const slotUnavailableFailures = results.filter(
    r => !r.success && (r.code === '23P01' || r.message.includes('SLOT_UNAVAILABLE'))
  );
  const otherFailures = results.filter(
    r => !r.success && !(r.code === '23P01' || r.message.includes('SLOT_UNAVAILABLE'))
  );

  console.log(`Completed in ${durationMs} ms`);
  console.log(`Total Requests:         ${CONCURRENCY_COUNT}`);
  console.log(`Success Count:          ${successes.length}  (Expected: 1)`);
  console.log(`SLOT_UNAVAILABLE (23P01): ${slotUnavailableFailures.length} (Expected: ${CONCURRENCY_COUNT - 1})`);
  console.log(`Other Errors:           ${otherFailures.length}  (Expected: 0)`);

  if (otherFailures.length > 0) {
    console.error('Unexpected error details:', otherFailures);
  }

  return { successes, slotUnavailableFailures, otherFailures };
}

async function verifyZeroOverlapsInDatabase(adminClient, resourceId) {
  console.log('\n--- Verifying Database Integrity via Direct SQL Queries ---');

  // Query 1: Active allocations for this resource
  const countRes = await adminClient.query(`
    SELECT count(*)::int as active_count
    FROM public.inventory_allocations
    WHERE resource_id = $1
      AND released_at IS NULL;
  `, [resourceId]);

  console.log(`Active Allocations Found: ${countRes.rows[0].active_count} (Expected: 1)`);

  // Query 2: Overlapping active intervals check (GiST && self-join)
  const overlapRes = await adminClient.query(`
    SELECT
      a1.id as alloc1_id,
      a1.starts_at as a1_start,
      a1.ends_at as a1_end,
      a2.id as alloc2_id,
      a2.starts_at as a2_start,
      a2.ends_at as a2_end
    FROM public.inventory_allocations a1
    JOIN public.inventory_allocations a2
      ON a1.resource_id = a2.resource_id
     AND a1.id <> a2.id
     AND a1.released_at IS NULL
     AND a2.released_at IS NULL
     AND a1.occupied_period && a2.occupied_period
    WHERE a1.resource_id = $1;
  `, [resourceId]);

  console.log(`Overlapping Pairs Found:  ${overlapRes.rows.length} (Expected: 0)`);

  const passed = countRes.rows[0].active_count === 1 && overlapRes.rows.length === 0;
  return passed;
}

async function runAdjacentIntervalConcurrencyTest(fixtures) {
  console.log(`\n================================================================`);
  console.log(`TEST 2: ADJACENT NON-OVERLAPPING INTERVAL CONCURRENCY (2 CLIENTS)`);
  console.log(`================================================================`);
  console.log(`Interval 1: 19:00 to 20:00 IST (13:30 to 14:30 UTC)`);
  console.log(`Interval 2: 20:00 to 21:00 IST (14:30 to 15:30 UTC)`);

  const client1 = new Client({ connectionString: DB_URL });
  const client2 = new Client({ connectionString: DB_URL });

  await client1.connect();
  await client2.connect();

  await client1.query(`SET ROLE authenticated;`);
  await client1.query(`SELECT set_config('request.jwt.claims', $1, false);`, [
    JSON.stringify({ sub: fixtures.playerIds[0], role: 'authenticated' })
  ]);

  await client2.query(`SET ROLE authenticated;`);
  await client2.query(`SELECT set_config('request.jwt.claims', $1, false);`, [
    JSON.stringify({ sub: fixtures.playerIds[1], role: 'authenticated' })
  ]);

  const [res1, res2] = await Promise.all([
    client1.query(`
      SELECT public.create_booking_hold($1, $2, $3, $4, $5, $6, $7) AS res;
    `, [fixtures.resourceId, '2026-11-15T13:30:00.000Z', '2026-11-15T14:30:00.000Z', `adj-1-${Date.now()}`, 'Adj 1', '9999999991', 'adj1@test.com']),
    client2.query(`
      SELECT public.create_booking_hold($1, $2, $3, $4, $5, $6, $7) AS res;
    `, [fixtures.resourceId, '2026-11-15T14:30:00.000Z', '2026-11-15T15:30:00.000Z', `adj-2-${Date.now()}`, 'Adj 2', '9999999992', 'adj2@test.com'])
  ]);

  await client1.end();
  await client2.end();

  const success1 = res1.rows[0].res.status === 'held';
  const success2 = res2.rows[0].res.status === 'held';

  console.log(`Interval 1 Result: ${res1.rows[0].res.status} (Expected: held)`);
  console.log(`Interval 2 Result: ${res2.rows[0].res.status} (Expected: held)`);
  console.log(`Both Succeeded:   ${success1 && success2 ? 'YES' : 'NO'}`);

  return success1 && success2;
}

async function main() {
  const adminClient = new Client({ connectionString: DB_URL });
  await adminClient.connect();

  let fixtures = null;
  let exitCode = 0;
  let preSnapshot = [];

  try {
    // 0. Capture initial public approved unarchived catalog snapshot (id, slug)
    const preSnapshotRes = await adminClient.query(`
      SELECT id, slug FROM public.turfs WHERE approval_status = 'approved' AND archived_at IS NULL ORDER BY slug;
    `);
    preSnapshot = preSnapshotRes.rows;

    fixtures = await setupFixtures(adminClient);

    // Clean any prior allocations on test resource
    await adminClient.query(`DELETE FROM public.booking_slots WHERE resource_id = $1;`, [fixtures.resourceId]);
    await adminClient.query(`DELETE FROM public.inventory_allocations WHERE resource_id = $1;`, [fixtures.resourceId]);
    await adminClient.query(`DELETE FROM public.bookings WHERE resource_id = $1;`, [fixtures.resourceId]);

    // Test 1: Contention race
    const test1 = await runExactSlotContentionTest(fixtures);
    const zeroOverlaps = await verifyZeroOverlapsInDatabase(adminClient, fixtures.resourceId);

    // Test 2: Adjacent intervals
    const adjacentPassed = await runAdjacentIntervalConcurrencyTest(fixtures);

    console.log(`\n================================================================`);
    console.log(`CONCURRENCY TEST SUMMARY`);
    console.log(`================================================================`);
    const test1Passed = test1.successes.length === 1 && test1.slotUnavailableFailures.length === (CONCURRENCY_COUNT - 1);
    console.log(`50-Connection Contention Race: ${test1Passed ? 'PASS' : 'FAIL'}`);
    console.log(`Zero Overlaps in Database:     ${zeroOverlaps ? 'PASS' : 'FAIL'}`);
    console.log(`Adjacent Interval Concurrency: ${adjacentPassed ? 'PASS' : 'FAIL'}`);

    if (test1Passed && zeroOverlaps && adjacentPassed) {
      console.log(`\nOVERALL CONCURRENCY VERIFICATION: ALL INVARIANTS PASSED!`);
    } else {
      console.error(`\nOVERALL CONCURRENCY VERIFICATION: FAILED`);
      exitCode = 1;
    }
  } catch (err) {
    console.error('Fatal error during concurrency test:', err);
    exitCode = 1;
  } finally {
    if (fixtures) {
      console.log('Cleaning up concurrency test fixtures...');
      await adminClient.query(`DELETE FROM public.booking_slots WHERE resource_id = $1;`, [fixtures.resourceId]);
      await adminClient.query(`DELETE FROM public.inventory_allocations WHERE resource_id = $1;`, [fixtures.resourceId]);
      await adminClient.query(`DELETE FROM public.bookings WHERE resource_id = $1;`, [fixtures.resourceId]);
      await adminClient.query(`DELETE FROM public.slots WHERE resource_id = $1;`, [fixtures.resourceId]);
      await adminClient.query(`DELETE FROM public.pricing_rules WHERE resource_id = $1;`, [fixtures.resourceId]);
      await adminClient.query(`DELETE FROM public.operating_hours WHERE resource_id = $1;`, [fixtures.resourceId]);
      await adminClient.query(`DELETE FROM public.turf_booking_settings WHERE turf_id = $1;`, [fixtures.turfId]);
      await adminClient.query(`DELETE FROM public.cancellation_policies WHERE id = $1;`, ['94000000-0000-0000-0000-000000000001']);
      await adminClient.query(`DELETE FROM public.resources WHERE id = $1;`, [fixtures.resourceId]);
      await adminClient.query(`DELETE FROM public.turfs WHERE id = $1;`, [fixtures.turfId]);
      await adminClient.query(`DELETE FROM public.master_owners WHERE id = $1;`, [fixtures.masterOwnerId]);
      await adminClient.query(`DELETE FROM auth.users WHERE email LIKE '%@concurrency.test' OR id = '90000000-0000-0000-0000-000000000001';`);
      console.log('Concurrency test fixtures successfully cleaned up.');
    }

    // Leak Assertion: Verify public catalog (id, slug) matches pre-test snapshot exactly
    const postSnapshotRes = await adminClient.query(`
      SELECT id, slug FROM public.turfs WHERE approval_status = 'approved' AND archived_at IS NULL ORDER BY slug;
    `);
    const postSnapshot = postSnapshotRes.rows;

    const preMap = new Map(preSnapshot.map(r => [r.id, r.slug]));
    const postMap = new Map(postSnapshot.map(r => [r.id, r.slug]));

    const added = [];
    for (const [id, slug] of postMap.entries()) {
      if (!preMap.has(id)) {
        added.push({ id, slug });
      }
    }

    const removed = [];
    for (const [id, slug] of preMap.entries()) {
      if (!postMap.has(id)) {
        removed.push({ id, slug });
      }
    }

    if (added.length > 0 || removed.length > 0) {
      console.error(`LEAK DETECTED in public catalog!`);
      if (added.length > 0) console.error(`  Added venues:   ${JSON.stringify(added)}`);
      if (removed.length > 0) console.error(`  Removed venues: ${JSON.stringify(removed)}`);
      exitCode = 1;
    } else {
      console.log(`CATALOG INTEGRITY CONFIRMED: Public approved venues remained unchanged at exactly ${postSnapshot.length} (${postSnapshot.map(r => r.slug).join(', ')}).`);
    }

    await adminClient.end();
  }

  process.exit(exitCode);
}

main();
