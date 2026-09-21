// scripts/verify_hosted_state.mjs
// Read-only verification script for hosted Supabase database state.
// Uses `pg` from node_modules, reads SUPABASE_STAGING_DB_URL from supabase/.env.hosted,
// enforces 15s hard timeout, and prints ONLY counts, names, and structural metadata.

import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const TIMEOUT_MS = 15000;

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (const arg of args) {
    if (arg.startsWith('--db-url=')) {
      options.dbUrl = arg.split('=')[1];
    }
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
    console.error('ERROR: verify_hosted_state script timed out after 15s');
    process.exit(1);
  }, TIMEOUT_MS);

  const options = parseArgs();
  const hostedEnv = loadEnvFile('supabase/.env.hosted');

  const dbUrl = options.dbUrl || process.env.SUPABASE_STAGING_DB_URL || hostedEnv.SUPABASE_STAGING_DB_URL;

  if (!dbUrl) {
    console.error('FATAL: SUPABASE_STAGING_DB_URL not found in arguments, env, or supabase/.env.hosted');
    process.exit(1);
  }

  let displayHost = 'unknown';
  try {
    const parsed = new URL(dbUrl);
    displayHost = `${parsed.username ? parsed.username.split('.')[0] : ''}@${parsed.host}${parsed.pathname}`;
  } catch {
    displayHost = 'custom_connection_string';
  }

  console.log('=== VERIFY HOSTED STATE ===');
  console.log(`Target: ${displayHost}`);

  const client = new Client({
    connectionString: dbUrl,
    connectionTimeoutMillis: 10000,
    ssl: (dbUrl.includes('supabase.com') || dbUrl.includes('supabase.co')) ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();
    console.log('Connected to database successfully.\n');

    // Query 1: schema migrations
    console.log('--- 1. supabase_migrations.schema_migrations ---');
    const q1 = await client.query('select count(*) as count, max(version) as max_version from supabase_migrations.schema_migrations;');
    console.log(`count: ${q1.rows[0].count}, max_version: ${q1.rows[0].max_version}`);

    // Query 2: auth.users count
    console.log('\n--- 2. auth.users ---');
    const q2 = await client.query('select count(*) as count from auth.users;');
    console.log(`count: ${q2.rows[0].count}`);

    // Query 3: private.platform_admins count
    console.log('\n--- 3. private.platform_admins ---');
    const q3 = await client.query('select count(*) as count from private.platform_admins;');
    console.log(`count: ${q3.rows[0].count}`);

    // Query 4: private.app_config key and length(value)
    console.log('\n--- 4. private.app_config ---');
    const q4 = await client.query('select key, length(value) as val_len from private.app_config order by key;');
    console.log(`row count: ${q4.rowCount}`);
    for (const r of q4.rows) {
      console.log(`key: ${r.key}, length(value): ${r.val_len}`);
    }

    // Query 5: pg_extension
    console.log('\n--- 5. pg_extension (pgcrypto, postgis, pg_net, pg_cron) ---');
    const q5 = await client.query("select extname, extversion from pg_extension where extname in ('pgcrypto','postgis','pg_net','pg_cron') order by extname;");
    for (const r of q5.rows) {
      console.log(`extension: ${r.extname}, version: ${r.extversion}`);
    }

    // Query 6: cron.job
    console.log('\n--- 6. cron.job ---');
    const q6 = await client.query('select jobname, schedule, active from cron.job order by jobname;');
    console.log(`job count: ${q6.rowCount}`);
    for (const r of q6.rows) {
      console.log(`jobname: ${r.jobname}, schedule: ${r.schedule}, active: ${r.active}`);
    }

    // Query 7: counts of public.turfs, public.bookings, private.payment_orders
    console.log('\n--- 7. public.turfs / public.bookings / private.payment_orders ---');
    const q7 = await client.query(`
      select 
        (select count(*) from public.turfs) as turfs_count,
        (select count(*) from public.bookings) as bookings_count,
        (select count(*) from private.payment_orders) as payment_orders_count;
    `);
    console.log(`turfs_count: ${q7.rows[0].turfs_count}`);
    console.log(`bookings_count: ${q7.rows[0].bookings_count}`);
    console.log(`payment_orders_count: ${q7.rows[0].payment_orders_count}`);

    // Query 8: triggers
    console.log('\n--- 8. pg_trigger (immutability triggers) ---');
    const q8 = await client.query('select tgname, tgenabled from pg_trigger where not tgisinternal order by tgname;');
    console.log(`trigger count: ${q8.rowCount}`);
    for (const r of q8.rows) {
      console.log(`trigger: ${r.tgname}, enabled: ${r.tgenabled}`);
    }

    console.log('\n=== VERIFICATION COMPLETE: ALL QUERIES SUCCEEDED ===');
  } catch (err) {
    console.error('ERROR during verify_hosted_state:', err.message);
    throw err;
  } finally {
    clearTimeout(timeoutId);
    try {
      await client.end();
    } catch {
      // ignore close errors
    }
  }
}

main().catch(err => {
  console.error('FAILED: verify_hosted_state execution failed');
  process.exit(1);
});
