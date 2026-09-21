import fs from 'node:fs';
import path from 'node:path';

const ADMIN_TEST_FILE = 'supabase/.admin-test.local';
const HOSTED_ENV_FILE = 'supabase/.env.hosted';

function main() {
  console.log('=== PART 6 — STAGING ADMIN LOGIN VERIFICATION ===\n');

  if (!fs.existsSync(ADMIN_TEST_FILE)) {
    console.log('NOT RUN - file missing');
    console.log(`Please create ${ADMIN_TEST_FILE} with the following two lines:`);
    console.log('ADMIN_EMAIL=<staging_admin_email>');
    console.log('ADMIN_PASSWORD=<staging_admin_password>');
    console.log('\nSTAGING ADMIN LOGIN: NOT RUN');
    process.exit(0);
  }

  const raw = fs.readFileSync(ADMIN_TEST_FILE, 'utf8').trim();
  if (raw.length === 0) {
    console.log('NOT RUN - file empty (credentials missing)');
    console.log(`Please populate ${ADMIN_TEST_FILE} with the following two lines:`);
    console.log('ADMIN_EMAIL=<staging_admin_email>');
    console.log('ADMIN_PASSWORD=<staging_admin_password>');
    console.log('\nSTAGING ADMIN LOGIN: NOT RUN');
    process.exit(0);
  }

  const emailMatch = raw.match(/^ADMIN_EMAIL=(.*)$/m);
  const passMatch = raw.match(/^ADMIN_PASSWORD=(.*)$/m);

  if (!emailMatch || !passMatch) {
    console.log('NOT RUN - invalid format in file');
    console.log(`Please ensure ${ADMIN_TEST_FILE} contains:`);
    console.log('ADMIN_EMAIL=<staging_admin_email>');
    console.log('ADMIN_PASSWORD=<staging_admin_password>');
    console.log('\nSTAGING ADMIN LOGIN: NOT RUN');
    process.exit(0);
  }

  const email = emailMatch[1].trim().replace(/^['"]|['"]$/g, '');
  const password = passMatch[1].trim().replace(/^['"]|['"]$/g, '');

  if (!email || !password) {
    console.log('NOT RUN - credentials blank');
    console.log(`Please populate ${ADMIN_TEST_FILE} with:`);
    console.log('ADMIN_EMAIL=<staging_admin_email>');
    console.log('ADMIN_PASSWORD=<staging_admin_password>');
    console.log('\nSTAGING ADMIN LOGIN: NOT RUN');
    process.exit(0);
  }

  const hostedRaw = fs.readFileSync(HOSTED_ENV_FILE, 'utf8');
  const urlMatch = hostedRaw.match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m);
  const anonMatch = hostedRaw.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m);

  const supabaseUrl = urlMatch[1].trim().replace(/^['"]|['"]$/g, '');
  const anonKey = anonMatch[1].trim().replace(/^['"]|['"]$/g, '');

  runLogin(supabaseUrl, anonKey, email, password);
}

async function runLogin(supabaseUrl, anonKey, email, password) {
  try {
    const loginRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const loginData = await loginRes.json().catch(() => ({}));
    const tokenLen = loginData.access_token ? loginData.access_token.length : 0;

    console.log(`6.2 Password-grant login:`);
    console.log(`  HTTP status: ${loginRes.status}`);
    if (loginData.error_code || loginData.error) {
      console.log(`  Error code: ${loginData.error_code || loginData.error}`);
    }
    console.log(`  access_token length > 0: ${tokenLen > 0}`);

    if (loginRes.status !== 200 || !tokenLen) {
      console.log('\nSTAGING ADMIN LOGIN: FAIL');
      return;
    }

    const adminRes = await fetch(`${supabaseUrl}/rest/v1/rpc/is_platform_admin`, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${loginData.access_token}`,
        'Content-Type': 'application/json'
      }
    });

    const isAdmin = await adminRes.json();
    console.log(`6.3 RPC is_platform_admin:`);
    console.log(`  HTTP status: ${adminRes.status}`);
    console.log(`  Raw boolean result: ${isAdmin}`);

    if (adminRes.status === 200 && isAdmin === true) {
      console.log('\nSTAGING ADMIN LOGIN: PASS');
    } else {
      console.log('\nSTAGING ADMIN LOGIN: FAIL');
    }
  } catch (err) {
    console.error(`Login check error: ${err.message}`);
    console.log('\nSTAGING ADMIN LOGIN: FAIL');
  }
}

main();
