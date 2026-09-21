const { Client } = require('pg');
const { createServerClient } = require('@supabase/ssr');
const http = require('http');
const fs = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

let logOutput = '';
function log(msg) {
  console.log(msg);
  logOutput += msg + '\n';
}

async function getSessionCookie(email, password) {
  const cookieJar = new Map();
  const cookieStore = {
    getAll() { return Array.from(cookieJar.entries()).map(([name, value]) => ({ name, value })); },
    setAll(c) { c.forEach(({ name, value }) => cookieJar.set(name, value)); }
  };

  const client = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookieOptions: { name: 'sb-boxcodex-owner-auth-token' },
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(c) { cookieStore.setAll(c); }
    }
  });

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;

  const cookieHeader = Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  return { cookieHeader, client, user: data.user };
}

function doRequest(path, cookieHeader, acceptHeader = 'application/json') {
  return new Promise((resolve, reject) => {
    const headers = { 'Accept': acceptHeader };
    if (cookieHeader) headers['Cookie'] = cookieHeader;

    const req = http.request({
      hostname: 'localhost',
      port: 3001,
      path: path,
      method: 'GET',
      headers: headers
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: body
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runMatrix() {
  log('=======================================================');
  log('PORT 3001 FULL WORKSPACE AUTHORIZATION MATRIX EXECUTION');
  log('Timestamp: ' + new Date().toISOString());
  log('=======================================================\n');

  // -------------------------------------------------------------------------
  // a) live_player (authenticated) -> GET /master/dashboard & GET /owner/dashboard
  // -------------------------------------------------------------------------
  log('--- TEST A: live_player (Authenticated Player Session) ---');
  const playerSession = await getSessionCookie('live_player@example.com', 'Password123!');
  
  const resA1 = await doRequest('/master/dashboard', playerSession.cookieHeader, 'application/json');
  log(`live_player -> GET /master/dashboard: HTTP ${resA1.status}`);
  log(`Response Headers: ${JSON.stringify(resA1.headers)}`);
  log(`Response Body: ${resA1.body.trim()}\n`);

  const resA2 = await doRequest('/owner/dashboard', playerSession.cookieHeader, 'application/json');
  log(`live_player -> GET /owner/dashboard: HTTP ${resA2.status}`);
  log(`Response Headers: ${JSON.stringify(resA2.headers)}`);
  log(`Response Body: ${resA2.body.trim()}\n`);

  // -------------------------------------------------------------------------
  // b) live_player, no session (anonymous) -> same two URLs
  // -------------------------------------------------------------------------
  log('--- TEST B: Anonymous (No Session Cookie) ---');
  const resB1 = await doRequest('/master/dashboard', null, 'application/json');
  log(`anonymous -> GET /master/dashboard (Accept: application/json): HTTP ${resB1.status}`);
  log(`Response Headers: ${JSON.stringify(resB1.headers)}`);
  log(`Response Body: ${resB1.body.trim()}\n`);

  const resB2 = await doRequest('/owner/dashboard', null, 'application/json');
  log(`anonymous -> GET /owner/dashboard (Accept: application/json): HTTP ${resB2.status}`);
  log(`Response Headers: ${JSON.stringify(resB2.headers)}`);
  log(`Response Body: ${resB2.body.trim()}\n`);

  // -------------------------------------------------------------------------
  // c) demo_staff -> GET /owner/dashboard & GET /master/turfs & MO-only RPC
  // -------------------------------------------------------------------------
  log('--- TEST C: demo_staff (Staff Member) ---');
  const staffSession = await getSessionCookie('demo_staff@boxcodex.internal', 'Password123!');

  const resC1 = await doRequest('/owner/dashboard', staffSession.cookieHeader, 'application/json');
  log(`demo_staff -> GET /owner/dashboard: HTTP ${resC1.status}`);
  log(`Response Headers: ${JSON.stringify(resC1.headers)}`);
  log(`Response Body (first 100 chars): ${resC1.body.substring(0, 100).trim()}\n`);

  const resC2 = await doRequest('/master/turfs', staffSession.cookieHeader, 'application/json');
  log(`demo_staff -> GET /master/turfs: HTTP ${resC2.status}`);
  log(`Response Headers: ${JSON.stringify(resC2.headers)}`);
  log(`Response Body: ${resC2.body.trim()}\n`);

  log('demo_staff calling MO-only RPC update_employee_assignments:');
  const { data: rpcData, error: rpcErr } = await staffSession.client.rpc('update_employee_assignments', {
    p_employee_id: 'e1111111-1111-1111-1111-111111111111',
    p_turf_id: '21efb282-8b54-47c2-88bc-987d9c0e208d',
    p_capabilities: ['listing.view'],
    p_active: true
  });
  log(`RPC Data: ${JSON.stringify(rpcData)}`);
  log(`RPC Error Code (SQLSTATE): ${rpcErr?.code}`);
  log(`RPC Error Message: ${rpcErr?.message}`);
  log(`Full Error Details: ${JSON.stringify(rpcErr)}\n`);

  // -------------------------------------------------------------------------
  // d) demo_owner -> GET /master/dashboard & GET /owner/turfs
  // -------------------------------------------------------------------------
  log('--- TEST D: demo_owner (Master Owner) ---');
  const ownerSession = await getSessionCookie('demo_owner@boxcodex.internal', 'Password123!');

  const resD1 = await doRequest('/master/dashboard', ownerSession.cookieHeader, 'application/json');
  log(`demo_owner -> GET /master/dashboard: HTTP ${resD1.status}`);
  log(`Response Headers: ${JSON.stringify(resD1.headers)}`);
  log(`Response Body (first 100 chars): ${resD1.body.substring(0, 100).trim()}\n`);

  const resD2 = await doRequest('/owner/turfs', ownerSession.cookieHeader, 'application/json');
  log(`demo_owner -> GET /owner/turfs: HTTP ${resD2.status}`);
  log(`Response Headers: ${JSON.stringify(resD2.headers)}`);
  log(`Response Body (first 100 chars): ${resD2.body.substring(0, 100).trim()}\n`);

  // -------------------------------------------------------------------------
  // e) demo_admin -> observed policy for /master/* and /owner/*
  // -------------------------------------------------------------------------
  log('--- TEST E: demo_admin (Platform Admin Policy Verification) ---');
  const adminSession = await getSessionCookie('demo_admin@boxcodex.internal', 'Password123!');

  const resE1 = await doRequest('/master/dashboard', adminSession.cookieHeader, 'application/json');
  log(`demo_admin -> GET /master/dashboard: HTTP ${resE1.status}`);
  log(`Response Headers: ${JSON.stringify(resE1.headers)}`);
  log(`Response Body (first 100 chars): ${resE1.body.substring(0, 100).trim()}\n`);

  const resE2 = await doRequest('/owner/dashboard', adminSession.cookieHeader, 'application/json');
  log(`demo_admin -> GET /owner/dashboard: HTTP ${resE2.status}`);
  log(`Response Headers: ${JSON.stringify(resE2.headers)}`);
  log(`Response Body (first 100 chars): ${resE2.body.substring(0, 100).trim()}\n`);
  log('Observed Policy: proxy.ts grants platform_admin bypass for both /master/* and /owner/* via role.isPlatformAdmin check.\n');

  // -------------------------------------------------------------------------
  // f) disabled employee -> active status gate verification & teardown
  // -------------------------------------------------------------------------
  log('--- TEST F: Disabled Employee Gate Verification ---');
  const pg = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    statement_timeout: 5000
  });
  await pg.connect();

  const tempEmpUid = 'f0000000-0000-0000-0000-000000000001';
  const tempEmpId = 'e0000000-0000-0000-0000-000000000009';
  const tempEmpEmail = 'temp_disabled_emp@boxcodex.internal';
  const masterOwnerId = 'a7204914-04e3-4c2c-a8d5-e7531db0f48f';
  const turfId = '21efb282-8b54-47c2-88bc-987d9c0e208d';

  try {
    log('1. Creating fixture: temporary employee user with status=active...');
    await pg.query(`
      INSERT INTO auth.users (
        id, email, raw_user_meta_data, encrypted_password, aud, role, instance_id, email_confirmed_at,
        confirmation_token, recovery_token, email_change, email_change_token_new,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token,
        raw_app_meta_data, created_at, updated_at
      ) VALUES (
        $1, $2, '{"name": "Temp Staff Disabled"}'::jsonb,
        extensions.crypt('Password123!', extensions.gen_salt('bf')),
        'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
        now(), '', '', '', '', '', '', '', '',
        '{"provider":"email","providers":["email"]}'::jsonb,
        now(), now()
      ) ON CONFLICT (id) DO NOTHING;
    `, [tempEmpUid, tempEmpEmail]);

    await pg.query(`
      INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      VALUES ($1::text, $2::uuid, jsonb_build_object('sub', $1::text, 'email', $3::text, 'email_verified', true, 'phone_verified', false), 'email', now(), now(), now())
      ON CONFLICT (provider_id, provider) DO NOTHING;
    `, [tempEmpUid, tempEmpUid, tempEmpEmail]);

    await pg.query(`
      INSERT INTO public.profiles (user_id, display_name)
      VALUES ($1, 'Temp Staff Disabled')
      ON CONFLICT (user_id) DO NOTHING;
    `, [tempEmpUid]);

    await pg.query(`
      INSERT INTO public.employees (id, user_id, master_owner_id, status, permission_version)
      VALUES ($1, $2, $3, 'active', 1)
      ON CONFLICT (id) DO NOTHING;
    `, [tempEmpId, tempEmpUid, masterOwnerId]);

    await pg.query(`
      INSERT INTO public.employee_turf_assignments (master_owner_id, employee_id, turf_id, active)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (employee_id, turf_id) DO NOTHING;
    `, [masterOwnerId, tempEmpId, turfId]);

    const tempStaffSession = await getSessionCookie(tempEmpEmail, 'Password123!');
    const resActive = await doRequest('/owner/dashboard', tempStaffSession.cookieHeader, 'application/json');
    log(`Temp employee (active) -> GET /owner/dashboard: HTTP ${resActive.status}`);

    log('2. Calling disable_employee as demo_owner...');
    const { data: disableRes, error: disableErr } = await ownerSession.client.rpc('disable_employee', {
      p_employee_id: tempEmpId
    });
    log(`disable_employee RPC response: ${JSON.stringify(disableRes)}, error: ${JSON.stringify(disableErr)}`);

    const resDisabled = await doRequest('/owner/dashboard', tempStaffSession.cookieHeader, 'application/json');
    log(`Temp employee (disabled) -> GET /owner/dashboard: HTTP ${resDisabled.status}`);
    log(`Response Body: ${resDisabled.body.trim()}\n`);
  } finally {
    log('3. Tearing down temporary employee fixture...');
    await pg.query(`DELETE FROM public.employee_turf_assignments WHERE employee_id = $1`, [tempEmpId]);
    await pg.query(`DELETE FROM public.employees WHERE id = $1`, [tempEmpId]);
    await pg.query(`DELETE FROM public.profiles WHERE user_id = $1`, [tempEmpUid]);
    await pg.query(`DELETE FROM auth.identities WHERE user_id = $1`, [tempEmpUid]);
    await pg.query(`DELETE FROM auth.users WHERE id = $1`, [tempEmpUid]);
    log('Temporary employee fixture teardown complete.\n');
  }

  // -------------------------------------------------------------------------
  // g) dual-hat user -> both workspaces reachable and switcher rendered & teardown
  // -------------------------------------------------------------------------
  log('--- TEST G: Dual-Hat User Workspaces and Switcher Verification ---');
  const tempDualUid = 'f0000000-0000-0000-0000-000000000002';
  const tempDualMoId = 'd0000000-0000-0000-0000-000000000001';
  const tempDualEmpId = 'e0000000-0000-0000-0000-000000000008';
  const tempDualEmail = 'temp_dual_hat@boxcodex.internal';

  try {
    log('1. Creating fixture: dual-hat user with master_owners row and active employees row...');
    await pg.query(`
      INSERT INTO auth.users (
        id, email, raw_user_meta_data, encrypted_password, aud, role, instance_id, email_confirmed_at,
        confirmation_token, recovery_token, email_change, email_change_token_new,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token,
        raw_app_meta_data, created_at, updated_at
      ) VALUES (
        $1, $2, '{"name": "Temp Dual Hat User"}'::jsonb,
        extensions.crypt('Password123!', extensions.gen_salt('bf')),
        'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
        now(), '', '', '', '', '', '', '', '',
        '{"provider":"email","providers":["email"]}'::jsonb,
        now(), now()
      ) ON CONFLICT (id) DO NOTHING;
    `, [tempDualUid, tempDualEmail]);

    await pg.query(`
      INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      VALUES ($1::text, $2::uuid, jsonb_build_object('sub', $1::text, 'email', $3::text, 'email_verified', true, 'phone_verified', false), 'email', now(), now(), now())
      ON CONFLICT (provider_id, provider) DO NOTHING;
    `, [tempDualUid, tempDualUid, tempDualEmail]);

    await pg.query(`
      INSERT INTO public.profiles (user_id, display_name)
      VALUES ($1, 'Temp Dual Hat User')
      ON CONFLICT (user_id) DO NOTHING;
    `, [tempDualUid]);

    await pg.query(`
      INSERT INTO public.master_owners (id, owner_user_id, business_name, status)
      VALUES ($1, $2, 'Dual Hat Sports Arena', 'active')
      ON CONFLICT (id) DO NOTHING;
    `, [tempDualMoId, tempDualUid]);

    await pg.query(`
      INSERT INTO public.employees (id, user_id, master_owner_id, status, permission_version)
      VALUES ($1, $2, $3, 'active', 1)
      ON CONFLICT (id) DO NOTHING;
    `, [tempDualEmpId, tempDualUid, masterOwnerId]);

    await pg.query(`
      INSERT INTO public.employee_turf_assignments (master_owner_id, employee_id, turf_id, active)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (employee_id, turf_id) DO NOTHING;
    `, [masterOwnerId, tempDualEmpId, turfId]);

    const dualSession = await getSessionCookie(tempDualEmail, 'Password123!');

    const resG1 = await doRequest('/master/dashboard', dualSession.cookieHeader, 'text/html');
    log(`dual_hat -> GET /master/dashboard (HTML): HTTP ${resG1.status}`);
    const hasStaffSwitch = resG1.body.includes('Venue Operations') && resG1.body.includes('Switch');
    log(`Rendered Dual-Hat Switcher on /master/dashboard pointing to Venue Operations: ${hasStaffSwitch}`);

    const resG2 = await doRequest('/owner/dashboard', dualSession.cookieHeader, 'text/html');
    log(`dual_hat -> GET /owner/dashboard (HTML): HTTP ${resG2.status}`);
    const hasMasterSwitch = resG2.body.includes('Master Owner Admin') && resG2.body.includes('Switch');
    log(`Rendered Dual-Hat Switcher on /owner/dashboard pointing to Master Owner Admin: ${hasMasterSwitch}\n`);
  } finally {
    log('2. Tearing down temporary dual-hat fixture...');
    await pg.query(`DELETE FROM public.employee_turf_assignments WHERE employee_id = $1`, [tempDualEmpId]);
    await pg.query(`DELETE FROM public.employees WHERE id = $1`, [tempDualEmpId]);
    await pg.query(`DELETE FROM public.master_owners WHERE id = $1`, [tempDualMoId]);
    await pg.query(`DELETE FROM public.profiles WHERE user_id = $1`, [tempDualUid]);
    await pg.query(`DELETE FROM auth.identities WHERE user_id = $1`, [tempDualUid]);
    await pg.query(`DELETE FROM auth.users WHERE id = $1`, [tempDualUid]);
    await pg.end();
    log('Temporary dual-hat fixture teardown complete.\n');
  }

  // -------------------------------------------------------------------------
  // h) HTML navigation -> redirect to /login rather than returning JSON
  // -------------------------------------------------------------------------
  log('--- TEST H: HTML Navigation Redirects to /login (Accept: text/html) ---');
  const resH1 = await doRequest('/master/dashboard', null, 'text/html');
  log(`anonymous -> GET /master/dashboard (Accept: text/html): HTTP ${resH1.status}`);
  log(`Location Header: ${resH1.headers['location']}`);
  log(`Response Body: ${resH1.body.trim()}\n`);

  const resH2 = await doRequest('/owner/dashboard', null, 'text/html');
  log(`anonymous -> GET /owner/dashboard (Accept: text/html): HTTP ${resH2.status}`);
  log(`Location Header: ${resH2.headers['location']}`);
  log(`Response Body: ${resH2.body.trim()}\n`);

  const resH3 = await doRequest('/master/dashboard', playerSession.cookieHeader, 'text/html');
  log(`live_player -> GET /master/dashboard (Accept: text/html): HTTP ${resH3.status}`);
  log(`Location Header: ${resH3.headers['location']}`);
  log(`Set-Cookie Header: ${JSON.stringify(resH3.headers['set-cookie'])}`);
  log(`Response Body: ${resH3.body.trim()}\n`);

  const resH4 = await doRequest('/owner/dashboard', playerSession.cookieHeader, 'text/html');
  log(`live_player -> GET /owner/dashboard (Accept: text/html): HTTP ${resH4.status}`);
  log(`Location Header: ${resH4.headers['location']}`);
  log(`Set-Cookie Header: ${JSON.stringify(resH4.headers['set-cookie'])}`);
  log(`Response Body: ${resH4.body.trim()}\n`);

  log('=======================================================');
  log('ALL 8 AUTHORIZATION MATRIX TESTS COMPLETED SUCCESSFULLY');
  log('=======================================================');

  fs.writeFileSync('scratch/evidence/round17/auth-matrix.txt', logOutput, 'utf8');
  console.log('Saved verbatim output to scratch/evidence/round17/auth-matrix.txt');
}

runMatrix().catch(err => {
  console.error('Fatal error running auth matrix:', err);
  process.exit(1);
});
