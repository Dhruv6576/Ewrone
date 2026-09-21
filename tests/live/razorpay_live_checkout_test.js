// tests/live/razorpay_live_checkout_test.js
// Live integration test with real Razorpay test-mode API

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const EDGE_URL = process.env.EDGE_URL || (process.env.SUPABASE_URL ? `${process.env.SUPABASE_URL}/functions/v1` : 'http://127.0.0.1:54321/functions/v1');
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || null;

async function main() {
  console.log('================================================================');
  console.log('LIVE RAZORPAY TEST-MODE API VERIFICATION (CHECKOUT & IDEMPOTENCY)');
  console.log('================================================================\n');

  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  try {
    const ts = Date.now();

    const ownerUserId = 'd1d1d1d1-1111-2222-3333-444444444444';
    const ownerEmail = `live_owner_${ts}@example.com`;

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
    const playerToken = authData.access_token;
    const playerUserId = authData.user.id;
    const playerEmail = 'live_player@example.com';

    await client.query(`
      insert into auth.users (id, email, raw_user_meta_data) values
        ($1, $2, '{"name": "Live Test Owner"}')
      on conflict (id) do nothing
    `, [ownerUserId, ownerEmail]);

    const moRes = await client.query(`
      insert into public.master_owners (owner_user_id, business_name, status)
      values ($1, 'Live Razorpay Arena Ltd', 'active')
      returning id
    `, [ownerUserId]);
    const masterOwnerId = moRes.rows[0].id;

    const turfRes = await client.query(`
      insert into public.turfs (master_owner_id, slug, name, address_text, city, location, approval_status, timezone)
      values ($1, $2, 'Live Razorpay Turf', '100 Stadium Road', 'Bengaluru',
              extensions.st_setsrid(extensions.st_makepoint(77.5946, 12.9716), 4326), 'approved', 'Asia/Kolkata')
      returning id
    `, [masterOwnerId, `live-rzp-turf-${ts}`]);
    const turfId = turfRes.rows[0].id;

    const resRes = await client.query(`
      insert into public.resources (master_owner_id, turf_id, name, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, active)
      values ($1, $2, 'Match Pitch A', 30, 60, 240, true)
      returning id
    `, [masterOwnerId, turfId]);
    const resourceId = resRes.rows[0].id;

    await client.query(`
      insert into public.operating_hours (resource_id, iso_weekday, opens_at, closes_at, valid_from)
      select $1, gs, '06:00'::time, '23:00'::time, '2026-01-01'::date
      from generate_series(1, 7) gs
    `, [resourceId]);

    await client.query(`
      insert into public.pricing_rules (
        master_owner_id, turf_id, resource_id, priority, valid_from, iso_weekdays, starts_local, ends_local, amount_per_increment_minor
      ) values ($1, $2, $3, 0, '2026-01-01', '{1,2,3,4,5,6,7}', '06:00', '23:00', 100000)
    `, [masterOwnerId, turfId, resourceId]);

    // Financial account registration
    await client.query(`
      select private.register_owner_financial_account($1, 'razorpay', 'acc_live_test', 'HDFC Bank •••• 1234', true)
    `, [masterOwnerId]);

    console.log(`[1.1] Test fixtures initialized for live verification:`);
    console.log(`      Master Owner ID: ${masterOwnerId}`);
    console.log(`      Turf ID:         ${turfId}`);
    console.log(`      Resource ID:     ${resourceId}`);

    // 2. Create a Real Booking Hold
    const tomorrow = new Date(Date.now() + 86400000);
    const yyyy = tomorrow.getFullYear();
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    const slotStart = `${yyyy}-${mm}-${dd}T10:00:00+05:30`;
    const slotEnd   = `${yyyy}-${mm}-${dd}T11:00:00+05:30`;
    const holdIdempKey = `hold_live_${ts}`;

    await client.query(
      `select set_config('request.jwt.claims', $1, false)`,
      [JSON.stringify({ sub: playerUserId, role: 'authenticated' })]
    );

    const holdRes = await client.query(
      `select public.create_booking_hold($1, $2, $3, $4, 'Live Player', '+919999988888', $5) as hold`,
      [resourceId, slotStart, slotEnd, holdIdempKey, playerEmail]
    );
    const hold = holdRes.rows[0].hold;
    const bookingId = hold.booking_id;
    const bookingRef = hold.reference_code;

    console.log(`\n[2.1] Created Booking Hold:`);
    console.log(`      Booking ID:     ${bookingId}`);
    console.log(`      Reference Code: ${bookingRef}`);
    console.log(`      Amount:         ₹${hold.total_minor / 100} (${hold.currency})`);
    console.log(`      Hold Expires:   ${hold.hold_expires_at}`);

    await client.query(`select set_config('request.jwt.claims', '', false)`);

    // ================================================================
    // STEP 1: CALL CHECKOUT EDGE FUNCTION (REAL RAZORPAY ORDER CREATION)
    // ================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('STEP 1: Call Checkout Edge Function (Real Razorpay API Call)');
    console.log('----------------------------------------------------------------');

    const checkoutIdempKey = `chk_live_${ts}`;

    console.log(`Calling POST ${EDGE_URL}/checkout...`);
    const t0 = Date.now();
    const checkoutResp1 = await fetch(`${EDGE_URL}/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${playerToken}`
      },
      body: JSON.stringify({
        booking_id: bookingId,
        idempotency_key: checkoutIdempKey,
        purpose: 'initial'
      })
    });
    const duration1 = Date.now() - t0;
    const checkoutData1 = await checkoutResp1.json();

    console.log(`[1.2] Checkout Response 1: HTTP ${checkoutResp1.status} (${duration1}ms)`);
    console.log(`      Status:            ${checkoutData1.status}`);
    console.log(`      Adapter Mode:      ${checkoutData1.adapter_mode} (Expected: "real")`);
    console.log(`      Provider Order ID: ${checkoutData1.provider_order_id}`);
    console.log(`      Key ID used:       ${checkoutData1.key_id}`);
    console.log(`      Is Existing:       ${checkoutData1.is_existing}`);

    console.log(`\n[1.3] RAW RAZORPAY API RESPONSE (from https://api.razorpay.com/v1/orders):`);
    console.log(JSON.stringify(checkoutData1.raw_order, null, 2));

    if (checkoutResp1.status !== 200 || checkoutData1.adapter_mode !== 'real') {
      throw new Error(`Checkout failed or fell back to sandbox: ${JSON.stringify(checkoutData1)}`);
    }

    if (!checkoutData1.provider_order_id || !checkoutData1.provider_order_id.startsWith('order_')) {
      throw new Error(`Invalid Razorpay order format: ${checkoutData1.provider_order_id}`);
    }

    if (checkoutData1.provider_order_id.startsWith('order_rzp_mock_')) {
      throw new Error(`Expected real Razorpay order ID, but received mock ID: ${checkoutData1.provider_order_id}`);
    }

    console.log(`\n-> SUCCESS: Real Razorpay order created: ${checkoutData1.provider_order_id}`);

    // ================================================================
    // STEP 2: IDEMPOTENCY VERIFICATION (CALL AGAIN WITH IDENTICAL KEY)
    // ================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('STEP 2: Idempotency Verification (Call Again with Same Key)');
    console.log('----------------------------------------------------------------');

    const t1 = Date.now();
    const checkoutResp2 = await fetch(`${EDGE_URL}/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${playerToken}`
      },
      body: JSON.stringify({
        booking_id: bookingId,
        idempotency_key: checkoutIdempKey,
        purpose: 'initial'
      })
    });
    const duration2 = Date.now() - t1;
    const checkoutData2 = await checkoutResp2.json();

    console.log(`[2.2] Checkout Response 2: HTTP ${checkoutResp2.status} (${duration2}ms)`);
    console.log(`      Status:            ${checkoutData2.status}`);
    console.log(`      Adapter Mode:      ${checkoutData2.adapter_mode}`);
    console.log(`      Provider Order ID: ${checkoutData2.provider_order_id}`);
    console.log(`      Is Existing:       ${checkoutData2.is_existing} (Expected: true)`);

    if (checkoutData1.provider_order_id !== checkoutData2.provider_order_id) {
      throw new Error(`Idempotency broken: Order 1 (${checkoutData1.provider_order_id}) != Order 2 (${checkoutData2.provider_order_id})`);
    }

    if (checkoutData2.is_existing !== true) {
      throw new Error(`Expected is_existing = true for replay call`);
    }

    console.log(`\n-> SUCCESS: Idempotency verified: exactly 1 Razorpay order persisted without duplicates.`);

    // ================================================================
    // STEP 3: GENERATE HTML CHECKOUT DEMO FOR USER BROWSER PAYMENT
    // ================================================================
    const htmlPath = path.join(__dirname, 'razorpay_test_checkout.html');
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Razorpay Test Checkout - ${bookingRef}</title>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #1e293b; border-radius: 16px; padding: 32px; max-width: 480px; width: 100%; border: 1px solid #334155; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
    h1 { margin-top: 0; font-size: 22px; color: #38bdf8; }
    .row { display: flex; justify-content: space-between; margin: 12px 0; padding-bottom: 12px; border-bottom: 1px solid #334155; font-size: 14px; }
    .label { color: #94a3b8; }
    .val { font-weight: 600; }
    .total { font-size: 20px; color: #4ade80; font-weight: 700; border-bottom: none; margin-top: 16px; }
    button { width: 100%; padding: 14px; background: #0284c7; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; margin-top: 20px; transition: background 0.2s; }
    button:hover { background: #0369a1; }
    .hint { font-size: 12px; color: #94a3b8; margin-top: 16px; line-height: 1.5; background: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid #334155; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🏏 Complete Test Turf Booking</h1>
    <div class="row"><span class="label">Booking Reference:</span><span class="val">${bookingRef}</span></div>
    <div class="row"><span class="label">Booking ID:</span><span class="val" style="font-size:11px;">${bookingId}</span></div>
    <div class="row"><span class="label">Razorpay Order ID:</span><span class="val">${checkoutData1.provider_order_id}</span></div>
    <div class="row total"><span class="label" style="color:#4ade80;">Total Amount:</span><span>₹${checkoutData1.amount_minor / 100}</span></div>

    <button id="pay-btn">Pay with Razorpay Test Mode</button>

    <div class="hint">
      <strong>Test Payment Instructions:</strong><br>
      • Click the button above to launch Razorpay Modal.<br>
      • Select <strong>Card</strong>.<br>
      • Use any Razorpay Test Card (e.g. <code>4111 1111 1111 1111</code>, expiry any future date like <code>12/28</code>, CVV: <code>123</code>).<br>
      • Click Pay and enter any OTP (e.g. <code>123456</code>).<br>
      • Once payment completes, Razorpay will dispatch a live webhook to:<br>
      <code>${process.env.WEBHOOK_ENDPOINT_URL || 'your configured webhook endpoint (e.g. your ngrok tunnel or deployed Edge Function URL)'}</code>
    </div>
  </div>

  <script>
    document.getElementById('pay-btn').onclick = function() {
      var options = {
        key: "${checkoutData1.key_id}",
        amount: "${checkoutData1.amount_minor}",
        currency: "${checkoutData1.currency}",
        name: "Box Cricket Platform",
        description: "Booking ${bookingRef}",
        order_id: "${checkoutData1.provider_order_id}",
        handler: function (response){
          alert("Payment Successful! Razorpay Payment ID: " + response.razorpay_payment_id);
          document.getElementById('pay-btn').innerText = "Payment Completed (" + response.razorpay_payment_id + ")";
          document.getElementById('pay-btn').disabled = true;
          document.getElementById('pay-btn').style.background = "#16a34a";
        },
        prefill: {
          name: "Live Player",
          email: "${playerEmail}",
          contact: "+919999988888"
        },
        theme: { color: "#0284c7" }
      };
      var rzp1 = new Razorpay(options);
      rzp1.open();
    };
  </script>
</body>
</html>`;

    fs.writeFileSync(htmlPath, htmlContent);
    console.log(`\n[3.1] Test Checkout HTML Generated:`);
    console.log(`      Path: ${htmlPath}`);

    // Export key test details for the follow-up step
    const statePath = path.join(__dirname, 'last_live_checkout.json');
    fs.writeFileSync(statePath, JSON.stringify({
      bookingId,
      bookingRef,
      providerOrderId: checkoutData1.provider_order_id,
      amountMinor: checkoutData1.amount_minor,
      keyId: checkoutData1.key_id,
      htmlPath
    }, null, 2));

  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('\n[FATAL ERROR IN LIVE CHECKOUT TEST]:', err);
  process.exit(1);
});
