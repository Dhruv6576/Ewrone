// scripts/set_worker_config.mjs
// Safely populates private.app_config with worker URL and secret across local and hosted Supabase environments.

import fs from 'fs';
import { Client } from 'pg';

const TIMEOUT_MS = 15000;

function maskSecret(val) {
  if (!val) return 'none';
  if (val.length <= 12) return `[len ${val.length}]`;
  return `[len ${val.length}, ${val.substring(0, 8)}...${val.substring(val.length - 4)}]`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (const arg of args) {
    if (arg.startsWith('--target=')) options.target = arg.split('=')[1];
    else if (arg.startsWith('--db-url=')) options.dbUrl = arg.split('=')[1];
    else if (arg.startsWith('--project-ref=')) options.projectRef = arg.split('=')[1];
    else if (arg.startsWith('--db-password=')) options.dbPassword = arg.split('=')[1];
    else if (arg.startsWith('--url=')) options.workerUrl = arg.split('=')[1];
    else if (arg.startsWith('--secret=')) options.workerSecret = arg.split('=')[1];
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
    console.error('ERROR: set_worker_config script timed out after 15s');
    process.exit(1);
  }, TIMEOUT_MS);

  const options = parseArgs();
  const funcEnv = loadEnvFile('supabase/functions/.env');
  const hostedEnv = loadEnvFile('supabase/.env.hosted');

  // Determine target: hosted or local. Default to local if not specified.
  let target = (options.target || process.env.TARGET || '').toLowerCase();
  if (!target) {
    target = 'local';
  }
  if (target !== 'hosted' && target !== 'local') {
    console.error(`ERROR: Invalid --target '${target}'. Must be either 'hosted' or 'local'.`);
    process.exit(1);
  }

  // Resolve ref from arguments, env, or hostedEnv
  const ref = options.projectRef ||
    process.env.SUPABASE_STAGING_PROJECT_REF ||
    process.env.PROJECT_REF ||
    hostedEnv.SUPABASE_STAGING_PROJECT_REF ||
    hostedEnv.PROJECT_REF;

  const pwd = options.dbPassword ||
    process.env.SUPABASE_DB_PASSWORD ||
    hostedEnv.SUPABASE_DB_PASSWORD;

  // Resolve DB connection URL
  let dbUrl = options.dbUrl || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

  if (target === 'hosted') {
    if (!dbUrl && (process.env.SUPABASE_STAGING_DB_URL || hostedEnv.SUPABASE_STAGING_DB_URL)) {
      dbUrl = process.env.SUPABASE_STAGING_DB_URL || hostedEnv.SUPABASE_STAGING_DB_URL;
    }
    if (!dbUrl && ref && pwd) {
      dbUrl = `postgresql://postgres.${ref}:${encodeURIComponent(pwd)}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`;
    }
    if (!dbUrl) {
      console.error('FATAL: Target is hosted but no database URL or project-ref/db-password could be resolved.');
      process.exit(1);
    }
  } else {
    // target === 'local'
    if (!dbUrl) {
      dbUrl = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    }
  }

  // Sanitize connection display and extract host
  let displayHost = 'unknown';
  let resolvedHost = 'unknown';
  try {
    const parsed = new URL(dbUrl);
    resolvedHost = parsed.hostname;
    displayHost = `${parsed.username ? parsed.username.split('.')[0] : ''}@${parsed.host}${parsed.pathname}`;
  } catch {
    displayHost = 'custom_connection_string';
  }

  // REFUSAL GUARD: When target=hosted, REFUSE to proceed if the resolved host is 127.0.0.1/localhost/kong
  const localHosts = ['127.0.0.1', 'localhost', 'kong', '::1', '0.0.0.0'];
  if (target === 'hosted' && (localHosts.includes(resolvedHost) || !resolvedHost || resolvedHost === 'unknown')) {
    console.error(`FATAL REFUSAL: Target is 'hosted' but resolved host is '${resolvedHost}'. Refusing to execute against local/invalid endpoint.`);
    process.exit(1);
  }

  // Resolve Worker URL
  let workerUrl = options.workerUrl || process.env.NOTIFICATION_WORKER_URL || process.env.WORKER_URL;
  if (!workerUrl) {
    if (ref && target === 'hosted') {
      workerUrl = `https://${ref}.supabase.co/functions/v1/notification-worker`;
    } else {
      workerUrl = 'http://kong:8000/functions/v1/notification-worker';
    }
  }

  // Resolve Worker Secret
  const workerSecret = options.workerSecret ||
    process.env.INTERNAL_WORKER_SECRET ||
    process.env.WORKER_SECRET ||
    funcEnv.INTERNAL_WORKER_SECRET ||
    hostedEnv.INTERNAL_WORKER_SECRET;

  if (!workerUrl || workerUrl.trim().length === 0) {
    throw new Error('WORKER_CONFIG_ERROR: Worker URL could not be resolved');
  }
  if (!workerSecret || workerSecret.trim().length === 0) {
    throw new Error('WORKER_CONFIG_ERROR: Worker secret could not be resolved from env or arguments');
  }

  console.log(`Target: ${target}`);
  console.log(`Resolved database host: ${resolvedHost}`);
  console.log(`Connecting to database at ${displayHost}...`);
  console.log(`Configuring worker_url: ${workerUrl}`);
  console.log(`Configuring worker_secret: ${maskSecret(workerSecret)}`);

  const client = new Client({
    connectionString: dbUrl,
    connectionTimeoutMillis: 10000,
    ssl: (target === 'hosted' || dbUrl.includes('supabase.com') || dbUrl.includes('supabase.co')) ? { rejectUnauthorized: false } : false,
  });

  try {
    await client.connect();

    const query = `
      INSERT INTO private.app_config (key, value, description, updated_at)
      VALUES 
        ('notification_worker_url', $1, 'Edge function worker endpoint URL', now()),
        ('worker_secret', $2, 'Internal notification worker shared secret', now())
      ON CONFLICT (key) DO UPDATE SET 
        value = EXCLUDED.value, 
        updated_at = now();
    `;

    await client.query(query, [workerUrl.trim(), workerSecret.trim()]);
    console.log('SUCCESS: private.app_config synchronized successfully.');
  } catch (err) {
    console.error('ERROR during worker configuration synchronization:', err.message);
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
  console.error('FAILED: set_worker_config execution failed');
  process.exit(1);
});
