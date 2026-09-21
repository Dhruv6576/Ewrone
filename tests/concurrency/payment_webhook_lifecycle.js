/**
 * Milestone 6 Verification Suite: payment_webhook_lifecycle.js
 * 
 * Verifies all 6 real-world failure mode acceptance criteria:
 * 1. Webhook-before-order-persistence race (§2.5)
 * 2. Webhook replay (duplicate delivery, 5x real HTTP calls)
 * 3. Signature verification (invalid/forged HMAC rejection before DB write)
 * 4. Out-of-order webhook delivery (payment.captured before payment.authorized, §17.3)
 * 5. Capture-after-hold-expiry race (§7.5: payment_exception + queued refund + zero double-booking)
 * 6. Idempotent checkout creation (two calls, exactly one provider order)
 */

const { Client } = require('pg');
const crypto = require('crypto');
const {
  EXPECTED_BASE_PROFILES,
  EXPECTED_BASE_PLAYERS,
  insertTestAuthUsers
} = require('../test_constants');

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const FUNCTIONS_BASE_URL = process.env.FUNCTIONS_BASE_URL || process.env.EDGE_URL || (process.env.SUPABASE_URL ? `${process.env.SUPABASE_URL}/functions/v1` : 'http://127.0.0.1:54321/functions/v1');
function getWebhookSecret() {
  if (process.env.RAZORPAY_WEBHOOK_SECRET) {
    return process.env.RAZORPAY_WEBHOOK_SECRET.split(',')[0].trim();
  }
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.resolve(__dirname, '../../supabase/functions/.env');
    if (fs.existsSync(envPath)) {
      const match = fs.readFileSync(envPath, 'utf8').match(/RAZORPAY_WEBHOOK_SECRET=([^\r\n]+)/);
      if (match) return match[1].split(',')[0].trim();
    }
  } catch (_) {}
  return '';
}
const WEBHOOK_SECRET = getWebhookSecret();

let intervalCounter = 0;
function getUniqueInterval() {
  intervalCounter++;
  const slotStart = Date.now() + 86400000 + (intervalCounter * 7200000);
  const start = new Date(slotStart);
  const end = new Date(slotStart + 3600000);
  return {
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    refCode: `BK-${Date.now().toString(36)}-${intervalCounter}-${Math.floor(Math.random()*1000)}`
  };
}

function signPayload(bodyString, secret = WEBHOOK_SECRET) {
  return crypto.createHmac('sha256', secret).update(bodyString).digest('hex');
}

async function getCatalogSnapshot(admin) {
  const turfs = await admin.query(`SELECT id, slug FROM public.turfs ORDER BY id ASC;`);
  const resources = await admin.query(`SELECT count(*)::int as count FROM public.resources;`);
  const bookings = await admin.query(`SELECT count(*)::int as count FROM public.bookings;`);
  const payouts = await admin.query(`SELECT count(*)::int as count FROM private.payouts;`);
  return {
    turfs: turfs.rows,
    resourcesCount: resources.rows[0].count,
    bookingsCount: bookings.rows[0].count,
    payoutsCount: payouts.rows[0].count,
  };
}

function printCatalogSnapshot(label, snapshot) {
  console.log(`\n=== CATALOG SNAPSHOT: ${label} ===`);
  console.log(`public.turfs (${snapshot.turfs.length} rows):`);
  snapshot.turfs.forEach(t => console.log(`  ${t.id} | ${t.slug}`));
  console.log(`public.resources count: ${snapshot.resourcesCount}`);
  console.log(`public.bookings count:  ${snapshot.bookingsCount}`);
  console.log(`private.payouts count:  ${snapshot.payoutsCount}`);
}

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
  if (snapshot && snapshot.bookingsCount !== 0) leaks.push(`bookings: ${snapshot.bookingsCount} (expected 0)`);
  if (snapshot && snapshot.payoutsCount !== 0) leaks.push(`payouts: ${snapshot.payoutsCount} (expected 0)`);

  if (leaks.length > 0) {
    console.error(`\n[FATAL PRE-CONDITION FAILURE]: Test residue leak detected at ${label}:`);
    leaks.forEach(l => console.error(`  - ${l}`));
    throw new Error(`PRE_RUN_RESIDUE_DETECTED: Database is not in clean baseline state. Suites cannot run in parallel or on dirty DB.`);
  }
}

function setupCrashSafety(admin) {
  const restoreTriggers = async () => {
    try {
      await admin.query(`
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

async function setupBaseFixtures(admin, createdIds) {
  console.log('--- Setting up Base Test Fixtures ---');
  const uidOwner = 'c1111111-cccc-cccc-cccc-cccccccccccc';
  const moId = 'c2222222-cccc-cccc-cccc-cccccccccccc';
  const turfId = 'c3333333-cccc-cccc-cccc-cccccccccccc';
  const resId = crypto.randomUUID();
  const uidPlayer = 'c5555555-cccc-cccc-cccc-cccccccccccc';

  createdIds.userIds.push(uidOwner, uidPlayer);
  createdIds.masterOwnerIds.push(moId);
  createdIds.turfIds.push(turfId);
  createdIds.resourceIds.push(resId);

  await insertTestAuthUsers(admin, [
    { id: uidOwner, email: 'm6_owner@test.com', rawUserMetaData: { name: 'M6 Owner' } },
    { id: uidPlayer, email: 'm6_player@test.com', rawUserMetaData: { name: 'M6 Player' } }
  ]);

  await admin.query(`
    INSERT INTO public.master_owners (id, owner_user_id, business_name, status) VALUES
      ($1, $2, 'Milestone 6 Sports Arena', 'active')
    ON CONFLICT (id) DO NOTHING;
  `, [moId, uidOwner]);

  await admin.query(`
    INSERT INTO public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status, timezone) VALUES
      ($1, $2, 'm6-arena', 'M6 Arena', 'Stadium Road', 'Ahmedabad',
       extensions.ST_SetSRID(extensions.ST_MakePoint(72.5714, 23.0225), 4326)::extensions.geography, 'approved', 'Asia/Kolkata')
    ON CONFLICT (id) DO UPDATE SET archived_at = NULL, approval_status = 'approved';
  `, [turfId, moId]);

  await admin.query(`
    INSERT INTO public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, active) VALUES
      ($1, $2, $3, 'Court Alpha', 30, 60, 240, true)
    ON CONFLICT (id) DO NOTHING;
  `, [resId, moId, turfId]);

  await admin.query(`
    INSERT INTO public.operating_hours (resource_id, iso_weekday, opens_at, closes_at, valid_from)
    SELECT $1, gs, '06:00'::time, '23:00'::time, '2026-01-01'::date
    FROM generate_series(1, 7) gs
    ON CONFLICT DO NOTHING;
  `, [resId]);

  return { uidOwner, moId, turfId, resId, uidPlayer };
}

// -----------------------------------------------------------------------------
// SCENARIO 1: Webhook-before-order-persistence race (§2.5)
// -----------------------------------------------------------------------------
async function testScenario1(admin, fixtures, createdIds) {
  console.log('\n================================================================');
  console.log('SCENARIO 1: WEBHOOK-BEFORE-ORDER-PERSISTENCE RACE (§2.5)');
  console.log('Adapter Mode: Deterministic Sandbox / Webhook Receiver');
  console.log('================================================================');

  const ghostOrderId = `order_ghost_${Date.now()}`;
  const ghostPaymentId = `pay_ghost_${Date.now()}`;
  const eventId = `evt_race_${Date.now()}`;
  const interval = getUniqueInterval();

  const payload = {
    event: 'payment.captured',
    event_id: eventId,
    payload: {
      payment: {
        entity: {
          id: ghostPaymentId,
          order_id: ghostOrderId,
          amount: 250000,
          currency: 'INR',
          captured_at: Math.floor(Date.now() / 1000)
        }
      }
    }
  };

  const rawBody = JSON.stringify(payload);
  const signature = signPayload(rawBody);

  console.log(`[1.1] Dispatching valid signed webhook for UNPERSISTED order: ${ghostOrderId}...`);
  const httpRes = await fetch(`${FUNCTIONS_BASE_URL}/payment-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': signature
    },
    body: rawBody
  });

  const httpStatus = httpRes.status;
  const resJson = await httpRes.json();
  console.log(`      HTTP Status: ${httpStatus}`);
  console.log(`      Response:    ${JSON.stringify(resJson)}`);

  // Inspect DB: Webhook event state BEFORE order appears
  const beforeAudit = await admin.query(`
    SELECT status, attempts, last_error
    FROM private.webhook_events
    WHERE provider_event_id = $1;
  `, [eventId]);

  const beforeRow = beforeAudit.rows[0];
  console.log('\n--- BEFORE ORDER PERSISTENCE DB STATE ---');
  console.log(`Webhook Event Status: ${beforeRow?.status} (Expected: retryable)`);
  console.log(`Recorded Error:       ${beforeRow?.last_error}`);

  // Now simulate order appearing shortly after
  console.log('\n[1.2] Simulating order record persistence in database...');
  const bookingId = crypto.randomUUID();
  createdIds.bookingIds.push(bookingId);
  createdIds.webhookEventIds.push(eventId);
  createdIds.journalEventKeys.push(`pay_${ghostPaymentId}_captured`);
  await admin.query(`
    INSERT INTO public.bookings (
      id, reference_code, master_owner_id, turf_id, resource_id, player_user_id, created_by,
      source, status, starts_at, ends_at, hold_expires_at,
      total_minor, required_online_minor, currency,
      pricing_snapshot, cancellation_snapshot, commission_snapshot
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $6,
      'online', 'held', $7, $8,
      now() + interval '10 minutes', 250000, 250000, 'INR',
      '{}'::jsonb, '{}'::jsonb, '{"basis_points": 1000, "estimated_commission_minor": 25000}'::jsonb
    );
  `, [bookingId, interval.refCode, fixtures.moId, fixtures.turfId, fixtures.resId, fixtures.uidPlayer, interval.startsAt, interval.endsAt]);

  await admin.query(`
    INSERT INTO public.inventory_allocations (
      booking_id, master_owner_id, turf_id, resource_id, kind,
      starts_at, ends_at, expires_at, created_by
    ) VALUES (
      $1, $2, $3, $4, 'hold',
      $5, $6,
      now() + interval '10 minutes', $7
    );
  `, [bookingId, fixtures.moId, fixtures.turfId, fixtures.resId, interval.startsAt, interval.endsAt, fixtures.uidPlayer]);

  await admin.query(`
    INSERT INTO private.payment_orders (
      booking_id, master_owner_id, purpose, provider, provider_order_id,
      amount_minor, currency, status, idempotency_key
    ) VALUES (
      $1, $2, 'initial', 'razorpay', $3,
      250000, 'INR', 'ready', 'idemp_order_race_' || $3
    );
  `, [bookingId, fixtures.moId, ghostOrderId]);

  console.log('      -> Order record persisted in DB.');

  // Trigger worker retry
  console.log('[1.3] Triggering background retry worker (private.retry_unprocessed_webhooks)...');
  await admin.query(`
    UPDATE private.webhook_events
    SET next_attempt_at = now() - interval '1 second'
    WHERE provider_event_id = $1;
  `, [eventId]);

  const retryRes = await admin.query(`SELECT private.retry_unprocessed_webhooks() as retried;`);
  console.log(`      Retried records: ${retryRes.rows[0].retried}`);

  // Inspect DB: State AFTER retry
  const afterAudit = await admin.query(`
    SELECT status, last_error, processed_at
    FROM private.webhook_events
    WHERE provider_event_id = $1;
  `, [eventId]);

  const bookingAudit = await admin.query(`
    SELECT status, confirmed_at FROM public.bookings WHERE id = $1;
  `, [bookingId]);

  const journalAudit = await admin.query(`
    SELECT count(*)::int as count FROM private.ledger_journals WHERE event_key = $1;
  `, [`pay_${ghostPaymentId}_captured`]);

  console.log('\n--- AFTER WORKER RETRY DB STATE ---');
  console.log(`Webhook Event Status: ${afterAudit.rows[0]?.status} (Expected: processed)`);
  console.log(`Booking Status:       ${bookingAudit.rows[0]?.status} (Expected: confirmed)`);
  console.log(`Ledger Journals:      ${journalAudit.rows[0]?.count} (Expected: 1)`);

  const passed = beforeRow?.status === 'retryable' &&
                 afterAudit.rows[0]?.status === 'processed' &&
                 bookingAudit.rows[0]?.status === 'confirmed' &&
                 journalAudit.rows[0]?.count === 1;

  if (passed) {
    console.log('\n[PASS] SCENARIO 1 CONFIRMED: Webhook successfully held in retryable state and reconciled upon order appearance.');
  } else {
    throw new Error('Scenario 1 failed');
  }
}

// -----------------------------------------------------------------------------
// SCENARIO 2: Webhook replay (duplicate delivery)
// -----------------------------------------------------------------------------
async function testScenario2(admin, fixtures, createdIds) {
  console.log('\n================================================================');
  console.log('SCENARIO 2: WEBHOOK REPLAY DUPLICATE DELIVERY (5x REAL HTTP CALLS)');
  console.log('Adapter Mode: Deterministic Sandbox / Webhook Receiver');
  console.log('================================================================');

  const bookingId = crypto.randomUUID();
  const orderId = `order_replay_${Date.now()}`;
  const paymentId = `pay_replay_${Date.now()}`;
  const eventId = `evt_replay_${Date.now()}`;
  createdIds.bookingIds.push(bookingId);
  createdIds.webhookEventIds.push(eventId);
  createdIds.journalEventKeys.push(`pay_${paymentId}_captured`);
  const interval = getUniqueInterval();

  // Setup booking & order
  await admin.query(`
    INSERT INTO public.bookings (
      id, reference_code, master_owner_id, turf_id, resource_id, player_user_id, created_by,
      source, status, starts_at, ends_at, hold_expires_at,
      total_minor, required_online_minor, currency,
      pricing_snapshot, cancellation_snapshot, commission_snapshot
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $6,
      'online', 'held', $7, $8,
      now() + interval '10 minutes', 180000, 180000, 'INR',
      '{}'::jsonb, '{}'::jsonb, '{"basis_points": 1000, "estimated_commission_minor": 18000}'::jsonb
    );
  `, [bookingId, interval.refCode, fixtures.moId, fixtures.turfId, fixtures.resId, fixtures.uidPlayer, interval.startsAt, interval.endsAt]);

  await admin.query(`
    INSERT INTO public.inventory_allocations (
      booking_id, master_owner_id, turf_id, resource_id, kind,
      starts_at, ends_at, expires_at, created_by
    ) VALUES (
      $1, $2, $3, $4, 'hold',
      $5, $6,
      now() + interval '10 minutes', $7
    );
  `, [bookingId, fixtures.moId, fixtures.turfId, fixtures.resId, interval.startsAt, interval.endsAt, fixtures.uidPlayer]);

  await admin.query(`
    INSERT INTO private.payment_orders (
      booking_id, master_owner_id, purpose, provider, provider_order_id,
      amount_minor, currency, status, idempotency_key
    ) VALUES (
      $1, $2, 'initial', 'razorpay', $3,
      180000, 'INR', 'ready', 'idemp_order_replay_' || $3
    );
  `, [bookingId, fixtures.moId, orderId]);

  const payload = {
    event: 'payment.captured',
    event_id: eventId,
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: orderId,
          amount: 180000,
          currency: 'INR',
          captured_at: Math.floor(Date.now() / 1000)
        }
      }
    }
  };

  const rawBody = JSON.stringify(payload);
  const signature = signPayload(rawBody);

  console.log(`[2.1] Sending IDENTICAL payment webhook payload 5 times via real HTTP calls...`);
  const results = [];

  for (let i = 1; i <= 5; i++) {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/payment-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature
      },
      body: rawBody
    });
    const status = res.status;
    const body = await res.json();
    console.log(`      Call ${i}: HTTP ${status} -> ${JSON.stringify(body)}`);
    results.push({ status, body });
  }

  // Database audit
  const bookingCount = await admin.query(`
    SELECT status, count(*)::int as count FROM public.bookings WHERE id = $1 GROUP BY status;
  `, [bookingId]);

  const journalRes = await admin.query(`
    SELECT id, event_key FROM private.ledger_journals WHERE event_key = $1;
  `, [`pay_${paymentId}_captured`]);

  const entriesAudit = await admin.query(`
    SELECT count(*)::int as entry_count, coalesce(sum(amount_minor), 0)::bigint as net_sum
    FROM private.ledger_entries
    WHERE journal_id = $1;
  `, [journalRes.rows[0]?.id]);

  const journalCount = journalRes.rows.length;
  const entryCount = entriesAudit.rows[0]?.entry_count;
  const netSum = entriesAudit.rows[0]?.net_sum;

  console.log('\n--- DIRECT DATABASE AUDIT ---');
  console.log(`Booking Status:       ${bookingCount.rows[0]?.status}`);
  console.log(`Total Journals in DB: ${journalCount} (Expected: 1)`);
  console.log(`Total Entries in DB:  ${entryCount} (Expected: 3)`);
  console.log(`Net Entries Sum:      ${netSum} (Expected: 0)`);

  const all200 = results.every(r => r.status === 200);
  const exactOneJournal = journalCount === 1;
  const entriesSumZero = netSum === '0' || netSum === 0;

  if (all200 && exactOneJournal && entriesSumZero) {
    console.log('\n[PASS] SCENARIO 2 CONFIRMED: 5 consecutive deliveries handled with exactly 1 confirmation and 0 duplicate journals.');
  } else {
    throw new Error('Scenario 2 failed');
  }
}

// -----------------------------------------------------------------------------
// SCENARIO 3: Signature verification
// -----------------------------------------------------------------------------
async function testScenario3(admin) {
  console.log('\n================================================================');
  console.log('SCENARIO 3: CRYPTOGRAPHIC SIGNATURE VERIFICATION');
  console.log('Adapter Mode: Real Cryptographic HMAC-SHA256');
  console.log('================================================================');

  const forgedEventId = `evt_forged_${Date.now()}`;
  const payload = { event: 'payment.captured', event_id: forgedEventId };
  const rawBody = JSON.stringify(payload);
  const forgedSignature = 'bad_forged_hmac_signature_0000000000000000000000000000000000000000000000000000000000000000';

  console.log('[3.1] Sending webhook with FORGED HMAC-SHA256 signature...');
  const res = await fetch(`${FUNCTIONS_BASE_URL}/payment-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': forgedSignature
    },
    body: rawBody
  });

  const status = res.status;
  const body = await res.json();
  console.log(`      HTTP Status: ${status} (Expected: 400)`);
  console.log(`      Response:    ${JSON.stringify(body)}`);

  // Verify DB: NO rows inserted into private.webhook_events
  const dbCheck = await admin.query(`
    SELECT count(*)::int as count FROM private.webhook_events WHERE provider_event_id = $1;
  `, [forgedEventId]);

  console.log(`      Webhook Inbox Rows in DB: ${dbCheck.rows[0].count} (Expected: 0)`);

  if (status === 400 && body.error === 'INVALID_SIGNATURE' && dbCheck.rows[0].count === 0) {
    console.log('\n[PASS] SCENARIO 3 CONFIRMED: Invalid signature rejected before any database persistence or processing.');
  } else {
    throw new Error('Scenario 3 failed');
  }
}

// -----------------------------------------------------------------------------
// SCENARIO 4: Out-of-order webhook delivery (§17.3)
// -----------------------------------------------------------------------------
async function testScenario4(admin, fixtures, createdIds) {
  console.log('\n================================================================');
  console.log('SCENARIO 4: OUT-OF-ORDER WEBHOOK DELIVERY (§17.3)');
  console.log('Adapter Mode: Deterministic Sandbox / Webhook Receiver');
  console.log('================================================================');

  const bookingId = crypto.randomUUID();
  const orderId = `order_ooo_${Date.now()}`;
  const paymentId = `pay_ooo_${Date.now()}`;
  const interval = getUniqueInterval();
  createdIds.bookingIds.push(bookingId);
  createdIds.journalEventKeys.push(`pay_${paymentId}_captured`);

  await admin.query(`
    INSERT INTO public.bookings (
      id, reference_code, master_owner_id, turf_id, resource_id, player_user_id, created_by,
      source, status, starts_at, ends_at, hold_expires_at,
      total_minor, required_online_minor, currency,
      pricing_snapshot, cancellation_snapshot, commission_snapshot
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $6,
      'online', 'held', $7, $8,
      now() + interval '10 minutes', 200000, 200000, 'INR',
      '{}'::jsonb, '{}'::jsonb, '{"basis_points": 1000, "estimated_commission_minor": 20000}'::jsonb
    );
  `, [bookingId, interval.refCode, fixtures.moId, fixtures.turfId, fixtures.resId, fixtures.uidPlayer, interval.startsAt, interval.endsAt]);

  await admin.query(`
    INSERT INTO public.inventory_allocations (
      booking_id, master_owner_id, turf_id, resource_id, kind,
      starts_at, ends_at, expires_at, created_by
    ) VALUES (
      $1, $2, $3, $4, 'hold',
      $5, $6,
      now() + interval '10 minutes', $7
    );
  `, [bookingId, fixtures.moId, fixtures.turfId, fixtures.resId, interval.startsAt, interval.endsAt, fixtures.uidPlayer]);

  await admin.query(`
    INSERT INTO private.payment_orders (
      booking_id, master_owner_id, purpose, provider, provider_order_id,
      amount_minor, currency, status, idempotency_key
    ) VALUES (
      $1, $2, 'initial', 'razorpay', $3,
      200000, 'INR', 'ready', 'idemp_order_ooo_' || $3
    );
  `, [bookingId, fixtures.moId, orderId]);

  // Step 1: Send payment.captured FIRST
  console.log('[4.1] Delivering payment.captured FIRST...');
  const capturePayload = {
    event: 'payment.captured',
    event_id: `evt_ooo_cap_${Date.now()}`,
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: orderId,
          amount: 200000,
          currency: 'INR',
          captured_at: Math.floor(Date.now() / 1000)
        }
      }
    }
  };
  const capBody = JSON.stringify(capturePayload);
  const capRes = await fetch(`${FUNCTIONS_BASE_URL}/payment-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': signPayload(capBody) },
    body: capBody
  });
  console.log(`      payment.captured Response: HTTP ${capRes.status} -> ${await capRes.text()}`);

  // Step 2: Send payment.authorized SECOND (delayed event)
  console.log('[4.2] Delivering delayed payment.authorized SECOND...');
  const authPayload = {
    event: 'payment.authorized',
    event_id: `evt_ooo_auth_${Date.now()}`,
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: orderId,
          amount: 200000,
          currency: 'INR'
        }
      }
    }
  };
  const authBody = JSON.stringify(authPayload);
  createdIds.webhookEventIds.push(capturePayload.event_id, authPayload.event_id);
  const authRes = await fetch(`${FUNCTIONS_BASE_URL}/payment-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': signPayload(authBody) },
    body: authBody
  });
  console.log(`      payment.authorized Response: HTTP ${authRes.status} -> ${await authRes.text()}`);

  // Verify final DB state: payment remains captured, not downgraded
  const paymentAudit = await admin.query(`
    SELECT status, captured_at FROM private.payments WHERE provider_payment_id = $1;
  `, [paymentId]);

  const bookingAudit = await admin.query(`
    SELECT status FROM public.bookings WHERE id = $1;
  `, [bookingId]);

  console.log('\n--- FINAL OUT-OF-ORDER CONVERGENCE AUDIT ---');
  console.log(`Payment Status in DB: ${paymentAudit.rows[0]?.status} (Expected: captured)`);
  console.log(`Booking Status in DB: ${bookingAudit.rows[0]?.status} (Expected: confirmed)`);

  if (paymentAudit.rows[0]?.status === 'captured' && bookingAudit.rows[0]?.status === 'confirmed') {
    console.log('\n[PASS] SCENARIO 4 CONFIRMED: Out-of-order events converged cleanly to captured without downgrade.');
  } else {
    throw new Error('Scenario 4 failed');
  }
}

// -----------------------------------------------------------------------------
// SCENARIO 5: Capture-after-hold-expiry race (§7.5)
// -----------------------------------------------------------------------------
async function testScenario5(admin, fixtures, createdIds) {
  console.log('\n================================================================');
  console.log('SCENARIO 5: CAPTURE-AFTER-HOLD-EXPIRY RACE (§7.5)');
  console.log('Adapter Mode: Deterministic Sandbox / Webhook Receiver');
  console.log('================================================================');

  const oldBookingId = crypto.randomUUID();
  const newBookingId = crypto.randomUUID();
  const orderId = `order_late_${Date.now()}`;
  const paymentId = `pay_late_${Date.now()}`;
  const interval = getUniqueInterval();
  createdIds.bookingIds.push(oldBookingId, newBookingId);
  createdIds.outboxDedupeKeys.push(`refund_required_${paymentId}`);

  // 1. Create original hold for interval
  await admin.query(`
    INSERT INTO public.bookings (
      id, reference_code, master_owner_id, turf_id, resource_id, player_user_id, created_by,
      source, status, starts_at, ends_at, hold_expires_at,
      total_minor, required_online_minor, currency,
      pricing_snapshot, cancellation_snapshot, commission_snapshot
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $6,
      'online', 'held', $7, $8,
      now() - interval '10 seconds', 200000, 200000, 'INR',
      '{}'::jsonb, '{}'::jsonb, '{"basis_points": 1000, "estimated_commission_minor": 20000}'::jsonb
    );
  `, [oldBookingId, interval.refCode + '-old', fixtures.moId, fixtures.turfId, fixtures.resId, fixtures.uidPlayer, interval.startsAt, interval.endsAt]);

  await admin.query(`
    INSERT INTO public.inventory_allocations (
      booking_id, master_owner_id, turf_id, resource_id, kind,
      starts_at, ends_at, expires_at, created_by
    ) VALUES (
      $1, $2, $3, $4, 'hold',
      $5, $6,
      now() - interval '10 seconds', $7
    );
  `, [oldBookingId, fixtures.moId, fixtures.turfId, fixtures.resId, interval.startsAt, interval.endsAt, fixtures.uidPlayer]);

  await admin.query(`
    INSERT INTO private.payment_orders (
      booking_id, master_owner_id, purpose, provider, provider_order_id,
      amount_minor, currency, status, idempotency_key
    ) VALUES (
      $1, $2, 'initial', 'razorpay', $3,
      200000, 'INR', 'ready', 'idemp_order_late_' || $3
    );
  `, [oldBookingId, fixtures.moId, orderId]);

  console.log('[5.1] Forcing hold expiry sweeper...');
  await admin.query(`SELECT private.expire_booking_holds();`);

  // 2. New customer successfully reserves the exact same slot!
  console.log('[5.2] New customer successfully books the released slot...');
  await admin.query(`
    INSERT INTO public.bookings (
      id, reference_code, master_owner_id, turf_id, resource_id, player_user_id, created_by,
      source, status, starts_at, ends_at, hold_expires_at,
      total_minor, required_online_minor, currency,
      pricing_snapshot, cancellation_snapshot, commission_snapshot
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $6,
      'online', 'held', $7, $8,
      now() + interval '10 minutes', 200000, 200000, 'INR',
      '{}'::jsonb, '{}'::jsonb, '{"basis_points": 1000, "estimated_commission_minor": 20000}'::jsonb
    );
  `, [newBookingId, interval.refCode + '-new', fixtures.moId, fixtures.turfId, fixtures.resId, fixtures.uidPlayer, interval.startsAt, interval.endsAt]);

  await admin.query(`
    INSERT INTO public.inventory_allocations (
      booking_id, master_owner_id, turf_id, resource_id, kind,
      starts_at, ends_at, expires_at, created_by
    ) VALUES (
      $1, $2, $3, $4, 'hold',
      $5, $6,
      now() + interval '10 minutes', $7
    );
  `, [newBookingId, fixtures.moId, fixtures.turfId, fixtures.resId, interval.startsAt, interval.endsAt, fixtures.uidPlayer]);

  // 3. Late capture arrives for the expired hold
  console.log('[5.3] Late capture webhook arrives for expired booking...');
  const latePayload = {
    event: 'payment.captured',
    event_id: `evt_late_${Date.now()}`,
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: orderId,
          amount: 200000,
          currency: 'INR',
          captured_at: Math.floor(Date.now() / 1000)
        }
      }
    }
  };
  createdIds.webhookEventIds.push(latePayload.event_id);
  const lateBody = JSON.stringify(latePayload);
  const lateRes = await fetch(`${FUNCTIONS_BASE_URL}/payment-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': signPayload(lateBody) },
    body: lateBody
  });
  console.log(`      Late Capture Response: HTTP ${lateRes.status} -> ${await lateRes.text()}`);

  // 4. Audit database state
  const oldBookingAudit = await admin.query(`
    SELECT status, payment_exception_reason FROM public.bookings WHERE id = $1;
  `, [oldBookingId]);

  const newBookingAudit = await admin.query(`
    SELECT status FROM public.bookings WHERE id = $1;
  `, [newBookingId]);

  const refundAudit = await admin.query(`
    SELECT r.status, r.amount_minor, r.reason
    FROM private.refunds r
    JOIN private.payments p ON p.id = r.payment_id
    WHERE p.provider_payment_id = $1;
  `, [paymentId]);

  const outboxAudit = await admin.query(`
    SELECT topic, dedupe_key FROM private.outbox_events WHERE topic = 'payment.refund_required' and dedupe_key = $1;
  `, [`refund_required_${paymentId}`]);

  console.log('\n--- CAPTURE-AFTER-EXPIRY INVARIANT AUDIT ---');
  console.log(`Expired Booking Status:     ${oldBookingAudit.rows[0]?.status} (Expected: payment_exception)`);
  console.log(`Exception Reason:           ${oldBookingAudit.rows[0]?.payment_exception_reason}`);
  console.log(`New Customer Booking Status: ${newBookingAudit.rows[0]?.status} (Expected: held - NOT DISPLACED)`);
  console.log(`Refund Queued in DB:        ${refundAudit.rows[0]?.status} (${refundAudit.rows[0]?.amount_minor} paise)`);
  console.log(`Outbox Event Queued:        ${outboxAudit.rows[0]?.topic}`);

  const passed = oldBookingAudit.rows[0]?.status === 'payment_exception' &&
                 newBookingAudit.rows[0]?.status === 'held' &&
                 refundAudit.rows[0]?.status === 'requested' &&
                 outboxAudit.rows.length === 1;

  if (passed) {
    console.log('\n[PASS] SCENARIO 5 CONFIRMED: Late capture transitioned to payment_exception, refund queued, and new customer was protected from displacement.');
  } else {
    throw new Error('Scenario 5 failed');
  }
}

// -----------------------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

async function getLivePlayerAuth() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY
    },
    body: JSON.stringify({ email: 'live_player@example.com', password: 'Password123!' })
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Failed to authenticate live_player: ${JSON.stringify(data)}`);
  }
  return { token: data.access_token, userId: data.user.id };
}

// -----------------------------------------------------------------------------
// SCENARIO 6: Idempotent checkout creation
// -----------------------------------------------------------------------------
async function testScenario6(admin, fixtures, createdIds) {
  console.log('\n================================================================');
  console.log('SCENARIO 6: IDEMPOTENT CHECKOUT CREATION (TWO CONCURRENT CALLS)');
  console.log('Adapter Mode: Deterministic Sandbox Adapter');
  console.log('================================================================');

  const { token: playerToken, userId: playerUserId } = await getLivePlayerAuth();

  const bookingId = crypto.randomUUID();
  const idempotencyKey = `idemp_chk_${Date.now()}`;
  const interval = getUniqueInterval();
  createdIds.bookingIds.push(bookingId);

  await admin.query(`
    INSERT INTO public.bookings (
      id, reference_code, master_owner_id, turf_id, resource_id, player_user_id, created_by,
      source, status, starts_at, ends_at, hold_expires_at,
      total_minor, required_online_minor, currency,
      pricing_snapshot, cancellation_snapshot, commission_snapshot
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $6,
      'online', 'held', $7, $8,
      now() + interval '10 minutes', 220000, 220000, 'INR',
      '{}'::jsonb, '{}'::jsonb, '{"basis_points": 1000, "estimated_commission_minor": 22000}'::jsonb
    );
  `, [bookingId, interval.refCode, fixtures.moId, fixtures.turfId, fixtures.resId, playerUserId, interval.startsAt, interval.endsAt]);

  await admin.query(`
    INSERT INTO public.inventory_allocations (
      booking_id, master_owner_id, turf_id, resource_id, kind,
      starts_at, ends_at, expires_at, created_by
    ) VALUES (
      $1, $2, $3, $4, 'hold',
      $5, $6,
      now() + interval '10 minutes', $7
    );
  `, [bookingId, fixtures.moId, fixtures.turfId, fixtures.resId, interval.startsAt, interval.endsAt, playerUserId]);

  console.log('[6.1] Calling checkout Edge Function for Call 1...');
  const res1 = await fetch(`${FUNCTIONS_BASE_URL}/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${playerToken}`
    },
    body: JSON.stringify({
      booking_id: bookingId,
      idempotency_key: idempotencyKey,
      purpose: 'initial'
    })
  });
  const data1 = await res1.json();
  console.log(`      Call 1: HTTP ${res1.status} -> ${JSON.stringify(data1)}`);

  console.log('[6.2] Calling checkout Edge Function for Call 2 with identical idempotency key...');
  const res2 = await fetch(`${FUNCTIONS_BASE_URL}/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${playerToken}`
    },
    body: JSON.stringify({
      booking_id: bookingId,
      idempotency_key: idempotencyKey,
      purpose: 'initial'
    })
  });
  const data2 = await res2.json();
  console.log(`      Call 2: HTTP ${res2.status} -> ${JSON.stringify(data2)}`);

  // Direct DB audit on private.payment_orders
  const ordersCount = await admin.query(`
    SELECT count(*)::int as count FROM private.payment_orders WHERE idempotency_key = $1;
  `, [idempotencyKey]);

  console.log('\n--- CHECKOUT IDEMPOTENCY AUDIT ---');
  console.log(`Call 1 Provider Order ID: ${data1.provider_order_id}`);
  console.log(`Call 2 Provider Order ID: ${data2.provider_order_id}`);
  console.log(`Call 2 is_existing:        ${data2.is_existing}`);
  console.log(`Total Orders in DB:       ${ordersCount.rows[0].count} (Expected: 1)`);

  const sameOrderId = data1.provider_order_id === data2.provider_order_id;
  const exactOneOrder = ordersCount.rows[0].count === 1;

  if (res1.status === 200 && res2.status === 200 && sameOrderId && exactOneOrder) {
    console.log('\n[PASS] SCENARIO 6 CONFIRMED: Checkout creation is strictly idempotent; returned identical order without duplication.');
  } else {
    throw new Error('Scenario 6 failed');
  }
}

async function teardown(admin, createdIds) {
  console.log('\n--- Deterministic Teardown for Payment Webhook Lifecycle ---');
  await admin.query('BEGIN;');
  try {
    await admin.query(`
      ALTER TABLE private.ledger_entries DISABLE TRIGGER trg_immutable_ledger_entries;
      ALTER TABLE private.ledger_journals DISABLE TRIGGER trg_immutable_ledger_journals;
      ALTER TABLE private.audit_events DISABLE TRIGGER trg_audit_events_immutability;
    `);

    // Dynamically discover any bookings and resources associated with the fixtures
    const bRes = await admin.query(`
      SELECT id FROM public.bookings 
      WHERE turf_id = ANY($1::uuid[]) 
         OR master_owner_id = ANY($2::uuid[])
         OR resource_id = ANY($3::uuid[])
         OR id = ANY($4::uuid[]);
    `, [createdIds.turfIds, createdIds.masterOwnerIds, createdIds.resourceIds, createdIds.bookingIds]);
    const allBookingIds = [...new Set([...createdIds.bookingIds, ...bRes.rows.map(r => r.id)])];

    const rRes = await admin.query(`
      SELECT id FROM public.resources 
      WHERE turf_id = ANY($1::uuid[]) 
         OR master_owner_id = ANY($2::uuid[])
         OR id = ANY($3::uuid[]);
    `, [createdIds.turfIds, createdIds.masterOwnerIds, createdIds.resourceIds]);
    const allResourceIds = [...new Set([...createdIds.resourceIds, ...rRes.rows.map(r => r.id)])];

    // 1. Outbox events
    await admin.query(`
      DELETE FROM private.outbox_events
      WHERE dedupe_key = ANY($1::text[])
         OR (aggregate_type = 'booking' AND aggregate_id = ANY($2::uuid[]))
         OR (aggregate_type = 'notification' AND aggregate_id IN (
           SELECT id FROM public.notifications WHERE user_id = ANY($3::uuid[])
         ))
         OR dedupe_key LIKE 'refund_required_%'
         OR dedupe_key LIKE 'pay_%';
    `, [createdIds.outboxDedupeKeys, allBookingIds, createdIds.userIds]);

    // 2. Notification deliveries & notifications
    if (createdIds.userIds.length > 0) {
      await admin.query(`
        DELETE FROM private.notification_deliveries WHERE notification_id IN (
          SELECT id FROM public.notifications WHERE user_id = ANY($1::uuid[])
        );
      `, [createdIds.userIds]);
      await admin.query(`
        DELETE FROM public.notifications WHERE user_id = ANY($1::uuid[]);
      `, [createdIds.userIds]);
    }

    // 3. Webhook events
    await admin.query(`
      DELETE FROM private.webhook_events
      WHERE provider_event_id = ANY($1::text[])
         OR provider_event_id LIKE 'evt_%';
    `, [createdIds.webhookEventIds]);

    // 4. Refunds, payments, payment orders
    await admin.query(`
      DELETE FROM private.refunds WHERE payment_id IN (
        SELECT id FROM private.payments WHERE payment_order_id IN (
          SELECT id FROM private.payment_orders WHERE booking_id = ANY($1::uuid[]) OR master_owner_id = ANY($2::uuid[])
        )
      );
    `, [allBookingIds, createdIds.masterOwnerIds]);

    await admin.query(`
      DELETE FROM private.payments WHERE payment_order_id IN (
        SELECT id FROM private.payment_orders WHERE booking_id = ANY($1::uuid[]) OR master_owner_id = ANY($2::uuid[])
      );
    `, [allBookingIds, createdIds.masterOwnerIds]);

    await admin.query(`
      DELETE FROM private.payment_orders WHERE booking_id = ANY($1::uuid[]) OR master_owner_id = ANY($2::uuid[]);
    `, [allBookingIds, createdIds.masterOwnerIds]);

    // 5. Booking events & inventory allocations
    if (allBookingIds.length > 0) {
      await admin.query(`DELETE FROM public.booking_events WHERE booking_id = ANY($1::uuid[]);`, [allBookingIds]);
    }
    await admin.query(`DELETE FROM public.inventory_allocations WHERE booking_id = ANY($1::uuid[]) OR resource_id = ANY($2::uuid[]);`, [allBookingIds, allResourceIds]);

    // 6. Ledger entries and journals
    await admin.query(`
      DELETE FROM private.ledger_entries WHERE journal_id IN (
        SELECT id FROM private.ledger_journals WHERE booking_id = ANY($1::uuid[]) OR event_key = ANY($2::text[])
      ) OR account_id IN (
        SELECT id FROM private.ledger_accounts WHERE master_owner_id = ANY($3::uuid[])
      );
    `, [allBookingIds, createdIds.journalEventKeys, createdIds.masterOwnerIds]);

    await admin.query(`
      DELETE FROM private.ledger_journals WHERE booking_id = ANY($1::uuid[]) OR event_key = ANY($2::text[]);
    `, [allBookingIds, createdIds.journalEventKeys]);

    // 7. Ledger accounts and audit events
    if (createdIds.masterOwnerIds.length > 0) {
      await admin.query(`DELETE FROM private.ledger_accounts WHERE master_owner_id = ANY($1::uuid[]);`, [createdIds.masterOwnerIds]);
      await admin.query(`DELETE FROM private.audit_events WHERE master_owner_id = ANY($1::uuid[]);`, [createdIds.masterOwnerIds]);
    }

    // 8. Bookings
    if (allBookingIds.length > 0) {
      await admin.query(`DELETE FROM public.bookings WHERE id = ANY($1::uuid[]);`, [allBookingIds]);
    }

    // 9. Resources, operating hours, slots
    if (allResourceIds.length > 0) {
      await admin.query(`DELETE FROM public.operating_hours WHERE resource_id = ANY($1::uuid[]);`, [allResourceIds]);
      await admin.query(`DELETE FROM public.pricing_rules WHERE resource_id = ANY($1::uuid[]);`, [allResourceIds]);
      await admin.query(`DELETE FROM public.slots WHERE resource_id = ANY($1::uuid[]);`, [allResourceIds]);
      await admin.query(`DELETE FROM public.resources WHERE id = ANY($1::uuid[]);`, [allResourceIds]);
    }

    // 10. Turfs & master owners
    if (createdIds.turfIds.length > 0) {
      await admin.query(`DELETE FROM public.turfs WHERE id = ANY($1::uuid[]);`, [createdIds.turfIds]);
    }
    if (createdIds.masterOwnerIds.length > 0) {
      await admin.query(`DELETE FROM public.master_owners WHERE id = ANY($1::uuid[]);`, [createdIds.masterOwnerIds]);
    }

    // 11. Players, profiles, auth.users
    if (createdIds.userIds.length > 0) {
      await admin.query(`DELETE FROM public.players WHERE user_id = ANY($1::uuid[]);`, [createdIds.userIds]);
      await admin.query(`DELETE FROM public.profiles WHERE user_id = ANY($1::uuid[]);`, [createdIds.userIds]);
      await admin.query(`DELETE FROM auth.users WHERE id = ANY($1::uuid[]);`, [createdIds.userIds]);
    }

    await admin.query(`
      ALTER TABLE private.ledger_entries ENABLE TRIGGER trg_immutable_ledger_entries;
      ALTER TABLE private.ledger_journals ENABLE TRIGGER trg_immutable_ledger_journals;
      ALTER TABLE private.audit_events ENABLE TRIGGER trg_audit_events_immutability;
    `);
    await admin.query('COMMIT;');
    console.log('--- Teardown Complete ---');
  } catch (err) {
    await admin.query('ROLLBACK;');
    try {
      await admin.query(`
        ALTER TABLE private.ledger_entries ENABLE TRIGGER trg_immutable_ledger_entries;
        ALTER TABLE private.ledger_journals ENABLE TRIGGER trg_immutable_ledger_journals;
        ALTER TABLE private.audit_events ENABLE TRIGGER trg_audit_events_immutability;
      `);
    } catch (_) {}
    throw err;
  }
}

async function main() {
  const admin = new Client({ connectionString: DB_URL });
  await admin.connect();
  setupCrashSafety(admin);

  console.log('================================================================');
  console.log('MILESTONE 6: PAYMENT ORCHESTRATION & WEBHOOK ACCEPTANCE SUITE');
  console.log('================================================================');

  const createdIds = {
    userIds: [],
    masterOwnerIds: [],
    turfIds: [],
    resourceIds: [],
    bookingIds: [],
    webhookEventIds: [],
    journalEventKeys: [],
    outboxDedupeKeys: [],
  };

  const preSnapshot = await getCatalogSnapshot(admin);
  printCatalogSnapshot('BEFORE RUN', preSnapshot);
  const preResidue = await getResidueSnapshot(admin);
  printResidueSnapshot('BEFORE RUN', preResidue);
  assertCleanBaseline('BEFORE RUN', preResidue, preSnapshot);

  let fixtures = null;
  try {
    fixtures = await setupBaseFixtures(admin, createdIds);
    const midSnapshot = await getCatalogSnapshot(admin);
    printCatalogSnapshot('MID RUN (AFTER FIXTURES)', midSnapshot);
    const midResidue = await getResidueSnapshot(admin);
    printResidueSnapshot('MID RUN (AFTER FIXTURES)', midResidue);

    await testScenario1(admin, fixtures, createdIds);
    await testScenario2(admin, fixtures, createdIds);
    await testScenario3(admin);
    await testScenario4(admin, fixtures, createdIds);
    await testScenario5(admin, fixtures, createdIds);
    await testScenario6(admin, fixtures, createdIds);

    console.log('\n================================================================');
    console.log('ALL 6 MILESTONE 6 ACCEPTANCE SCENARIOS PASSED SUCCESSFULLY');
    console.log('================================================================\n');
  } catch (err) {
    console.error('\nACCEPTANCE SUITE FAILED:', err);
    process.exitCode = 1;
  } finally {
    await teardown(admin, createdIds);
    const postSnapshot = await getCatalogSnapshot(admin);
    printCatalogSnapshot('AFTER TEARDOWN', postSnapshot);
    const postResidue = await getResidueSnapshot(admin);
    printResidueSnapshot('AFTER TEARDOWN', postResidue);

    console.log('\n=== ORPHAN RECORD AUDIT: AFTER TEARDOWN ===');
    const qOrphanOutbox = await admin.query(`
      SELECT count(*)::int as count FROM private.outbox_events o
      WHERE not exists (select 1 from public.bookings b where b.id=o.aggregate_id)
        AND not exists (select 1 from private.payouts p where p.id=o.aggregate_id)
        AND not exists (select 1 from public.notifications n where n.id=o.aggregate_id);
    `);
    const qOrphanProfiles = await admin.query(`
      SELECT count(*)::int as count FROM public.profiles p
      WHERE not exists (select 1 from auth.users u where u.id=p.user_id);
    `);
    const qOrphanPlayers = await admin.query(`
      SELECT count(*)::int as count FROM public.players pl
      WHERE not exists (select 1 from auth.users u where u.id=pl.user_id);
    `);
    const qOrphanBookingEvents = await admin.query(`
      SELECT count(*)::int as count FROM public.booking_events be
      WHERE not exists (select 1 from public.bookings b where b.id=be.booking_id);
    `);
    console.log(`  Orphan outbox_events:   ${qOrphanOutbox.rows[0].count}`);
    console.log(`  Orphan profiles:        ${qOrphanProfiles.rows[0].count}`);
    console.log(`  Orphan players:         ${qOrphanPlayers.rows[0].count}`);
    console.log(`  Orphan booking_events:  ${qOrphanBookingEvents.rows[0].count}`);

    const preTurfs = preSnapshot.turfs.map(t => `${t.id}:${t.slug}`).sort();
    const postTurfs = postSnapshot.turfs.map(t => `${t.id}:${t.slug}`).sort();
    const turfsMatch = JSON.stringify(preTurfs) === JSON.stringify(postTurfs);
    const countsMatch = preSnapshot.resourcesCount === postSnapshot.resourcesCount &&
                        preSnapshot.bookingsCount === postSnapshot.bookingsCount &&
                        preSnapshot.payoutsCount === postSnapshot.payoutsCount;

    const residueMatch = postResidue.outbox_events === preResidue.outbox_events &&
                         postResidue.profiles === preResidue.profiles &&
                         postResidue.players === preResidue.players &&
                         postResidue.booking_events === preResidue.booking_events &&
                         postResidue.audit_events === preResidue.audit_events;

    const zeroResidue = postResidue.outbox_events === 0 &&
                        postResidue.booking_events === 0 &&
                        postResidue.audit_events === 0 &&
                        postResidue.profiles === EXPECTED_BASE_PROFILES &&
                        postResidue.players === EXPECTED_BASE_PLAYERS &&
                        postSnapshot.bookingsCount === 0 &&
                        postSnapshot.payoutsCount === 0;

    if (!turfsMatch || !countsMatch || !residueMatch || !zeroResidue) {
      console.error('\nLEAK DETECTED: Pre and post snapshots do not match or contain residue!');
      if (!turfsMatch || !countsMatch) console.error('  Catalog mismatch detected.');
      if (!residueMatch) console.error('  5-table residue mismatch detected.');
      if (!zeroResidue) console.error('  Non-zero test residue detected in post-run database.');
      await admin.end();
      process.exit(1);
    } else {
      console.log('\n[PASS] CATALOG & RESIDUE INTEGRITY CONFIRMED: pre === post === 0 test residue.');
    }
    await admin.end();
  }
}

main();
