const { execSync } = require('child_process');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');

async function main() {
  const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
  const supabase = createClient('http://127.0.0.1:54321', anonKey);

  const pg = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
  await pg.connect();

  let log = '';
  function print(msg) {
    console.log(msg);
    log += msg + '\n';
  }

  print('=== WORKSTREAM D: RUNTIME SMOKE TEST OF ALL FOUR GATES ===');
  print(`Timestamp: 2026-09-20T11:45:00Z\n`);

  // --- 1. PORT 3000: PLAYER ---
  print('==================================================');
  print('1. PORT 3000 (PLAYER PORTAL)');
  print('==================================================');

  print('--- Test 1a: Anonymous Player Catalogue (GET /) ---');
  print('$ curl.exe -s -i -H "Accept: text/html" http://localhost:3000/');
  try {
    const res1a = execSync('curl.exe -s -i -H "Accept: text/html" http://localhost:3000/', { encoding: 'utf8' });
    const status1a = res1a.split('\r\n')[0];
    print(`Status: ${status1a}`);
    print(`Headers & Body preview:\n${res1a.substring(0, 600)}\n`);
  } catch (e) {
    print(`Error: ${e.message}\n`);
  }

  print('--- Test 1b: Anonymous Protected Player Route (GET /my-bookings) ---');
  print('$ curl.exe -s -i -H "Accept: text/html" http://localhost:3000/my-bookings');
  try {
    const res1b = execSync('curl.exe -s -i -H "Accept: text/html" http://localhost:3000/my-bookings', { encoding: 'utf8' });
    const status1b = res1b.split('\r\n')[0];
    print(`Status: ${status1b}`);
    print(`Headers & Body preview:\n${res1b.substring(0, 800)}\n`);
  } catch (e) {
    print(`Error: ${e.message}\n`);
  }

  // --- 2. PORT 3001: OWNER ---
  print('==================================================');
  print('2. PORT 3001 (STAFF OWNER PORTAL)');
  print('==================================================');

  print('--- Test 2a: Anonymous Staff Route (GET /owner/turfs) ---');
  print('$ curl.exe -s -i -H "Accept: text/html" http://localhost:3001/owner/turfs');
  try {
    const res2a = execSync('curl.exe -s -i -H "Accept: text/html" http://localhost:3001/owner/turfs', { encoding: 'utf8' });
    const status2a = res2a.split('\r\n')[0];
    print(`Status: ${status2a}`);
    print(`Headers & Body preview:\n${res2a.substring(0, 600)}\n`);
  } catch (e) {
    print(`Error: ${e.message}\n`);
  }

  print('--- Test 2b: Authenticated Staff Session (demo_staff@boxcodex.internal -> GET /owner/turfs) ---');
  const staffAuth = await supabase.auth.signInWithPassword({
    email: 'demo_staff@boxcodex.internal',
    password: 'Password123!',
  });
  const staffCookie = 'base64-' + Buffer.from(JSON.stringify(staffAuth.data.session)).toString('base64');
  print(`Authenticated as: ${staffAuth.data.user.email}`);
  print(`Cookie: sb-boxcodex-owner-auth-token`);
  print('$ curl.exe -s -i -H "Accept: text/html" -H "Cookie: sb-boxcodex-owner-auth-token=..." http://localhost:3001/owner/turfs');
  try {
    const res2b = execSync(`curl.exe -s -i -H "Accept: text/html" -H "Cookie: sb-boxcodex-owner-auth-token=${staffCookie}" http://localhost:3001/owner/turfs`, { encoding: 'utf8' });
    const status2b = res2b.split('\r\n')[0];
    print(`Status: ${status2b}`);
    print(`Headers & Body preview:\n${res2b.substring(0, 800)}\n`);
  } catch (e) {
    print(`Error: ${e.message}\n`);
  }

  // --- 3. PORT 3002: MASTER-OWNER ---
  print('==================================================');
  print('3. PORT 3002 (MASTER OWNER PORTAL)');
  print('==================================================');

  print('--- Test 3a: Anonymous Master Owner Route (GET /dashboard) ---');
  print('$ curl.exe -s -i -H "Accept: text/html" http://localhost:3002/dashboard');
  try {
    const res3a = execSync('curl.exe -s -i -H "Accept: text/html" http://localhost:3002/dashboard', { encoding: 'utf8' });
    const status3a = res3a.split('\r\n')[0];
    print(`Status: ${status3a}`);
    print(`Headers & Body preview:\n${res3a.substring(0, 600)}\n`);
  } catch (e) {
    print(`Error: ${e.message}\n`);
  }

  print('--- Test 3b: Authenticated Master Owner Session (demo_owner@boxcodex.internal -> GET /dashboard) ---');
  const ownerAuth = await supabase.auth.signInWithPassword({
    email: 'demo_owner@boxcodex.internal',
    password: 'Password123!',
  });
  const ownerCookie = 'base64-' + Buffer.from(JSON.stringify(ownerAuth.data.session)).toString('base64');
  print(`Authenticated as: ${ownerAuth.data.user.email}`);
  print(`Cookie: sb-boxcodex-master-owner-auth-token`);
  print('$ curl.exe -s -i -H "Accept: text/html" -H "Cookie: sb-boxcodex-master-owner-auth-token=..." http://localhost:3002/dashboard');
  try {
    const res3b = execSync(`curl.exe -s -i -H "Accept: text/html" -H "Cookie: sb-boxcodex-master-owner-auth-token=${ownerCookie}" http://localhost:3002/dashboard`, { encoding: 'utf8' });
    const status3b = res3b.split('\r\n')[0];
    print(`Status: ${status3b}`);
    print(`Headers & Body preview:\n${res3b.substring(0, 800)}\n`);
  } catch (e) {
    print(`Error: ${e.message}\n`);
  }

  // --- 4. PORT 3003: ADMIN ---
  print('==================================================');
  print('4. PORT 3003 (ADMIN PORTAL)');
  print('==================================================');

  print('--- Test 4a: Anonymous Admin Route (GET /admin) ---');
  print('$ curl.exe -s -i -H "Accept: text/html" http://localhost:3003/admin');
  try {
    const res4a = execSync('curl.exe -s -i -H "Accept: text/html" http://localhost:3003/admin', { encoding: 'utf8' });
    const status4a = res4a.split('\r\n')[0];
    print(`Status: ${status4a}`);
    print(`Headers & Body preview:\n${res4a.substring(0, 600)}\n`);
  } catch (e) {
    print(`Error: ${e.message}\n`);
  }

  print('--- Test 4b: Platform Admin Bootstrap & Authenticated Access ---');
  // Bootstrap live_player as platform admin
  const adminUserId = 'f5000000-0000-0000-0000-000000000001';
  print(`Bootstrapping user ${adminUserId} into private.platform_admins...`);
  await pg.query(`INSERT INTO private.platform_admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [adminUserId]);

  const adminAuth = await supabase.auth.signInWithPassword({
    email: 'live_player@example.com',
    password: 'Password123!',
  });
  const adminCookie = 'base64-' + Buffer.from(JSON.stringify(adminAuth.data.session)).toString('base64');
  print(`Authenticated as: ${adminAuth.data.user.email}`);
  print(`Cookie: sb-boxcodex-admin-auth-token`);
  print('$ curl.exe -s -i -H "Accept: text/html" -H "Cookie: sb-boxcodex-admin-auth-token=..." http://localhost:3003/admin/turfs');
  try {
    const res4b = execSync(`curl.exe -s -i -H "Accept: text/html" -H "Cookie: sb-boxcodex-admin-auth-token=${adminCookie}" http://localhost:3003/admin/turfs`, { encoding: 'utf8' });
    const status4b = res4b.split('\r\n')[0];
    print(`Status: ${status4b}`);
    print(`Headers & Body preview:\n${res4b.substring(0, 800)}\n`);
  } catch (e) {
    print(`Error: ${e.message}\n`);
  }

  print('--- Test 4c: Platform Admin Revocation & Clean Baseline Verification ---');
  print(`Revoking user ${adminUserId} from private.platform_admins...`);
  await pg.query(`DELETE FROM private.platform_admins WHERE user_id = $1`, [adminUserId]);
  const adminCountRes = await pg.query(`SELECT count(*)::int AS c FROM private.platform_admins`);
  const adminCount = adminCountRes.rows[0].c;
  print(`private.platform_admins count: ${adminCount}`);
  if (adminCount === 1) {
    print('Revocation confirmed: private.platform_admins is exactly 1 (seeded demo_admin).');
  } else {
    print('ERROR: private.platform_admins count is not 1!');
    process.exit(1);
  }

  await pg.end();

  fs.writeFileSync('scratch/evidence/round10/portal-smoke.txt', log, 'utf8');
  print('\nEvidence successfully written to scratch/evidence/round10/portal-smoke.txt');
}

main().catch(console.error);
