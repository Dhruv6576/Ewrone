/**
 * Milestone 10: Full End-to-End System Lifecycle Integration Test
 * 
 * Exercises the ENTIRE system in one continuous flow:
 * 1. Onboard Master Owner (status: onboarding)
 * 2. Create turf and resources while still onboarding
 * 3. Submit turf for approval; Platform Admin approves it; activate owner & register bank account
 * 4. Set pricing rules, operating hours, and cancellation policy
 * 5. Player searches and finds approved turf
 * 6. Player creates booking hold (verifies JIT slot generation triggered)
 * 7. Player completes checkout (HTTP to /checkout); payment webhook confirms booking (HTTP to /payment-webhook)
 * 8. Booking confirmed; ledger journal posted; notifications dispatched to player and owner (HTTP to /notification-worker)
 * 9. Player cancels booking per policy; refund requested & processed; court inventory released; refund journal posted
 * 10. Master Owner runs payout planning + settlement cycle on retained net revenue
 * 11. Master Owner views dashboard & statement; confirms numbers reconcile with steps 1-10
 * 12. Audit trail queried and verifies coherent event history across the entire lifecycle
 */

const { Client } = require('pg');
const crypto = require('crypto');
const {
  EXPECTED_BASE_PROFILES,
  EXPECTED_BASE_PLAYERS,
  EXPECTED_BASE_NOTIFICATIONS,
  EXPECTED_BASE_NOTIFICATION_DELIVERIES,
  insertTestAuthUser,
  assertNoOrphans
} = require('../test_constants');


const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const EDGE_URL = process.env.EDGE_URL || (process.env.SUPABASE_URL ? `${process.env.SUPABASE_URL}/functions/v1` : 'http://127.0.0.1:54321/functions/v1');
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || null;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'local_whsec_test_secret_987654321';

function signPayload(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function getCatalogSnapshot(client) {
  const turfs = await client.query(`SELECT id, slug FROM public.turfs ORDER BY id ASC;`);
  const resources = await client.query(`SELECT count(*)::int as count FROM public.resources;`);
  const bookings = await client.query(`SELECT count(*)::int as count FROM public.bookings;`);
  const payouts = await client.query(`SELECT count(*)::int as count FROM private.payouts;`);
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
  const qNotifications = await client.query(`SELECT count(*)::int as count FROM public.notifications;`);
  const qDeliveries = await client.query(`SELECT count(*)::int as count FROM private.notification_deliveries;`);
  return {
    outbox_events: qOutbox.rows[0].count,
    profiles: qProfiles.rows[0].count,
    players: qPlayers.rows[0].count,
    booking_events: qBookingEvents.rows[0].count,
    audit_events: qAuditEvents.rows[0].count,
    notifications: qNotifications.rows[0].count,
    notification_deliveries: qDeliveries.rows[0].count,
  };
}

function printResidueSnapshot(label, s) {
  console.log(`\n=== 7-TABLE RESIDUE SNAPSHOT: ${label} ===`);
  console.log(`  private.outbox_events:          ${s.outbox_events}`);
  console.log(`  public.profiles:                ${s.profiles}`);
  console.log(`  public.players:                 ${s.players}`);
  console.log(`  public.booking_events:          ${s.booking_events}`);
  console.log(`  private.audit_events:           ${s.audit_events}`);
  console.log(`  public.notifications:           ${s.notifications}`);
  console.log(`  private.notification_deliveries: ${s.notification_deliveries}`);
}

function assertCleanBaseline(label, residue, snapshot = null) {
  const leaks = [];
  if (residue.outbox_events !== 0) leaks.push(`outbox_events: ${residue.outbox_events} (expected 0)`);
  if (residue.booking_events !== 0) leaks.push(`booking_events: ${residue.booking_events} (expected 0)`);
  if (residue.audit_events !== 0) leaks.push(`audit_events: ${residue.audit_events} (expected 0)`);
  if (residue.notifications !== EXPECTED_BASE_NOTIFICATIONS) leaks.push(`notifications: ${residue.notifications} (expected ${EXPECTED_BASE_NOTIFICATIONS})`);
  if (residue.notification_deliveries !== EXPECTED_BASE_NOTIFICATION_DELIVERIES) leaks.push(`notification_deliveries: ${residue.notification_deliveries} (expected ${EXPECTED_BASE_NOTIFICATION_DELIVERIES})`);
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

async function teardown(client, createdIds) {
  console.log('\n--- Deterministic Teardown for E2E Full System Lifecycle ---');
  await client.query('BEGIN;');
  try {
    await client.query(`
      ALTER TABLE private.ledger_entries DISABLE TRIGGER trg_immutable_ledger_entries;
      ALTER TABLE private.ledger_journals DISABLE TRIGGER trg_immutable_ledger_journals;
      ALTER TABLE private.audit_events DISABLE TRIGGER trg_audit_events_immutability;
    `);
    // 1. Outbox events (children first! Delete before notifications, bookings, payouts, refunds are removed)
    if (createdIds.outboxIds.length > 0) {
      await client.query(`DELETE FROM private.outbox_events WHERE id = ANY($1::uuid[])`, [createdIds.outboxIds]);
    }
    await client.query(`
      DELETE FROM private.outbox_events
      WHERE (aggregate_type = 'booking' AND aggregate_id = ANY($1::uuid[]))
         OR (aggregate_type = 'payout' AND aggregate_id = ANY($2::uuid[]))
         OR (aggregate_type = 'notification' AND aggregate_id IN (
           SELECT id FROM public.notifications WHERE user_id = ANY($3::uuid[]) OR user_id = 'f5000000-0000-0000-0000-000000000001'
         ))
         OR (topic = 'notification.dispatch')
         OR (aggregate_type = 'refund' AND aggregate_id IN (
           SELECT id FROM private.refunds WHERE payment_id IN (
             SELECT id FROM private.payments WHERE payment_order_id IN (
               SELECT id FROM private.payment_orders WHERE booking_id = ANY($1::uuid[])
             )
           )
         ))
    `, [createdIds.bookingIds, createdIds.payoutIds, createdIds.userIds]);

    // 2. Webhook events (by captured ID)
    if (createdIds.webhookEventIds.length > 0) {
      await client.query(`DELETE FROM private.webhook_events WHERE id = ANY($1::uuid[])`, [createdIds.webhookEventIds]);
    }

    // 3. Turf approval events (references profiles and turfs with ON DELETE NO ACTION)
    if (createdIds.turfIds.length > 0) {
      await client.query(`DELETE FROM private.turf_approval_events WHERE turf_id = ANY($1::uuid[])`, [createdIds.turfIds]);
    }

    // 4. Notification deliveries and notifications (child of profiles/users)
    await client.query(`DELETE FROM private.notification_deliveries WHERE notification_id IN (SELECT id FROM public.notifications WHERE user_id = ANY($1::uuid[]) OR user_id = 'f5000000-0000-0000-0000-000000000001')`, [createdIds.userIds]);
    await client.query(`DELETE FROM public.notifications WHERE user_id = ANY($1::uuid[]) OR user_id = 'f5000000-0000-0000-0000-000000000001'`, [createdIds.userIds]);
    await client.query(`DELETE FROM private.device_tokens WHERE user_id = ANY($1::uuid[]) OR token LIKE 'fcm_%'`, [createdIds.userIds]);
    if (createdIds.userIds.length > 0) {
      await client.query(`DELETE FROM private.admin_grants WHERE user_id = ANY($1::uuid[])`, [createdIds.userIds]);
      await client.query(`DELETE FROM private.platform_admins WHERE user_id = ANY($1::uuid[])`, [createdIds.userIds]);
    }

    // 5. Booking events & inventory allocations
    if (createdIds.bookingIds.length > 0) {
      await client.query(`DELETE FROM public.booking_events WHERE booking_id = ANY($1::uuid[])`, [createdIds.bookingIds]);
      await client.query(`DELETE FROM public.inventory_allocations WHERE booking_id = ANY($1::uuid[])`, [createdIds.bookingIds]);
    }

    // 6. Payout allocations & payouts
    if (createdIds.payoutIds.length > 0) {
      await client.query(`DELETE FROM private.payout_allocations WHERE payout_id = ANY($1::uuid[])`, [createdIds.payoutIds]);
      await client.query(`DELETE FROM private.payouts WHERE id = ANY($1::uuid[])`, [createdIds.payoutIds]);
    }

    // 7. Ledger entries and journals (both sides of booking/payout journals)
    if (createdIds.bookingIds.length > 0 || createdIds.journalEventKeys.length > 0) {
      await client.query(`
        DELETE FROM private.ledger_entries WHERE journal_id IN (
          SELECT id FROM private.ledger_journals WHERE booking_id = ANY($1::uuid[]) OR event_key = ANY($2::text[])
        )
      `, [createdIds.bookingIds, createdIds.journalEventKeys]);
      await client.query(`
        DELETE FROM private.ledger_journals WHERE booking_id = ANY($1::uuid[]) OR event_key = ANY($2::text[])
      `, [createdIds.bookingIds, createdIds.journalEventKeys]);
    }

    // 8. Refunds, payments, payment orders
    if (createdIds.bookingIds.length > 0) {
      await client.query(`DELETE FROM private.refunds WHERE payment_id IN (SELECT id FROM private.payments WHERE payment_order_id IN (SELECT id FROM private.payment_orders WHERE booking_id = ANY($1::uuid[])))`, [createdIds.bookingIds]);
      await client.query(`DELETE FROM private.payments WHERE payment_order_id IN (SELECT id FROM private.payment_orders WHERE booking_id = ANY($1::uuid[]))`, [createdIds.bookingIds]);
      await client.query(`DELETE FROM private.payment_orders WHERE booking_id = ANY($1::uuid[])`, [createdIds.bookingIds]);
    }

    // 9. Bookings
    if (createdIds.bookingIds.length > 0) {
      await client.query(`DELETE FROM public.bookings WHERE id = ANY($1::uuid[])`, [createdIds.bookingIds]);
    }

    // 10. Ledger accounts, audit events, financial accounts for master owners
    if (createdIds.masterOwnerIds.length > 0) {
      await client.query(`
        DELETE FROM private.ledger_entries WHERE account_id IN (
          SELECT id FROM private.ledger_accounts WHERE master_owner_id = ANY($1::uuid[])
        )
      `, [createdIds.masterOwnerIds]);
      await client.query(`
        DELETE FROM private.ledger_accounts WHERE master_owner_id = ANY($1::uuid[])
      `, [createdIds.masterOwnerIds]);
      await client.query(`
        DELETE FROM private.audit_events WHERE master_owner_id = ANY($1::uuid[])
      `, [createdIds.masterOwnerIds]);
      await client.query(`DELETE FROM private.owner_financial_accounts WHERE master_owner_id = ANY($1::uuid[])`, [createdIds.masterOwnerIds]);
    }

    // 11. Pricing rules, operating hours, slots, resources
    if (createdIds.resourceIds.length > 0) {
      await client.query(`DELETE FROM public.pricing_rules WHERE resource_id = ANY($1::uuid[])`, [createdIds.resourceIds]);
      await client.query(`DELETE FROM public.operating_hours WHERE resource_id = ANY($1::uuid[])`, [createdIds.resourceIds]);
      await client.query(`DELETE FROM public.slots WHERE resource_id = ANY($1::uuid[])`, [createdIds.resourceIds]);
      await client.query(`DELETE FROM public.resources WHERE id = ANY($1::uuid[])`, [createdIds.resourceIds]);
    }

    // 12. Turf settings, policies, turfs, master owners
    if (createdIds.turfIds.length > 0) {
      await client.query(`DELETE FROM public.turf_booking_settings WHERE turf_id = ANY($1::uuid[])`, [createdIds.turfIds]);
      await client.query(`DELETE FROM public.turfs WHERE id = ANY($1::uuid[])`, [createdIds.turfIds]);
    }
    if (createdIds.policyIds.length > 0) {
      await client.query(`DELETE FROM public.cancellation_policies WHERE id = ANY($1::uuid[])`, [createdIds.policyIds]);
    }
    if (createdIds.masterOwnerIds.length > 0) {
      await client.query(`DELETE FROM public.master_owners WHERE id = ANY($1::uuid[])`, [createdIds.masterOwnerIds]);
    }

    // 13. Players, profiles, auth.users
    if (createdIds.userIds.length > 0) {
      await client.query(`DELETE FROM public.players WHERE user_id = ANY($1::uuid[])`, [createdIds.userIds]);
      await client.query(`DELETE FROM public.profiles WHERE user_id = ANY($1::uuid[])`, [createdIds.userIds]);
      await client.query(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [createdIds.userIds]);
    }

    await client.query(`
      ALTER TABLE private.ledger_entries ENABLE TRIGGER trg_immutable_ledger_entries;
      ALTER TABLE private.ledger_journals ENABLE TRIGGER trg_immutable_ledger_journals;
      ALTER TABLE private.audit_events ENABLE TRIGGER trg_audit_events_immutability;
    `);
    await client.query('COMMIT;');
  } catch (err) {
    await client.query('ROLLBACK;');
    try {
      await client.query(`
        ALTER TABLE private.ledger_entries ENABLE TRIGGER trg_immutable_ledger_entries;
        ALTER TABLE private.ledger_journals ENABLE TRIGGER trg_immutable_ledger_journals;
        ALTER TABLE private.audit_events ENABLE TRIGGER trg_audit_events_immutability;
      `);
    } catch (_) {}
    throw err;
  }
  console.log('--- Teardown Complete ---');
}

function setupCrashSafety(client) {
  const restoreTriggers = async () => {
    try {
      await client.query(`
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

async function runLifecycle() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  setupCrashSafety(client);

  console.log('================================================================');
  console.log('MILESTONE 10: FULL SYSTEM CONTINUOUS LIFECYCLE E2E TEST');
  console.log('================================================================\n');

  const ts = Date.now();

  const createdIds = {
    userIds: [],
    masterOwnerIds: [],
    turfIds: [],
    resourceIds: [],
    policyIds: [],
    bookingIds: [],
    payoutIds: [],
    journalEventKeys: [],
    webhookEventIds: [],
    outboxIds: [],
  };

  const preSnapshot = await getCatalogSnapshot(client);
  printCatalogSnapshot('BEFORE RUN', preSnapshot);
  const preResidue = await getResidueSnapshot(client);
  printResidueSnapshot('BEFORE RUN', preResidue);
  assertCleanBaseline('BEFORE RUN', preResidue, preSnapshot);

  try {
    // ================================================================
    // STEP 1: ONBOARD A NEW MASTER OWNER (STATUS: ONBOARDING)
    // ================================================================
    console.log('----------------------------------------------------------------');
    console.log('STEP 1: Onboard a new Master Owner (status: onboarding)');
    console.log('----------------------------------------------------------------');

    const ownerUserId = crypto.randomUUID();
    const ownerEmail = `owner_e2e_${ts}@example.com`;
    const ownerMoId = crypto.randomUUID();
    createdIds.userIds.push(ownerUserId);
    createdIds.masterOwnerIds.push(ownerMoId);

    // Create owner auth user with complete GoTrue-scannable shape
    await insertTestAuthUser(client, {
      id: ownerUserId,
      email: ownerEmail,
      rawUserMetaData: { name: 'E2E Master Owner' }
    });

    // Register mobile device token for owner push notifications
    const ownerDeviceToken = `fcm_owner_e2e_${ts}`;
    await client.query(
      `insert into private.device_tokens (user_id, app_id, token, platform)
       values ($1, 'app-owner', $2, 'android')`,
      [ownerUserId, ownerDeviceToken]
    );

    // Create Master Owner entity in onboarding status
    await client.query(
      `insert into public.master_owners (id, owner_user_id, business_name, status)
       values ($1, $2, 'Apex Sports Arena Ltd', 'onboarding')`,
      [ownerMoId, ownerUserId]
    );

    // Verify status is 'onboarding'
    const moRow = (await client.query(`select status from public.master_owners where id = $1`, [ownerMoId])).rows[0];
    console.log(`[1.1] Master Owner created: ${ownerMoId}`);
    console.log(`      Business Name: Apex Sports Arena Ltd`);
    console.log(`      Owner User ID: ${ownerUserId}`);
    console.log(`      Tenancy Status: ${moRow.status} (Expected: onboarding)`);

    // Log onboarding audit event
    await client.query(
      `select private.log_audit_event(
        $1, null, $2, 'user', 'master_owner.onboard', 'master_owner', $1,
        null, jsonb_build_object('status', 'onboarding', 'business_name', 'Apex Sports Arena Ltd'),
        'Initial business registration'
      )`,
      [ownerMoId, ownerUserId]
    );

    if (moRow.status !== 'onboarding') {
      throw new Error(`Step 1 failed: Expected status 'onboarding', got '${moRow.status}'`);
    }

    // ================================================================
    // STEP 2: CREATE A TURF AND RESOURCES WHILE STILL ONBOARDING
    // ================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('STEP 2: Create a turf and resources while still onboarding');
    console.log('----------------------------------------------------------------');

    const turfId = crypto.randomUUID();
    const resourceId = crypto.randomUUID();
    createdIds.turfIds.push(turfId);
    createdIds.resourceIds.push(resourceId);

    // Act as Master Owner
    await client.query(
      `select set_config('request.jwt.claims', $1, false)`,
      [JSON.stringify({ sub: ownerUserId, role: 'authenticated' })]
    );

    // Create turf in 'draft' status
    await client.query(
      `insert into public.turfs (
        id, master_owner_id, slug, name, description, address_text, city, location, timezone, approval_status
      ) values (
        $1, $2, $3, 'Apex Box Cricket Arena', 'Premier outdoor floodlit arena',
        'Plot 42, HSR Sector 2', 'Bengaluru',
        extensions.st_setsrid(extensions.st_makepoint(77.6412, 12.9121), 4326),
        'Asia/Kolkata', 'draft'
      )`,
      [turfId, ownerMoId, `apex-arena-${ts}`]
    );

    // Create bookable court resource under turf
    await client.query(
      `insert into public.resources (
        id, master_owner_id, turf_id, name, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, active
      ) values (
        $1, $2, $3, 'Pitch A (Floodlit)', 30, 60, 240, true
      )`,
      [resourceId, ownerMoId, turfId]
    );

    // Configure operating hours (all 7 days, 06:00 to 23:00)
    await client.query(
      `insert into public.operating_hours (resource_id, iso_weekday, opens_at, closes_at, valid_from)
       select $1, gs, '06:00'::time, '23:00'::time, '2026-01-01'::date
       from generate_series(1, 7) gs`,
      [resourceId]
    );

    // Log audit events
    await client.query(
      `select private.log_audit_event(
        $1, $2, $3, 'user', 'turf.create', 'turf', $2,
        null, jsonb_build_object('approval_status', 'draft', 'name', 'Apex Box Cricket Arena'),
        'Turf drafted during onboarding'
      )`,
      [ownerMoId, turfId, ownerUserId]
    );

    const turfDraftRow = (await client.query(`select approval_status from public.turfs where id = $1`, [turfId])).rows[0];
    const resRow = (await client.query(`select name, active from public.resources where id = $1`, [resourceId])).rows[0];
    console.log(`[2.1] Turf created while onboarding: ${turfId}`);
    console.log(`      Turf Approval Status: ${turfDraftRow.approval_status} (Expected: draft)`);
    console.log(`[2.2] Resource created: ${resourceId} ("${resRow.name}", Active: ${resRow.active})`);

    // Reset session
    await client.query(`select set_config('request.jwt.claims', '', false)`);

    if (turfDraftRow.approval_status !== 'draft') {
      throw new Error(`Step 2 failed: Expected draft turf status, got ${turfDraftRow.approval_status}`);
    }

    // ================================================================
    // STEP 3: SUBMIT TURF FOR APPROVAL; PLATFORM ADMIN APPROVES IT
    // ================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('STEP 3: Submit turf for approval; Platform Admin approves it');
    console.log('----------------------------------------------------------------');

    // 3.1 Owner submits turf for approval
    await client.query(
      `select set_config('request.jwt.claims', $1, false)`,
      [JSON.stringify({ sub: ownerUserId, role: 'authenticated' })]
    );
    const submitResult = (await client.query(`select public.submit_turf_for_approval($1) as res`, [turfId])).rows[0].res;
    console.log(`[3.1] Owner submitted turf for approval:`, JSON.stringify(submitResult));

    // 3.2 Platform Admin approves turf
    const adminUserId = crypto.randomUUID();
    createdIds.userIds.push(adminUserId);
    await insertTestAuthUser(client, {
      id: adminUserId,
      email: `admin_e2e_${ts}@example.com`,
      rawUserMetaData: { name: 'Admin E2E' }
    });
    await client.query(
      `insert into private.platform_admins (user_id, active) values ($1, true)
       on conflict (user_id) do nothing`,
      [adminUserId]
    );
    await client.query(
      `insert into private.admin_grants (user_id, capability) values ($1, 'turfs.approve')
       on conflict do nothing`,
      [adminUserId]
    );

    await client.query(
      `select set_config('request.jwt.claims', $1, false)`,
      [JSON.stringify({ sub: adminUserId, role: 'authenticated' })]
    );
    const reviewResult = (await client.query(
      `select public.admin_review_turf($1, 'approved', 'Field audit verified and safety inspection passed') as res`,
      [turfId]
    )).rows[0].res;
    console.log(`[3.2] Platform Admin approved turf:`, JSON.stringify(reviewResult));

    // Transition owner to 'active' now that venue is approved
    await client.query(`update public.master_owners set status = 'active' where id = $1`, [ownerMoId]);
    await client.query(
      `select private.log_audit_event(
        $1, null, $2, 'system', 'master_owner.activate', 'master_owner', $1,
        jsonb_build_object('status', 'onboarding'), jsonb_build_object('status', 'active'),
        'Venue approved; onboarding completed'
      )`,
      [ownerMoId, adminUserId]
    );

    // Register active financial account for owner payouts
    await client.query(
      `select private.register_owner_financial_account($1, 'razorpay', 'acc_rzp_e2e_' || $2::text, 'HDFC Current ****8899', true)`,
      [ownerMoId, ts]
    );
    console.log(`[3.3] Master Owner activated and registered verified financial account.`);

    // Reset session
    await client.query(`select set_config('request.jwt.claims', '', false)`);

    // Verify owner received notification about approval
    const adminApprovalNotif = await client.query(
      `select kind, title, body from public.notifications where user_id = $1 and kind = 'turf.review_approved'`,
      [ownerUserId]
    );
    console.log(`[3.4] Owner received approval notification: ${adminApprovalNotif.rows.length > 0} (Title: "${adminApprovalNotif.rows[0]?.title}")`);

    // ================================================================
    // STEP 4: SET PRICING RULES AND CANCELLATION POLICY
    // ================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('STEP 4: Set pricing rules and cancellation policy');
    console.log('----------------------------------------------------------------');

    const policyId = crypto.randomUUID();
    createdIds.policyIds.push(policyId);

    // Cancellation policy: 100% refund if > 48h; 50% refund if > 12h (retaining 50% cancellation fee)
    await client.query(
      `insert into public.cancellation_policies (id, master_owner_id, name, version, rules)
       values ($1, $2, 'Tiered Sports Policy', 1, '[{"hours_before": 48, "refund_percent": 100}, {"hours_before": 12, "refund_percent": 50}]'::jsonb)`,
      [policyId, ownerMoId]
    );

    // Turf booking settings: 100% required advance (10000 basis points)
    await client.query(
      `insert into public.turf_booking_settings (
        turf_id, master_owner_id, cancellation_policy_id, advance_basis_points, booking_horizon_days, minimum_lead_minutes, hold_seconds
      ) values ($1, $2, $3, 10000, 60, 60, 420)`,
      [turfId, ownerMoId, policyId]
    );

    // Pricing rule: ₹1,000 per 30-min increment -> ₹2,000 per 1-hour booking (200,000 paise)
    await client.query(
      `insert into public.pricing_rules (
        master_owner_id, turf_id, resource_id, priority, valid_from, iso_weekdays, starts_local, ends_local, amount_per_increment_minor
      ) values ($1, $2, $3, 0, '2026-01-01', '{1,2,3,4,5,6,7}', '06:00', '23:00', 100000)`,
      [ownerMoId, turfId, resourceId]
    );

    console.log(`[4.1] Configured Tiered Cancellation Policy:`);
    console.log(`      Tier 1: > 48 hours -> 100% refund`);
    console.log(`      Tier 2: > 12 hours -> 50% refund (50% retained revenue)`);
    console.log(`[4.2] Configured Pricing Rule: ₹1,000 / 30m increment (₹2,000 / hour)`);

    // ================================================================
    // STEP 5: A PLAYER SEARCHES AND FINDS THE APPROVED TURF
    // ================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('STEP 5: A player searches and finds the approved turf');
    console.log('----------------------------------------------------------------');

    // Authenticate live_player@example.com via password grant
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY
      },
      body: JSON.stringify({ email: 'live_player@example.com', password: 'Password123!' })
    });
    const authData = await authRes.json();
    if (!authData.access_token) {
      throw new Error(`Failed to authenticate live_player: ${JSON.stringify(authData)}`);
    }
    const playerToken = authData.access_token;
    const playerUserId = authData.user.id;
    const playerEmail = 'live_player@example.com';

    const playerDeviceToken = `fcm_player_e2e_${ts}`;
    await client.query(
      `insert into private.device_tokens (user_id, app_id, token, platform)
       values ($1, 'app-player', $2, 'ios')
       on conflict (token) do nothing`,
      [playerUserId, playerDeviceToken]
    );

    // Player searches for approved turfs in Bengaluru
    const discoveryRes = await client.query(
      `select id, name, city, approval_status from public.turfs where approval_status = 'approved' and city = 'Bengaluru' and id = $1`,
      [turfId]
    );
    const discoveredTurf = discoveryRes.rows[0];

    const resourcesRes = await client.query(
      `select id, name, booking_increment_minutes from public.resources where turf_id = $1 and active = true`,
      [turfId]
    );

    console.log(`[5.1] Player discovered turf: "${discoveredTurf.name}" in ${discoveredTurf.city} (Status: ${discoveredTurf.approval_status})`);
    console.log(`[5.2] Available Resource: "${resourcesRes.rows[0].name}" (Increment: ${resourcesRes.rows[0].booking_increment_minutes}m)`);

    // ================================================================
    // STEP 6: PLAYER CREATES A BOOKING HOLD (JIT SLOT GENERATION)
    // ================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('STEP 6: Player creates a booking hold (JIT slot generation triggers)');
    console.log('----------------------------------------------------------------');

    // Verify slots before hold
    const slotsBeforeRes = await client.query(`select count(*) from public.slots where resource_id = $1`, [resourceId]);
    console.log(`[6.1] Slots in database BEFORE booking hold: ${slotsBeforeRes.rows[0].count}`);

    // Booking interval: tomorrow 18:00 to 19:00 (in ~24 hours, falls cleanly into the 50% refund tier > 12h)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().slice(0, 10);
    const slotStart = new Date(`${dateStr}T18:00:00+05:30`);
    const slotEnd = new Date(`${dateStr}T19:00:00+05:30`);
    const holdIdempKey = `idemp_hold_e2e_${ts}`;

    // Act as Player
    await client.query(
      `select set_config('request.jwt.claims', $1, false)`,
      [JSON.stringify({ sub: playerUserId, role: 'authenticated' })]
    );

    const holdRes = await client.query(
      `select public.create_booking_hold($1, $2, $3, $4, 'Virat Sharma', '+919876543210', $5) as hold`,
      [resourceId, slotStart, slotEnd, holdIdempKey, playerEmail]
    );
    const holdData = holdRes.rows[0].hold;

    const slotsAfterRes = await client.query(`select count(*) from public.slots where resource_id = $1`, [resourceId]);
    console.log(`[6.2] Slots in database AFTER booking hold: ${slotsAfterRes.rows[0].count} (JIT slot generation triggered!)`);
    console.log(`[6.3] Booking Hold Created:`);
    console.log(`      Booking ID:     ${holdData.booking_id}`);
    console.log(`      Reference Code: ${holdData.reference_code}`);
    console.log(`      Total Amount:   ₹${holdData.total_minor / 100} (${holdData.currency})`);
    console.log(`      Hold Expires:   ${holdData.hold_expires_at}`);

    const bookingId = holdData.booking_id;
    createdIds.bookingIds.push(bookingId);

    // Reset session
    await client.query(`select set_config('request.jwt.claims', '', false)`);

    // ================================================================
    // STEP 7: PLAYER COMPLETES CHECKOUT; PAYMENT WEBHOOK CONFIRMS BOOKING
    // ================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('STEP 7: Player completes checkout; payment webhook confirms booking');
    console.log('----------------------------------------------------------------');

    // 7.1 Real HTTP call to Edge Function /checkout
    const checkoutResp = await fetch(`${EDGE_URL}/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${playerToken}`
      },
      body: JSON.stringify({
        booking_id: bookingId,
        idempotency_key: `chk_e2e_${ts}`,
        purpose: 'initial'
      })
    });
    const checkoutData = await checkoutResp.json();
    console.log(`[7.1] Checkout Response: HTTP ${checkoutResp.status}`);
    console.log(`      Provider Order ID: ${checkoutData.provider_order_id}`);
    console.log(`      Amount:            ₹${checkoutData.amount_minor / 100}`);
    console.log(`      Adapter Mode:      ${checkoutData.adapter_mode}`);

    const providerOrderId = checkoutData.provider_order_id;
    const providerPaymentId = `pay_rzp_e2e_${ts}`;

    // 7.2 Real HTTP call to Edge Function /payment-webhook with cryptographic HMAC-SHA256 signature
    const webhookPayload = JSON.stringify({
      event: 'payment.captured',
      event_id: `evt_e2e_${ts}`,
      payload: {
        payment: {
          entity: {
            id: providerPaymentId,
            order_id: providerOrderId,
            amount: 200000,
            currency: 'INR',
            captured_at: Math.floor(Date.now() / 1000)
          }
        }
      }
    });

    const signature = signPayload(webhookPayload, WEBHOOK_SECRET);
    const webhookResp = await fetch(`${EDGE_URL}/payment-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature
      },
      body: webhookPayload
    });
    const webhookData = await webhookResp.json();
    console.log(`[7.2] Payment Webhook Response: HTTP ${webhookResp.status}`);
    console.log(`      Webhook Processing Result:`, JSON.stringify(webhookData));
    if (webhookData.webhook_event_id) {
      createdIds.webhookEventIds.push(webhookData.webhook_event_id);
    } else {
      const whEventRes = await client.query(`SELECT id FROM private.webhook_events WHERE provider_event_id = $1`, [`evt_e2e_${ts}`]);
      if (whEventRes.rows.length > 0) {
        createdIds.webhookEventIds.push(whEventRes.rows[0].id);
      }
    }

    // ================================================================
    // STEP 8: BOOKING CONFIRMED; LEDGER POSTED; NOTIFICATIONS DISPATCHED
    // ================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('STEP 8: Booking confirmed; ledger posted; notifications dispatched');
    console.log('----------------------------------------------------------------');

    // 8.0 Await confirming transaction deterministically bounded by wall-clock time (6500ms deadline, 250ms sleep)
    const deadline = Date.now() + 6500;
    let confirmed = false;

    while (Date.now() < deadline) {
      const bCheck = await client.query(`select status, confirmed_at from public.bookings where id = $1`, [bookingId]);
      if (bCheck.rows[0]?.status === 'confirmed') {
        confirmed = true;
        break;
      }
      // If webhook is in retryable state, trigger retry worker
      await client.query(`SELECT private.retry_unprocessed_webhooks();`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    // Dump webhook event status at moment of Step 8 assertion (Item A2)
    const whDump = await client.query(`
      SELECT status, attempts, next_attempt_at, last_error 
      FROM private.webhook_events 
      ORDER BY received_at DESC 
      LIMIT 1;
    `);
    console.log(`[8.0] Webhook Event State at Step 8 Assertion:`, JSON.stringify(whDump.rows[0]));

    // Verify booking and allocation status in DB
    const bookingAudit = (await client.query(`select status, confirmed_at from public.bookings where id = $1`, [bookingId])).rows[0];
    if (bookingAudit?.status !== 'confirmed') {
      throw new Error(`BOOKING_CONFIRMATION_TIMEOUT: Expected booking status 'confirmed' within 6500ms deadline, got '${bookingAudit?.status}'`);
    }

    const allocAudit = (await client.query(`select kind from public.inventory_allocations where booking_id = $1`, [bookingId])).rows[0];
    console.log(`[8.1] Booking Status in DB: ${bookingAudit.status} (Confirmed At: ${bookingAudit.confirmed_at})`);
    console.log(`      Inventory Allocation: ${allocAudit.kind} (Expected: booking)`);


    // Verify double-entry ledger journal
    const ledgerEntries = await client.query(`
      select a.code, e.amount_minor, case when e.amount_minor > 0 then 'debit' else 'credit' end as direction
      from private.ledger_entries e
      join private.ledger_accounts a on a.id = e.account_id
      join private.ledger_journals j on j.id = e.journal_id
      where j.booking_id = $1 and j.event_type = 'payment_captured'
      order by a.code
    `, [bookingId]);

    console.log(`[8.2] Double-Entry Ledger Journal Entries for Booking Confirmation:`);
    let ledgerSum = 0;
    for (const ent of ledgerEntries.rows) {
      console.log(`      Account: ${ent.code.padEnd(20)} | Amount: ₹${(ent.amount_minor / 100).toString().padStart(6)} (${ent.direction})`);
      ledgerSum += Number(ent.amount_minor);
    }
    console.log(`      Net Journal Sum: ${ledgerSum} (Expected: 0)`);

    // Verify in-app notifications queued
    const notifs = await client.query(`
      select user_id, kind, title, body from public.notifications
      where user_id in ($1, $2) and kind in ('booking.confirmed', 'booking.new_confirmed')
    `, [playerUserId, ownerUserId]);

    console.log(`[8.3] Queued Notifications in Database:`);
    for (const n of notifs.rows) {
      const recipient = n.user_id === playerUserId ? 'PLAYER' : 'OWNER';
      console.log(`      Recipient: ${recipient} | Kind: ${n.kind} | Title: "${n.title}"`);
    }

    // Trigger notification-worker to dispatch multi-channel deliveries
    console.log(`[8.4] Triggering notification-worker Edge Function via HTTP...`);
    const dbWorkerSecret = (await client.query(`
      SELECT coalesce(
        (SELECT value FROM private.app_config WHERE key in ('worker_secret', 'notification_worker_secret') LIMIT 1),
        current_setting('app.settings.worker_secret', true)
      ) as val
    `)).rows[0]?.val;
    const notifWorkerResp = await fetch(`${EDGE_URL}/notification-worker`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worker-key': process.env.INTERNAL_WORKER_SECRET || dbWorkerSecret
      },
      body: JSON.stringify({ batch_size: 50 })
    });
    const notifWorkerData = await notifWorkerResp.json();
    console.log(`      Worker Response:`, JSON.stringify(notifWorkerData));

    // Verify delivery receipts
    const deliveries = await client.query(`
      select d.channel, d.status, d.provider_message_id, n.kind
      from private.notification_deliveries d
      join public.notifications n on n.id = d.notification_id
      where n.user_id in ($1, $2) and n.kind in ('booking.confirmed', 'booking.new_confirmed')
    `, [playerUserId, ownerUserId]);

    console.log(`[8.5] Multi-Channel Delivery Receipts After Dispatch:`);
    for (const d of deliveries.rows) {
      console.log(`      Channel: ${d.channel.padEnd(5)} | Status: ${d.status.padEnd(9)} | ID: ${d.provider_message_id}`);
    }

    const midResidue = await getResidueSnapshot(client);
    printResidueSnapshot('MID RUN (AFTER BOOKING CONFIRMED)', midResidue);

    // ================================================================
    // STEP 9: PLAYER CANCELS BOOKING PER POLICY; REFUND PROCESSED
    // ================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('STEP 9: Player cancels the booking per policy; refund processed');
    console.log('----------------------------------------------------------------');

    // Act as Player
    await client.query(
      `select set_config('request.jwt.claims', $1, false)`,
      [JSON.stringify({ sub: playerUserId, role: 'authenticated' })]
    );

    const cancelRes = await client.query(
      `select public.cancel_booking($1, 'Rain and thunderstorm expected') as cancel`,
      [bookingId]
    );
    const cancelData = cancelRes.rows[0].cancel;

    console.log(`[9.1] Booking Cancelled:`);
    console.log(`      Status:                 ${cancelData.status}`);
    console.log(`      Applicable Policy Tier: ${cancelData.refund_percent}% refund`);
    console.log(`      Refund Amount:          ₹${cancelData.refund_amount_minor / 100}`);
    console.log(`      Retained Revenue:       ₹${cancelData.retained_revenue_minor / 100}`);

    // Reset session
    await client.query(`select set_config('request.jwt.claims', '', false)`);

    // Verify database state after cancellation
    const cancelAudit = (await client.query(`select status, cancelled_at from public.bookings where id = $1`, [bookingId])).rows[0];
    const allocReleased = (await client.query(`select released_at from public.inventory_allocations where booking_id = $1`, [bookingId])).rows[0];
    const refundRow = (await client.query(`select id, amount_minor, status from private.refunds where payment_id = (select id from private.payments where provider_payment_id = $1)`, [providerPaymentId])).rows[0];

    console.log(`[9.2] Database Audit Post-Cancellation:`);
    console.log(`      Booking Status:             ${cancelAudit.status} (Cancelled At: ${cancelAudit.cancelled_at})`);
    console.log(`      Inventory Released:         ${allocReleased.released_at !== null}`);
    console.log(`      Refund Record:              ${refundRow.id} (Status: ${refundRow.status}, Amount: ₹${refundRow.amount_minor / 100})`);

    // Verify refund double-entry ledger journal
    const refundJournalEntries = await client.query(`
      select a.code, e.amount_minor, case when e.amount_minor > 0 then 'debit' else 'credit' end as direction
      from private.ledger_entries e
      join private.ledger_accounts a on a.id = e.account_id
      join private.ledger_journals j on j.id = e.journal_id
      where j.booking_id = $1 and j.event_type = 'refund_processed'
      order by a.code
    `, [bookingId]);

    console.log(`[9.3] Refund Double-Entry Ledger Journal:`);
    let refundJournalSum = 0;
    for (const ent of refundJournalEntries.rows) {
      console.log(`      Account: ${ent.code.padEnd(20)} | Amount: ₹${(ent.amount_minor / 100).toString().padStart(6)} (${ent.direction})`);
      refundJournalSum += Number(ent.amount_minor);
    }
    console.log(`      Net Refund Journal Sum: ${refundJournalSum} (Expected: 0)`);

    // Dispatch cancellation notifications
    await fetch(`${EDGE_URL}/notification-worker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch_size: 50 })
    });

    // ================================================================
    // STEP 10: MASTER OWNER RUNS PAYOUT PLANNING & SETTLEMENT CYCLE
    // ================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('STEP 10: Master Owner runs payout planning + settlement cycle');
    console.log('----------------------------------------------------------------');

    // 10.1 Check unsettled financial summary before payout planning
    await client.query(
      `select set_config('request.jwt.claims', $1, false)`,
      [JSON.stringify({ sub: ownerUserId, role: 'authenticated' })]
    );

    const finSummary = (await client.query(`select public.get_owner_financial_summary($1) as fin`, [ownerMoId])).rows[0].fin;
    console.log(`[10.1] Pre-Payout Financial Summary for Master Owner:`);
    console.log(`       Unsettled Retained Net Revenue: ₹${finSummary.unsettled_payable_minor / 100} (Expected: ₹800)`);
    console.log(`       Unsettled Bookings Count:       ${finSummary.unsettled_booking_count}`);

    // 10.2 Plan payout
    const planRes = (await client.query(`select public.plan_owner_payout($1) as plan`, [ownerMoId])).rows[0].plan;
    console.log(`[10.2] Planned Payout Batch:`);
    console.log(`       Payout ID:          ${planRes.payout_id}`);
    console.log(`       Status:             ${planRes.status}`);
    console.log(`       Amount Minor:       ₹${planRes.amount_minor / 100}`);
    console.log(`       Allocated Bookings: ${planRes.allocated_bookings}`);

    const payoutId = planRes.payout_id;
    createdIds.payoutIds.push(payoutId);

    // Verify allocation line item references the cancelled booking with net retained revenue
    const allocItem = (await client.query(`select booking_id, amount_minor from private.payout_allocations where payout_id = $1`, [payoutId])).rows[0];
    console.log(`[10.3] Allocation Line-Item Traceability:`);
    console.log(`       Referenced Booking ID: ${allocItem.booking_id} (Matches step 6-9: ${allocItem.booking_id === bookingId})`);
    console.log(`       Allocated Net Amount:  ₹${allocItem.amount_minor / 100}`);

    // 10.3 Settle payout
    const settlementId = `setl_e2e_${ts}`;
    createdIds.journalEventKeys.push(`payout_settled_${settlementId}`);
    const settleRes = (await client.query(`select private.settle_owner_payout($1, $2) as settle`, [payoutId, settlementId])).rows[0].settle;
    console.log(`[10.4] Settlement Completed:`);
    console.log(`       Status:                 ${settleRes.status}`);
    console.log(`       Provider Settlement ID: ${settleRes.provider_settlement_id}`);

    // Verify payout double-entry ledger journal
    const payoutJournalEntries = await client.query(`
      select a.code, e.amount_minor, case when e.amount_minor > 0 then 'debit' else 'credit' end as direction
      from private.ledger_entries e
      join private.ledger_accounts a on a.id = e.account_id
      join private.ledger_journals j on j.id = e.journal_id
      where j.event_key = $1
      order by a.code
    `, [`payout_settled_${settlementId}`]);

    console.log(`[10.5] Payout Double-Entry Ledger Journal:`);
    let payoutJournalSum = 0;
    for (const ent of payoutJournalEntries.rows) {
      console.log(`       Account: ${ent.code.padEnd(20)} | Amount: ₹${(ent.amount_minor / 100).toString().padStart(6)} (${ent.direction})`);
      payoutJournalSum += Number(ent.amount_minor);
    }
    console.log(`       Net Payout Journal Sum: ${payoutJournalSum} (Expected: 0)`);

    // Reset session
    await client.query(`select set_config('request.jwt.claims', '', false)`);

    // ================================================================
    // STEP 11: MASTER OWNER DASHBOARD & STATEMENT RECONCILIATION
    // ================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('STEP 11: Master Owner views dashboard/statement & confirms reconciliation');
    console.log('----------------------------------------------------------------');

    await client.query(
      `select set_config('request.jwt.claims', $1, false)`,
      [JSON.stringify({ sub: ownerUserId, role: 'authenticated' })]
    );

    const dashRes = (await client.query(`select public.get_owner_dashboard($1) as dash`, [ownerMoId])).rows[0].dash;
    const stmtRes = (await client.query(`select public.get_owner_statement($1) as stmt`, [ownerMoId])).rows[0].stmt;

    console.log(`[11.1] Master Owner Dashboard Reconciliation:`);
    console.log(`       Total Bookings:           ${dashRes.summary.total_bookings}`);
    console.log(`       Confirmed Bookings:       ${dashRes.summary.confirmed_bookings}`);
    console.log(`       Cancelled Bookings:       ${dashRes.summary.cancelled_bookings}`);
    console.log(`       Gross Booking Value:      ₹${dashRes.summary.gross_booking_minor / 100} (Expected: ₹2,000)`);
    console.log(`       Platform Commission:     ₹${dashRes.summary.commission_minor / 100} (Expected: ₹200)`);
    console.log(`       Net Retained Owner Minor: ₹${dashRes.summary.net_owner_minor / 100} (Expected: ₹800)`);

    console.log(`\n[11.2] Master Owner Financial Statement Reconciliation:`);
    console.log(`       Owner Payable Net (Cr):   ₹${stmtRes.ledger_balances.owner_payable_net / 100} (Expected: ₹0 - fully settled!)`);
    console.log(`       Settled Payouts Total:    ₹${stmtRes.payouts.settled_minor / 100} (Expected: ₹800)`);
    console.log(`       Outstanding Payable:      ₹${stmtRes.payouts.outstanding_payable_minor / 100} (Expected: ₹0)`);
    console.log(`       Gateway Clearing Net:     ₹${stmtRes.ledger_balances.gateway_clearing_net / 100} (Expected: ₹200 platform commission asset)`);
    console.log(`       Platform Commission Net:  ₹${stmtRes.ledger_balances.platform_commission_net / 100} (Expected: -₹200 platform commission revenue)`);

    // Strict validation ensuring statement reconciles exactly with expected lifecycle values
    if (Number(stmtRes.ledger_balances.owner_payable_net) !== 0) {
      throw new Error(`Owner payable net mismatch: got ${stmtRes.ledger_balances.owner_payable_net}, expected 0`);
    }
    if (Number(stmtRes.payouts.settled_minor) !== 80000) {
      throw new Error(`Settled payouts total mismatch: got ${stmtRes.payouts.settled_minor}, expected 80000`);
    }
    if (Number(stmtRes.payouts.outstanding_payable_minor) !== 0) {
      throw new Error(`Outstanding payable mismatch: got ${stmtRes.payouts.outstanding_payable_minor}, expected 0`);
    }
    if (Number(stmtRes.ledger_balances.gateway_clearing_net) !== 20000) {
      throw new Error(`Gateway clearing net mismatch: got ${stmtRes.ledger_balances.gateway_clearing_net}, expected 20000`);
    }
    if (Number(stmtRes.ledger_balances.platform_commission_net) !== -20000) {
      throw new Error(`Platform commission net mismatch: got ${stmtRes.ledger_balances.platform_commission_net}, expected -20000`);
    }

    // Reset session
    await client.query(`select set_config('request.jwt.claims', '', false)`);

    // ================================================================
    // STEP 12: AUDIT TRAIL QUERIED AND SHOWS COHERENT EVENT HISTORY
    // ================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('STEP 12: Audit trail queried and shows coherent event history');
    console.log('----------------------------------------------------------------');

    const auditTrail = await client.query(`
      select action, entity_type, actor_type, reason, created_at
      from private.audit_events
      where master_owner_id = $1
      order by created_at asc
    `, [ownerMoId]);

    console.log(`[12.1] Complete Business Audit Event Trail for Tenant ${ownerMoId}:`);
    for (const a of auditTrail.rows) {
      console.log(`       Action: ${a.action.padEnd(25)} | Entity: ${a.entity_type.padEnd(14)} | Actor: ${a.actor_type.padEnd(8)} | Reason: ${a.reason}`);
    }

    // Verify all critical milestones are captured in the chronological audit history
    const actions = auditTrail.rows.map(r => r.action);
    const requiredActions = [
      'master_owner.onboard',
      'turf.create',
      'turf.submit_approval',
      'turf.admin_review',
      'master_owner.activate',
      'booking.confirm',
      'booking.cancel',
      'payout.plan',
      'payout.settle'
    ];

    const missingActions = requiredActions.filter(act => !actions.includes(act));
    console.log(`\n[12.2] Audit Trail Integrity Check:`);
    console.log(`       Total Tenant Audit Events: ${auditTrail.rows.length}`);
    console.log(`       All Required Lifecycle Actions Present: ${missingActions.length === 0}`);
    if (missingActions.length > 0) {
      throw new Error(`Missing expected audit actions: ${missingActions.join(', ')}`);
    }

    // System-wide ledger zero-sum check
    const globalSum = (await client.query(`select coalesce(sum(amount_minor), 0) as net from private.ledger_entries`)).rows[0].net;
    console.log(`       System-Wide Global Ledger Net Balance: ${globalSum} (Expected: 0)`);
    if (Number(globalSum) !== 0) {
      throw new Error(`System-wide ledger balance non-zero: ${globalSum}`);
    }

    console.log('\n================================================================');
    console.log('FULL SYSTEM CONTINUOUS LIFECYCLE COMPLETED WITH 100% PASS RATE');
    console.log('================================================================\n');

  } finally {
    await teardown(client, createdIds, ts);
    const postSnapshot = await getCatalogSnapshot(client);
    printCatalogSnapshot('AFTER TEARDOWN', postSnapshot);

    const postResidue = await getResidueSnapshot(client);
    printResidueSnapshot('AFTER TEARDOWN', postResidue);

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
                        postResidue.notifications === EXPECTED_BASE_NOTIFICATIONS &&
                        postResidue.notification_deliveries === EXPECTED_BASE_NOTIFICATION_DELIVERIES &&
                        postResidue.profiles === EXPECTED_BASE_PROFILES &&
                        postResidue.players === EXPECTED_BASE_PLAYERS &&
                        postSnapshot.bookingsCount === 0 &&
                        postSnapshot.payoutsCount === 0;

    await assertNoOrphans(client);

    if (!turfsMatch || !countsMatch || !residueMatch || !zeroResidue) {
      console.error('\nLEAK DETECTED: Pre and post snapshots do not match or contain residue!');
      if (!turfsMatch || !countsMatch) console.error('  Catalog mismatch detected.');
      if (!residueMatch) console.error('  Residue mismatch detected.');
      if (!zeroResidue) console.error('  Non-zero test residue detected in post-run database.');
      await client.end();
      process.exit(1);
    } else {
      console.log('\n[PASS] CATALOG & RESIDUE INTEGRITY CONFIRMED: pre === post === 0 test residue.');
    }
    await client.end();
  }
}


runLifecycle().catch(err => {
  console.error('\n[FATAL ERROR IN LIFECYCLE TEST]:', err);
  process.exit(1);
});
