// tests/live/verify_live_payment_webhook.js
// Post-payment verification script to audit the live Razorpay webhook delivery, HMAC verification, booking confirmation, and double-entry ledger journals.

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function main() {
  console.log('================================================================');
  console.log('AUDITING LIVE RAZORPAY PAYMENT WEBHOOK & BOOKING CONFIRMATION');
  console.log('================================================================\n');

  const statePath = path.join(__dirname, 'last_live_checkout.json');
  if (!fs.existsSync(statePath)) {
    throw new Error('last_live_checkout.json not found! Please run razorpay_live_checkout_test.js first.');
  }

  const { bookingId, bookingRef, providerOrderId } = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  console.log(`Targeting Booking ID:       ${bookingId} (${bookingRef})`);
  console.log(`Targeting Razorpay Order ID: ${providerOrderId}\n`);

  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  try {
    // 1. Check private.webhook_events
    console.log('--- 1. DURABLE WEBHOOK INBOX (private.webhook_events) ---');
    const webhookRes = await client.query(`
      select id, provider, provider_event_id, event_type, status, attempts, last_error, received_at, processed_at, raw_body
      from private.webhook_events
      where raw_body like '%' || $1 || '%'
      order by received_at desc
      limit 1
    `, [providerOrderId]);

    if (webhookRes.rows.length === 0) {
      console.log(`[PENDING] No webhook event found yet containing order ID "${providerOrderId}".`);
      console.log(`          Has the payment been completed in the browser?`);
      return;
    }

    const wh = webhookRes.rows[0];
    console.log(`Webhook Event ID:   ${wh.id}`);
    console.log(`Provider Event ID:  ${wh.provider_event_id}`);
    console.log(`Event Type:         ${wh.event_type}`);
    console.log(`Status:             ${wh.status} (Expected: processed)`);
    console.log(`Received At:        ${wh.received_at}`);
    console.log(`Processed At:       ${wh.processed_at}`);
    console.log(`Last Error:         ${wh.last_error || 'none'}`);

    console.log('\n--- RAW RAZORPAY WEBHOOK PAYLOAD ---');
    try {
      console.log(JSON.stringify(JSON.parse(wh.raw_body), null, 2));
    } catch {
      console.log(wh.raw_body);
    }

    // 2. Check public.bookings status
    console.log('\n--- 2. BOOKING STATE (public.bookings) ---');
    const bookingRes = await client.query(`
      select id, reference_code, status, total_minor, currency, confirmed_at, payment_exception_reason
      from public.bookings
      where id = $1
    `, [bookingId]);
    const b = bookingRes.rows[0];
    console.log(`Booking ID:     ${b.id}`);
    console.log(`Reference Code: ${b.reference_code}`);
    console.log(`Status:         ${b.status} (Expected: "confirmed")`);
    console.log(`Confirmed At:   ${b.confirmed_at}`);
    console.log(`Exception Note: ${b.payment_exception_reason || 'none'}`);

    // 3. Check private.payments
    console.log('\n--- 3. PAYMENT RECORD (private.payments) ---');
    const payRes = await client.query(`
      select p.id, p.provider, p.provider_payment_id, p.amount_minor, p.currency, p.status, p.captured_at
      from private.payments p
      join private.payment_orders o on o.id = p.payment_order_id
      where o.provider_order_id = $1
    `, [providerOrderId]);
    if (payRes.rows.length > 0) {
      const p = payRes.rows[0];
      console.log(`Payment ID:          ${p.id}`);
      console.log(`Provider Payment ID: ${p.provider_payment_id}`);
      console.log(`Amount:              ₹${p.amount_minor / 100} (${p.currency})`);
      console.log(`Status:              ${p.status}`);
      console.log(`Captured At:         ${p.captured_at}`);
    } else {
      console.log('No private.payments record found linked to this order.');
    }

    // 4. Check Double-Entry Ledger Journal & Entries
    console.log('\n--- 4. DOUBLE-ENTRY FINANCIAL LEDGER (private.ledger_journals & entries) ---');
    const journalRes = await client.query(`
      select j.id, j.event_key, j.event_type, j.posted_at
      from private.ledger_journals j
      where j.booking_id = $1 or j.event_key like '%' || $2 || '%'
      order by j.posted_at desc
      limit 1
    `, [bookingId, providerOrderId]);

    if (journalRes.rows.length > 0) {
      const j = journalRes.rows[0];
      console.log(`Journal ID:   ${j.id}`);
      console.log(`Event Key:    ${j.event_key}`);
      console.log(`Event Type:   ${j.event_type}`);

      const entriesRes = await client.query(`
        select a.code, a.description, e.amount_minor, e.currency
        from private.ledger_entries e
        join private.ledger_accounts a on a.id = e.account_id
        where e.journal_id = $1
        order by e.amount_minor desc
      `, [j.id]);

      let netSum = 0;
      console.log('\nLedger Entry Legs:');
      for (const entry of entriesRes.rows) {
        netSum += Number(entry.amount_minor);
        const sign = entry.amount_minor >= 0 ? '+' : '-';
        const formatted = `₹${Math.abs(entry.amount_minor) / 100}`;
        console.log(`  Account: [${entry.code.padEnd(25)}] | Amount: ${sign}${formatted.padEnd(8)} (${entry.amount_minor} paise)`);
      }
      console.log(`Net Journal Sum: ${netSum} paise (Expected: 0)`);
    } else {
      console.log('No ledger journal found for this booking.');
    }

    // 5. Check outbox events
    console.log('\n--- 5. OUTBOX NOTIFICATION DISPATCH (private.outbox_events) ---');
    const outboxRes = await client.query(`
      select id, topic, aggregate_type, dedupe_key, attempts, completed_at, created_at
      from private.outbox_events
      where dedupe_key like '%' || $1 || '%' or dedupe_key like '%' || $2 || '%'
    `, [bookingId, providerOrderId]);
    for (const ob of outboxRes.rows) {
      console.log(`Outbox ID:     ${ob.id}`);
      console.log(`Topic:         ${ob.topic}`);
      console.log(`Dedupe Key:    ${ob.dedupe_key}`);
      console.log(`Attempts:      ${ob.attempts}`);
      console.log(`Completed At:  ${ob.completed_at || 'pending execution'}`);
    }

    console.log('\n================================================================');
    console.log('AUDIT COMPLETED');
    console.log('================================================================\n');

  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('\n[FATAL ERROR]:', err);
  process.exit(1);
});
