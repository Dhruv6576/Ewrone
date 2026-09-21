#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const TIMEOUT_MS = 15000;

const STAGING_URL = 'https://akbndqzrnqxyckldboaw.supabase.co';
const STAGING_ANON_KEY = 'sb_publishable_HcrvIrWuqmb41nfRhwWaFQ_2ieAjEsp';

function assertNoSecretsSupplied(target) {
  const forbiddenEnvKeys = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'SERVICE_ROLE_KEY',
    'SUPABASE_DB_PASSWORD',
    'DB_PASSWORD',
    'DATABASE_PASSWORD',
    'POSTGRES_PASSWORD',
    'SUPABASE_STAGING_SERVICE_ROLE_KEY',
    'RAZORPAY_KEY_SECRET',
    'INTERNAL_WORKER_SECRET'
  ];

  for (const key of forbiddenEnvKeys) {
    if (process.env[key] && process.env[key].trim().length > 0) {
      throw new Error(`FATAL REFUSAL: Forbidden secret '${key}' detected in environment. bootstrap.mjs manages public client configs only and strictly refuses execution when secrets or database passwords are supplied.`);
    }
  }

  for (const arg of process.argv.slice(2)) {
    if (/(service[-_]?role|password|secret|db[-_]?url)/i.test(arg) && !arg.startsWith('--target=')) {
      throw new Error(`FATAL REFUSAL: Forbidden secret-like CLI argument detected: '${arg}'. bootstrap.mjs accepts public configuration only.`);
    }
  }

  const anonCandidate = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (anonCandidate) {
    if (anonCandidate.startsWith('sb_secret_') || anonCandidate.includes('service_role') || /secret/i.test(anonCandidate)) {
      throw new Error('FATAL REFUSAL: NEXT_PUBLIC_SUPABASE_ANON_KEY appears to be a service-role key or secret! Only public publishable keys are permitted.');
    }
  }
}

async function main() {
  const timeout = setTimeout(() => {
    console.error('FATAL: bootstrap.mjs timed out.');
    process.exit(1);
  }, TIMEOUT_MS);

  try {
    const targetArg = process.argv.find(arg => arg.startsWith('--target='));
    const target = targetArg ? targetArg.split('=')[1].toLowerCase() : 'local';

    if (target !== 'local' && target !== 'staging') {
      throw new Error(`FATAL: Unsupported target '${target}'. Allowed targets are 'local' or 'staging'.`);
    }

    assertNoSecretsSupplied(target);

    let supabaseUrl = '';
    let anonKey = '';

    if (target === 'staging') {
      supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || STAGING_URL;
      anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || STAGING_ANON_KEY;
      console.log(`Bootstrapping for target: staging (${supabaseUrl})`);
    } else {
      supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
      anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

      try {
        const statusOutput = execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        const status = JSON.parse(statusOutput);
        if (status.API_URL) supabaseUrl = status.API_URL;
        if (status.ANON_KEY) anonKey = status.ANON_KEY;
      } catch {
        // ignore if env vars already provided
      }

      if (!supabaseUrl || !anonKey) {
        throw new Error('FATAL: Could not resolve Supabase credentials. Either start local Supabase (npx supabase start) so status can be queried, or provide NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
      }
      console.log(`Bootstrapping for target: local (${supabaseUrl})`);
    }

    const apps = [
      { name: 'apps/player', port: 3000 },
      { name: 'apps/owner', port: 3001 },
      { name: 'apps/admin', port: 3003 },
    ];

    for (const app of apps) {
      const stagingExamplePath = path.resolve(app.name, '.env.staging.example');
      const defaultExamplePath = path.resolve(app.name, '.env.example');
      const examplePath = (target === 'staging' && fs.existsSync(stagingExamplePath))
        ? stagingExamplePath
        : defaultExamplePath;
      const localPath = path.resolve(app.name, '.env.local');

      if (!fs.existsSync(examplePath)) {
        console.warn(`Warning: ${examplePath} not found.`);
        continue;
      }

      let content = fs.readFileSync(examplePath, 'utf8');
      content = content.replace(/NEXT_PUBLIC_SUPABASE_URL=.*/g, `NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}`);
      content = content.replace(/NEXT_PUBLIC_SUPABASE_ANON_KEY=.*/g, `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`);

      if (target === 'local') {
        content = content.replace(/NEXT_PUBLIC_OWNER_URL=.*/g, `NEXT_PUBLIC_OWNER_URL=http://localhost:3001`);
        content = content.replace(/NEXT_PUBLIC_PLAYER_URL=.*/g, `NEXT_PUBLIC_PLAYER_URL=http://localhost:3000`);
      }

      // Preserve or set live Razorpay key for apps/player
      if (app.name === 'apps/player') {
        let razorpayKey = '';
        if (fs.existsSync(localPath)) {
          const existing = fs.readFileSync(localPath, 'utf8');
          const m = existing.match(/^NEXT_PUBLIC_RAZORPAY_KEY_ID=(rzp_test_[a-zA-Z0-9]+)$/m);
          if (m && !m[1].includes('your-razorpay-key-id-here')) {
            razorpayKey = m[1].trim();
          }
        }
        if (!razorpayKey && fs.existsSync('supabase/functions/.env')) {
          const fEnv = fs.readFileSync('supabase/functions/.env', 'utf8');
          const m = fEnv.match(/^RAZORPAY_KEY_ID=(rzp_test_[a-zA-Z0-9]+)$/m);
          if (m) razorpayKey = m[1].trim();
        }
        if (!razorpayKey && target === 'staging') {
          razorpayKey = 'rzp_test_TehljHkxbdDR65';
        }
        if (razorpayKey) {
          content = content.replace(/NEXT_PUBLIC_RAZORPAY_KEY_ID=.*/g, `NEXT_PUBLIC_RAZORPAY_KEY_ID=${razorpayKey}`);
        }
      }

      fs.writeFileSync(localPath, content, 'utf8');
      console.log(`Configured ${localPath} from ${path.basename(examplePath)}`);
    }

    console.log(`Bootstrap completed successfully for ${target}.`);
  } catch (err) {
    console.error('Bootstrap error:', err.message || err);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}

main();
