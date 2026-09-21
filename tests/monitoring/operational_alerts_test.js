// tests/monitoring/operational_alerts_test.js
// Standalone acceptance test harness for Production Readiness, pg_cron jobs, Ledger Invariant Monitor, and Operational Health Alerts.

const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function runMonitoringTests() {
  console.log('================================================================');
  console.log('STARTING PRODUCTION OPERATIONAL MONITORING & HEALTH ALERT TEST');
  console.log('================================================================\n');

  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  const adminUserId = 'a1a1a1a1-bbbb-cccc-dddd-eeeeeeeeeeee';
  let stuckWebhookId = null;
  let deadLetterIdemp = null;
  let deadLetterOutboxId = null;
  let bookingExId = null;

  try {
    const ts = Date.now();
    stuckWebhookId = `evt_stuck_${ts}`;
    deadLetterIdemp = `idemp_dead_letter_${ts}`;

    // 0. Base Fixtures Setup: Setup Platform Admin for human alert verification
    const adminEmail = `ops_admin_${ts}@example.com`;

    await client.query(`
      insert into auth.users (id, email, raw_user_meta_data)
      values ($1, $2, '{"name": "Operations Admin"}')
      on conflict (id) do nothing
    `, [adminUserId, adminEmail]);

    await client.query(`
      insert into private.platform_admins (user_id, active)
      values ($1, true)
      on conflict (user_id) do update set active = true
    `, [adminUserId]);

    console.log(`[0.1] Configured Platform Administrator for Alert Dispatch: ${adminEmail} (${adminUserId})`);

    // ================================================================
    // SCENARIO 1: STUCK WEBHOOK DETECTION (>15 MINUTES IN RETRYABLE)
    // ================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('SCENARIO 1: Stuck Webhook Detection (>15 Minutes in Retryable)');
    console.log('----------------------------------------------------------------');
    await client.query(`
      insert into private.webhook_events (
        provider, provider_account_scope, provider_event_id, event_type, raw_body, body_hash, status, attempts, last_error, received_at
      ) values (
        'razorpay', 'global', $1, 'payment.captured', '{"amount": 200000}', 'hash123', 'retryable', 4,
        'ORDER_NOT_FOUND: Synchronization timeout exceeded',
        now() - interval '25 minutes'
      )
    `, [stuckWebhookId]);

    console.log(`[1.1] Inserted simulated stuck webhook: ${stuckWebhookId} (received 25 minutes ago)`);

    // Run operational health check
    const health1 = (await client.query(`select private.check_operational_health(interval '15 minutes') as res`)).rows[0].res;
    console.log(`[1.2] check_operational_health() executed:`, JSON.stringify(health1));

    // Verify alert in private.operational_alerts
    const webhookAlert = (await client.query(`
      select id, alert_type, severity, title, details, status
      from private.operational_alerts
      where alert_type = 'stuck_webhook' and details->>'provider_event_id' = $1
    `, [stuckWebhookId])).rows[0];

    console.log(`[1.3] Operational Alert Recorded:`);
    console.log(`      Alert ID: ${webhookAlert.id}`);
    console.log(`      Severity: ${webhookAlert.severity} (Expected: warning)`);
    console.log(`      Title:    ${webhookAlert.title}`);
    console.log(`      Status:   ${webhookAlert.status}`);

    if (!webhookAlert || webhookAlert.status !== 'active') {
      throw new Error(`Expected active stuck_webhook alert, got: ${JSON.stringify(webhookAlert)}`);
    }

    // ================================================================
    // SCENARIO 2: OUTBOX WORKER CRASH / EXHAUSTION (DEAD-LETTER DETECTION)
    // ================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('SCENARIO 2: Outbox Worker Crash / Exhaustion (Dead-Letter Detection)');
    console.log('----------------------------------------------------------------');

    const outboxInsertRes = await client.query(`
      insert into private.outbox_events (
        topic, aggregate_type, aggregate_id, dedupe_key, payload, attempts, last_error
      ) values (
        'payout.settle_critical', 'payout', gen_random_uuid(), $1, '{"amount": 50000}', 5,
        'UPSTREAM_TIMEOUT: Payout gateway connection dropped after 5 retries'
      ) returning id
    `, [deadLetterIdemp]);
    deadLetterOutboxId = outboxInsertRes.rows[0].id;

    console.log(`[2.1] Inserted simulated dead-letter outbox event: ${deadLetterOutboxId} (attempts: 5/5)`);

    // Run operational health check
    const health2 = (await client.query(`select private.check_operational_health() as res`)).rows[0].res;
    console.log(`[2.2] check_operational_health() executed:`, JSON.stringify(health2));

    // Verify error-level alert recorded
    const deadLetterAlert = (await client.query(`
      select id, alert_type, severity, title, details, status
      from private.operational_alerts
      where alert_type = 'dead_letter_outbox' and entity_id = $1
    `, [deadLetterOutboxId])).rows[0];

    console.log(`[2.3] Operational Alert Recorded:`);
    console.log(`      Alert ID: ${deadLetterAlert.id}`);
    console.log(`      Severity: ${deadLetterAlert.severity} (Expected: error)`);
    console.log(`      Title:    ${deadLetterAlert.title}`);

    // Verify human alert notification dispatched to platform admins
    const adminNotif2 = (await client.query(`
      select id, title, body, kind, created_at
      from public.notifications
      where user_id = $1 and kind = 'system.alert'
      order by created_at desc limit 1
    `, [adminUserId])).rows[0];

    console.log(`[2.4] Human Notification Dispatched to Platform Admin:`);
    console.log(`      Notification ID: ${adminNotif2.id}`);
    console.log(`      Title:           "${adminNotif2.title}"`);
    console.log(`      Body:            "${adminNotif2.body}"`);

    if (!deadLetterAlert || deadLetterAlert.severity !== 'error' || !adminNotif2) {
      throw new Error(`Dead-letter outbox alert or admin notification failed!`);
    }

    // ================================================================
    // SCENARIO 3: PAYMENT EXCEPTION HUMAN ATTENTION ALERT
    // ================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('SCENARIO 3: Payment Exception Human Attention Alert');
    console.log('----------------------------------------------------------------');

    // Ensure owner, turf, resource fixtures exist for foreign key references
    const existingRow = (await client.query(`
      select r.id as resource_id, t.id as turf_id, t.master_owner_id
      from public.resources r
      join public.turfs t on t.id = r.turf_id
      limit 1
    `)).rows[0];

    let ownerId, turfId, resourceId;
    if (existingRow) {
      ownerId = existingRow.master_owner_id;
      turfId = existingRow.turf_id;
      resourceId = existingRow.resource_id;
    } else {
      const ownerRes = await client.query(`
        insert into public.master_owners (owner_user_id, business_name, status)
        values ($1, 'Ops Test Arena', 'active')
        returning id
      `, [adminUserId]);
      ownerId = ownerRes.rows[0].id;

      const turfRes = await client.query(`
        insert into public.turfs (master_owner_id, slug, name, address_text, city, location, approval_status)
        values ($1, $2, 'Ops Arena', '123 Alert Way', 'Bengaluru', extensions.st_setsrid(extensions.st_makepoint(77.5946, 12.9716), 4326), 'approved')
        returning id
      `, [ownerId, `ops-arena-${ts}`]);
      turfId = turfRes.rows[0].id;

      const resRes = await client.query(`
        insert into public.resources (master_owner_id, turf_id, name)
        values ($1, $2, 'Ops Pitch 1')
        returning id
      `, [ownerId, turfId]);
      resourceId = resRes.rows[0].id;
    }

    // Create a booking in payment_exception status
    const bookingExRes = await client.query(`
      insert into public.bookings (
        reference_code, master_owner_id, turf_id, resource_id, player_user_id, created_by, source, status, total_minor, required_online_minor,
        pricing_snapshot, cancellation_snapshot, commission_snapshot,
        payment_exception_reason, starts_at, ends_at
      ) values (
        'BK-ALERT-' || substr(md5(random()::text), 1, 6),
        $1, $2, $3, $4, $4, 'online',
        'payment_exception',
        200000, 200000,
        '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
        'Payment captured after hold expiry (§7.5)',
        now() + interval '1 day',
        now() + interval '1 day 1 hour'
      ) returning id, reference_code
    `, [ownerId, turfId, resourceId, adminUserId]);
    bookingExId = bookingExRes.rows[0].id;
    const bookingExRef = bookingExRes.rows[0].reference_code;

    console.log(`[3.1] Created booking in payment_exception status: ${bookingExId} (${bookingExRef})`);

    // Run operational health check
    const health3 = (await client.query(`select private.check_operational_health() as res`)).rows[0].res;
    console.log(`[3.2] check_operational_health() executed:`, JSON.stringify(health3));

    const payExAlert = (await client.query(`
      select id, alert_type, severity, title, details, status
      from private.operational_alerts
      where alert_type = 'payment_exception' and entity_id = $1
    `, [bookingExId])).rows[0];

    console.log(`[3.3] Operational Alert Recorded:`);
    console.log(`      Alert ID: ${payExAlert.id}`);
    console.log(`      Severity: ${payExAlert.severity} (Expected: error)`);
    console.log(`      Title:    ${payExAlert.title}`);

    if (!payExAlert || payExAlert.severity !== 'error') {
      throw new Error(`Payment exception alert not recorded correctly!`);
    }

    // ================================================================
    // SCENARIO 4: ALERT DEDUPLICATION & AUTO-RESOLUTION
    // ================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('SCENARIO 4: Alert Deduplication & Auto-Resolution');
    console.log('----------------------------------------------------------------');

    // 4.1 Re-run check: verify active alerts count does not increase (deduplication)
    const activeCountBefore = (await client.query(`select count(*) from private.operational_alerts where status = 'active'`)).rows[0].count;
    await client.query(`select private.check_operational_health()`);
    const activeCountAfter = (await client.query(`select count(*) from private.operational_alerts where status = 'active'`)).rows[0].count;

    console.log(`[4.1] Active Alerts Before Re-Check: ${activeCountBefore}`);
    console.log(`      Active Alerts After Re-Check:  ${activeCountAfter} (Expected: identical - no duplicates)`);
    if (activeCountBefore !== activeCountAfter) {
      throw new Error(`Alert deduplication failed: active count increased from ${activeCountBefore} to ${activeCountAfter}`);
    }

    // 4.2 Auto-resolution: Mark outbox event completed and webhook event processed
    await client.query(`update private.outbox_events set completed_at = now() where id = $1`, [deadLetterOutboxId]);
    await client.query(`update private.webhook_events set status = 'processed' where provider_event_id = $1`, [stuckWebhookId]);

    console.log(`[4.2] Resolved underlying issues for outbox event and webhook event.`);
    await client.query(`select private.check_operational_health()`);

    const deadLetterStatus = (await client.query(`select status, resolved_at from private.operational_alerts where alert_type = 'dead_letter_outbox' and entity_id = $1`, [deadLetterOutboxId])).rows[0];
    const webhookStatus = (await client.query(`select status, resolved_at from private.operational_alerts where alert_type = 'stuck_webhook' and details->>'provider_event_id' = $1`, [stuckWebhookId])).rows[0];

    console.log(`[4.3] Post-Recovery Alert States:`);
    console.log(`      Dead-Letter Alert Status: ${deadLetterStatus.status} (Resolved At: ${deadLetterStatus.resolved_at})`);
    console.log(`      Stuck Webhook Alert Status: ${webhookStatus.status} (Resolved At: ${webhookStatus.resolved_at})`);

    if (deadLetterStatus.status !== 'resolved' || webhookStatus.status !== 'resolved') {
      throw new Error(`Alert auto-resolution failed!`);
    }

    // ================================================================
    // SCENARIO 5: LEDGER INVARIANT MONITOR (CLEAN PASS + ROLLED BACK UNBALANCED SIMULATION)
    // ================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('SCENARIO 5: Ledger Invariant Monitor (Clean Pass + Rolled Back Simulation)');
    console.log('----------------------------------------------------------------');

    // 5.1 Clean zero-sum test
    const cleanCheck = (await client.query(`select private.check_ledger_invariants() as res`)).rows[0].res;
    console.log(`[5.1] Healthy Database Ledger Invariant Check:`);
    console.log(`      Healthy:              ${cleanCheck.healthy} (Expected: true)`);
    console.log(`      Global Net Sum Minor: ${cleanCheck.global_sum_minor} (Expected: 0)`);
    console.log(`      Unbalanced Journals:  ${cleanCheck.unbalanced_journals_count} (Expected: 0)`);
    console.log(`      Alerts Raised:        ${cleanCheck.alerts_raised} (Expected: 0)`);

    if (!cleanCheck.healthy || Number(cleanCheck.global_sum_minor) !== 0) {
      throw new Error(`Ledger invariant check failed on clean database!`);
    }

    // 5.2 Simulation of Unbalanced Entry in a Transaction with STRICT ROLLBACK
    console.log(`\n[5.2] Simulating Unbalanced Journal in an uncommitted transaction...`);
    const simClient = new Client({ connectionString: DB_URL });
    await simClient.connect();

    let simJournalId;
    try {
      await simClient.query('BEGIN');

      const simJournalRes = await simClient.query(`
        insert into private.ledger_journals (event_key, event_type, currency)
        values ($1, 'simulation_test', 'INR')
        returning id
      `, [`sim_event_${ts}`]);
      simJournalId = simJournalRes.rows[0].id;

      // Insert an unbalanceable single entry (+₹5,000)
      await simClient.query(`
        insert into private.ledger_entries (journal_id, account_id, currency, amount_minor)
        values (
          $1,
          (select id from private.ledger_accounts where code = 'gateway_clearing' limit 1),
          'INR',
          500000
        )
      `, [simJournalId]);

      // Execute monitor logic within this transaction
      const simCheck = (await simClient.query(`select private.check_ledger_invariants() as res`)).rows[0].res;
      console.log(`      Simulated Violation Detected:`);
      console.log(`      Healthy:              ${simCheck.healthy} (Expected: false)`);
      console.log(`      Global Net Sum Minor: ₹${simCheck.global_sum_minor / 100} (Expected: ₹5000)`);
      console.log(`      Unbalanced Journals:  ${simCheck.unbalanced_journals_count} (Expected: >= 1)`);
      console.log(`      Alerts Raised:        ${simCheck.alerts_raised}`);

      if (simCheck.healthy || Number(simCheck.global_sum_minor) === 0) {
        throw new Error(`Monitor failed to detect unbalanced journal!`);
      }

    } finally {
      // EXPLICIT MANDATORY ROLLBACK
      console.log(`[5.3] Executing MANDATORY ROLLBACK on simulated unbalanced transaction...`);
      await simClient.query('ROLLBACK');
      await simClient.end();
    }

    // Follow-up verification: prove ZERO residual entries and ZERO corruption remain in the ledger
    console.log(`[5.4] Post-Rollback Ledger Verification Query:`);
    const residualEntries = (await client.query(`
      select count(*) as count from private.ledger_entries where journal_id = $1
    `, [simJournalId])).rows[0].count;

    const globalSumPost = (await client.query(`
      select coalesce(sum(amount_minor), 0) as net from private.ledger_entries
    `)).rows[0].net;

    console.log(`      Residual Simulation Entries: ${residualEntries} (Expected: 0)`);
    console.log(`      Global Ledger Net Sum:        ${globalSumPost} (Expected: 0)`);

    if (Number(residualEntries) !== 0 || Number(globalSumPost) !== 0) {
      throw new Error(`CRITICAL: Residual ledger entries detected after simulation rollback! Residual count: ${residualEntries}`);
    }
    console.log(`      -> PROOF CONFIRMED: 0 residual rows, ledger zero-sum fully intact.`);

    // ================================================================
    // SCENARIO 6: PG_CRON SCHEDULED MAINTENANCE JOBS AUDIT
    // ================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('SCENARIO 6: pg_cron Scheduled Maintenance Jobs Audit');
    console.log('----------------------------------------------------------------');

    const cronJobsRes = await client.query(`
      select jobid, schedule, command, nodename, username, active, jobname
      from cron.job
      order by jobname
    `);

    console.log(`[6.1] Scheduled Maintenance Jobs in cron.job (${cronJobsRes.rows.length} total):`);
    for (const job of cronJobsRes.rows) {
      console.log(`      Job: [${job.jobname.padEnd(28)}] | Schedule: [${job.schedule.padEnd(11)}] | Active: ${job.active} | Role: ${job.username}`);
      console.log(`           Command: ${job.command}`);
    }

    const requiredJobs = [
      'expire-booking-holds',
      'retry-unprocessed-webhooks',
      'trigger-notification-worker',
      'check-ledger-invariants',
      'check-operational-health'
    ];

    const scheduledJobNames = cronJobsRes.rows.map(j => j.jobname);
    const missingJobs = requiredJobs.filter(name => !scheduledJobNames.includes(name));

    console.log(`\n[6.2] Cron Audit Verification:`);
    console.log(`      All 5 Required Jobs Scheduled: ${missingJobs.length === 0}`);
    if (missingJobs.length > 0) {
      throw new Error(`Missing scheduled cron jobs: ${missingJobs.join(', ')}`);
    }

    // Role execution verification
    const nonPostgresJobs = cronJobsRes.rows.filter(j => j.username !== 'postgres');
    console.log(`      Execution Role Verified as 'postgres': ${nonPostgresJobs.length === 0}`);
    if (nonPostgresJobs.length > 0) {
      throw new Error(`Some cron jobs not running as 'postgres': ${JSON.stringify(nonPostgresJobs)}`);
    }

    console.log('\n================================================================');
    console.log('ALL 6 PRODUCTION OPERATIONAL MONITORING SCENARIOS PASSED (100%)');
    console.log('================================================================\n');

  } finally {
    // Deterministic Teardown for all operational alerts test fixtures
    try {
      console.log('\n--- CLEANING UP OPERATIONAL ALERTS TEST FIXTURES ---');
      await client.query('RESET ROLE;').catch(() => {});

      // 1. Delete notifications and deliveries
      await client.query(`DELETE FROM private.notification_deliveries WHERE notification_id IN (SELECT id FROM public.notifications WHERE user_id = $1);`, [adminUserId]);
      await client.query(`DELETE FROM public.notifications WHERE user_id = $1;`, [adminUserId]);

      // 2. Delete bookings and allocations
      if (bookingExId) {
        await client.query(`DELETE FROM public.booking_slots WHERE booking_id = $1;`, [bookingExId]);
        await client.query(`DELETE FROM public.inventory_allocations WHERE booking_id = $1;`, [bookingExId]);
        await client.query(`DELETE FROM public.bookings WHERE id = $1;`, [bookingExId]);
      }

      // 3. Delete operational alerts
      await client.query(`
        DELETE FROM private.operational_alerts 
        WHERE (entity_id = $1 AND $1::uuid IS NOT NULL)
           OR (entity_id = $2 AND $2::uuid IS NOT NULL)
           OR (details->>'provider_event_id' = $3 AND $3 IS NOT NULL)
           OR (details->>'booking_id')::text = $2::text;
      `, [deadLetterOutboxId, bookingExId, stuckWebhookId]);

      // 4. Delete outbox events
      await client.query(`
        DELETE FROM private.outbox_events 
        WHERE dedupe_key = $1 
           OR (id = $2 AND $2::uuid IS NOT NULL)
           OR (aggregate_id = $2 AND $2::uuid IS NOT NULL)
           OR (topic = 'notification.dispatch' AND payload->>'user_id' = $3);
      `, [deadLetterIdemp, deadLetterOutboxId, adminUserId]);

      // 5. Delete webhook events
      if (stuckWebhookId) {
        await client.query(`DELETE FROM private.webhook_events WHERE provider_event_id = $1;`, [stuckWebhookId]);
      }

      // 6. Delete admin privileges, players, profiles, and auth.users for adminUserId
      await client.query(`DELETE FROM private.admin_grants WHERE user_id = $1;`, [adminUserId]);
      await client.query(`DELETE FROM private.platform_admins WHERE user_id = $1;`, [adminUserId]);
      await client.query(`DELETE FROM public.players WHERE user_id = $1;`, [adminUserId]);
      await client.query(`DELETE FROM public.profiles WHERE user_id = $1;`, [adminUserId]);
      await client.query(`DELETE FROM auth.users WHERE id = $1;`, [adminUserId]);

      console.log('Operational alerts test fixtures successfully cleaned up.');
    } catch (cleanupErr) {
      console.error('Error during operational alerts teardown:', cleanupErr);
    } finally {
      await client.end();
    }
  }
}

runMonitoringTests().catch(err => {
  console.error('\n[FATAL ERROR IN MONITORING TEST]:', err);
  process.exit(1);
});
