// scripts/seed_staging.mjs
// Safely seeds the hosted staging environment (akbndqzrnqxyckldboaw) with team onboarding fixtures.

import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Client } = pg;
const TIMEOUT_MS = 15000;

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (const arg of args) {
    if (arg.startsWith('--db-url=')) options.dbUrl = arg.split('=')[1];
  }
  return options;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      env[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim();
    }
  }
  return env;
}

async function main() {
  const timeoutId = setTimeout(() => {
    console.error('FATAL: seed_staging.mjs timed out after 15s');
    process.exit(1);
  }, TIMEOUT_MS);

  const options = parseArgs();
  const hostedEnv = loadEnvFile('supabase/.env.hosted');

  // Resolve DB connection URL
  let dbUrl = options.dbUrl || process.env.DATABASE_URL || hostedEnv.SUPABASE_STAGING_DB_URL;
  if (!dbUrl) {
    console.error('FATAL REFUSAL: No database URL could be resolved from --db-url, DATABASE_URL, or supabase/.env.hosted.');
    process.exit(1);
  }

  // Parse hostname
  let resolvedHost = '';
  let parsed;
  try {
    parsed = new URL(dbUrl);
    resolvedHost = parsed.hostname;
  } catch (err) {
    console.error(`FATAL REFUSAL: Invalid database URL format: ${err.message}`);
    process.exit(1);
  }

  // --------------------------------------------------------------------------
  // CRITICAL REFUSAL GUARD: Target MUST be akbndqzrnqxyckldboaw and non-local
  // --------------------------------------------------------------------------
  const localHosts = ['127.0.0.1', 'localhost', '::1', '0.0.0.0', 'kong'];
  if (localHosts.includes(resolvedHost)) {
    console.error(`FATAL REFUSAL: Target resolved to local host '${resolvedHost}'. Refusing to seed local database with staging seed script.`);
    process.exit(1);
  }

  const STAGING_REF = 'akbndqzrnqxyckldboaw';
  const targetMatchesStaging = resolvedHost.includes(STAGING_REF) || (parsed.username && parsed.username.includes(STAGING_REF));
  if (!targetMatchesStaging) {
    console.error(`FATAL REFUSAL: Connection target '${resolvedHost}' does not reference required staging project '${STAGING_REF}'. Refusing execution.`);
    process.exit(1);
  }

  // Refuse if production ref matches
  const prodRef = process.env.SUPABASE_PROD_PROJECT_REF;
  if (prodRef && resolvedHost.includes(prodRef)) {
    console.error(`FATAL REFUSAL: Target host '${resolvedHost}' matches production reference '${prodRef}'. Production database write strictly prohibited!`);
    process.exit(1);
  }

  const seedFile = 'supabase/seed.staging.sql';
  if (!fs.existsSync(seedFile)) {
    console.error(`FATAL: Seed file not found at ${seedFile}`);
    process.exit(1);
  }
  const seedSql = fs.readFileSync(seedFile, 'utf8');

  console.log(`Target: hosted staging (${STAGING_REF})`);
  console.log(`Resolved database host: ${resolvedHost}`);
  console.log('Connecting to hosted database...');

  const client = new Client({
    connectionString: dbUrl,
    connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to database. Executing supabase/seed.staging.sql...');

    await client.query(seedSql);
    console.log('SUCCESS: supabase/seed.staging.sql applied successfully.');

    // Report table counts
    console.log('\n--- HOSTED STAGING FIXTURE COUNTS ---');
    const counts = [
      { label: 'auth.users', query: 'SELECT count(*)::int as count FROM auth.users' },
      { label: 'public.profiles', query: 'SELECT count(*)::int as count FROM public.profiles' },
      { label: 'public.master_owners', query: 'SELECT count(*)::int as count FROM public.master_owners' },
      { label: 'public.turfs', query: "SELECT count(*)::int as count FROM public.turfs WHERE approval_status = 'approved'" },
      { label: 'public.resources', query: 'SELECT count(*)::int as count FROM public.resources' },
      { label: 'public.operating_hours', query: 'SELECT count(*)::int as count FROM public.operating_hours' },
      { label: 'public.pricing_rules', query: 'SELECT count(*)::int as count FROM public.pricing_rules' },
      { label: 'public.slots', query: 'SELECT count(*)::int as count FROM public.slots' },
      { label: 'public.bookings', query: 'SELECT count(*)::int as count FROM public.bookings' },
      { label: 'public.inventory_allocations', query: 'SELECT count(*)::int as count FROM public.inventory_allocations' },
      { label: 'public.employees', query: 'SELECT count(*)::int as count FROM public.employees' },
      { label: 'private.platform_admins', query: 'SELECT count(*)::int as count FROM private.platform_admins' }
    ];

    for (const c of counts) {
      const res = await client.query(c.query);
      console.log(`  ${c.label}: ${res.rows[0].count}`);
    }
  } catch (err) {
    console.error('ERROR during staging seed execution:', err.message);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeoutId);
    await client.end();
  }
}

main();
