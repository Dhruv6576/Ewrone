#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const TIMEOUT_MS = 15000;

async function main() {
  const timeout = setTimeout(() => {
    console.error('FATAL: seed_local.mjs timed out after 15 seconds.');
    process.exit(1);
  }, TIMEOUT_MS);

  const client = new pg.Client({ connectionString: DB_URL });

  try {
    await client.connect();
    const seedPath = path.resolve('supabase/seed.local.sql');
    if (!fs.existsSync(seedPath)) {
      throw new Error(`Seed file not found at ${seedPath}`);
    }

    const sql = fs.readFileSync(seedPath, 'utf8');
    // Prepend explicit fail-closed session opt-in
    await client.query("set app.allow_demo_seed = 'on';\n" + sql);
    console.log('SUCCESS: Local demo seed applied successfully with session opt-in.');
  } catch (err) {
    console.error('Local seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    await client.end();
  }
}

main();
