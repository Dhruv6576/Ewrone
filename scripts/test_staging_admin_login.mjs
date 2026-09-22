import fs from 'node:fs';
import path from 'node:path';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    url: null,
    file: process.env.ADMIN_TEST_FILE || 'supabase/.admin-test.local',
    hostedEnv: 'supabase/.env.hosted'
  };

  for (const arg of args) {
    if (arg.startsWith('--url=')) {
      options.url = arg.split('=')[1].trim();
    } else if (arg.startsWith('--file=')) {
      options.file = arg.split('=')[1].trim();
    }
  }
  return options;
}

async function main() {
  console.log('=== STAGING ADMIN LOGIN VERIFICATION ===\n');
  const options = parseArgs();

  // 1. Check admin test file
  if (!fs.existsSync(options.file)) {
    console.log(`NOT RUN - could not resolve admin test file ('${options.file}')`);
    console.log(`Please create ${options.file} with the following two lines:`);
    console.log('ADMIN_EMAIL=<staging_admin_email>');
    console.log('ADMIN_PASSWORD=<staging_admin_password>');
    console.log('\nSTAGING ADMIN LOGIN: NOT RUN');
    process.exit(0);
  }

  const raw = fs.readFileSync(options.file, 'utf8').trim();
  if (raw.length === 0) {
    console.log('NOT RUN - could not resolve credentials (file empty)');
    console.log(`Please populate ${options.file} with the following two lines:`);
    console.log('ADMIN_EMAIL=<staging_admin_email>');
    console.log('ADMIN_PASSWORD=<staging_admin_password>');
    console.log('\nSTAGING ADMIN LOGIN: NOT RUN');
    process.exit(0);
  }

  const emailMatch = raw.match(/^ADMIN_EMAIL=(.*)$/m);
  const passMatch = raw.match(/^ADMIN_PASSWORD=(.*)$/m);

  if (!emailMatch) {
    console.log('NOT RUN - could not resolve ADMIN_EMAIL');
    console.log('\nSTAGING ADMIN LOGIN: NOT RUN');
    process.exit(0);
  }

  if (!passMatch) {
    console.log('NOT RUN - could not resolve ADMIN_PASSWORD');
    console.log('\nSTAGING ADMIN LOGIN: NOT RUN');
    process.exit(0);
  }

  const email = emailMatch[1].trim().replace(/^['"]|['"]$/g, '');
  const password = passMatch[1].trim().replace(/^['"]|['"]$/g, '');

  if (!email) {
    console.log('NOT RUN - could not resolve ADMIN_EMAIL (blank value)');
    console.log('\nSTAGING ADMIN LOGIN: NOT RUN');
    process.exit(0);
  }

  if (!password) {
    console.log('NOT RUN - could not resolve ADMIN_PASSWORD (blank value)');
    console.log('\nSTAGING ADMIN LOGIN: NOT RUN');
    process.exit(0);
  }

  // 2. Resolve hosted Supabase URL and Anon Key
  let supabaseUrl = options.url;
  let anonKey = null;

  if (fs.existsSync(options.hostedEnv)) {
    const hostedRaw = fs.readFileSync(options.hostedEnv, 'utf8');

    if (!supabaseUrl) {
      const refMatch = hostedRaw.match(/^SUPABASE_STAGING_PROJECT_REF=(.*)$/m);
      if (refMatch && refMatch[1].trim()) {
        const ref = refMatch[1].trim().replace(/^['"]|['"]$/g, '');
        supabaseUrl = `https://${ref}.supabase.co`;
      } else {
        const fallbackUrlMatch = hostedRaw.match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m);
        if (fallbackUrlMatch && fallbackUrlMatch[1].trim()) {
          supabaseUrl = fallbackUrlMatch[1].trim().replace(/^['"]|['"]$/g, '');
        }
      }
    }

    const anonMatch = hostedRaw.match(/^SUPABASE_STAGING_ANON_KEY=(.*)$/m) ||
                      hostedRaw.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m);
    if (anonMatch && anonMatch[1].trim()) {
      anonKey = anonMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }

  // Fail-closed guards: exit 0 with clear message instead of throwing TypeError
  if (!supabaseUrl) {
    console.log('NOT RUN - could not resolve base URL');
    console.log('\nSTAGING ADMIN LOGIN: NOT RUN');
    process.exit(0);
  }

  if (!anonKey) {
    console.log('NOT RUN - could not resolve anon key');
    console.log('\nSTAGING ADMIN LOGIN: NOT RUN');
    process.exit(0);
  }

  await runLogin(supabaseUrl, anonKey, email, password);
}

async function runLogin(supabaseUrl, anonKey, email, password) {
  try {
    const loginRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(15000)
    });

    const loginData = await loginRes.json().catch(() => ({}));
    const tokenLen = loginData.access_token ? loginData.access_token.length : 0;

    console.log(`Password-grant login:`);
    console.log(`  HTTP status: ${loginRes.status}`);
    if (loginData.error_code || loginData.error || loginData.msg) {
      console.log(`  Error code: ${loginData.error_code || loginData.error || loginData.msg}`);
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
      },
      signal: AbortSignal.timeout(15000)
    });

    const isAdmin = await adminRes.json().catch(() => null);
    console.log(`RPC is_platform_admin:`);
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
