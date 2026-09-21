#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const TIMEOUT_MS = 15000;

async function main() {
  const timeout = setTimeout(() => {
    console.error('FATAL: test_seed_guard.mjs timed out after 15 seconds.');
    process.exit(1);
  }, TIMEOUT_MS);

  const client = new pg.Client({ connectionString: DB_URL });

  try {
    await client.connect();

    console.log('=== PART (c): CURRENT DB & LISTEN_ADDRESSES ===');
    const envRes = await client.query("select current_database(), current_setting('listen_addresses', true) as listen_addresses;");
    console.log('current_database:', envRes.rows[0].current_database);
    console.log('listen_addresses:', envRes.rows[0].listen_addresses);
    console.log("Reason old guard failed: Both local and hosted Supabase instances use current_database='postgres' and bind to all network interfaces (listen_addresses='*'), satisfying the condition on hosted.\n");

    console.log('=== PART (a): APPLY SEED.LOCAL.SQL WITH NO OPT-IN ===');
    const countBefore = (await client.query('select count(*) from auth.users;')).rows[0].count;
    console.log('auth.users before attempt:', countBefore);

    const seedPath = path.resolve('supabase/seed.local.sql');
    const seedSql = fs.readFileSync(seedPath, 'utf8');

    let rejected = false;
    try {
      await client.query(seedSql);
    } catch (err) {
      rejected = true;
      console.log('Observed Error Message:', err.message);
      console.log('Observed Error Code:', err.code);
    }
    const countAfter = (await client.query('select count(*) from auth.users;')).rows[0].count;
    console.log('auth.users after attempt:', countAfter);
    console.log('Rejection confirmed:', rejected);
    console.log('Count unchanged:', countBefore === countAfter);

    console.log('\n=== PART (b): APPLY WITH SESSION OPT-IN (set app.allow_demo_seed = \'on\') ===');
    let allowed = false;
    try {
      await client.query("set app.allow_demo_seed = 'on';\n" + seedSql);
      allowed = true;
      console.log('Execution succeeded with opt-in: true');
    } catch (err) {
      console.log('Unexpected error with opt-in:', err.message);
    }
    const countFinal = (await client.query('select count(*) from auth.users;')).rows[0].count;
    console.log('auth.users count after opt-in seed:', countFinal);
    console.log('Success confirmed:', allowed);

  } catch (err) {
    console.error('Test execution failed:', err);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    await client.end();
  }
}

main();
