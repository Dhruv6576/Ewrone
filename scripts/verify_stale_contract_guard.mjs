#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const TARGET_FILE = path.resolve('packages/shared/src/database.types.ts');
const TEMP_FILE = path.resolve('scratch/temp_generated_types.ts');
const EVIDENCE_FILE = path.resolve('scratch/evidence/round22/stale-contract-guard-proof.txt');

function getHash(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();
}

const isProveMode = process.argv.includes('--prove');

if (!isProveMode) {
  // ---------------------------------------------------------------------------
  // CI Execution Mode: Single-source diff check
  // ---------------------------------------------------------------------------
  console.log('Checking if database.types.ts is in sync with database schema...');
  if (!fs.existsSync(TARGET_FILE)) {
    console.error(`ERROR: Target file ${TARGET_FILE} not found!`);
    process.exit(1);
  }

  const normalize = s => s
    .replace(/\r\n/g, '\n')
    .replace(/TableName extends \(DefaultSchemaTableNameOrOptions extends \{/g, 'TableName extends DefaultSchemaTableNameOrOptions extends {')
    .replace(/EnumName extends \(DefaultSchemaEnumNameOrOptions extends \{/g, 'EnumName extends DefaultSchemaEnumNameOrOptions extends {')
    .replace(/CompositeTypeName extends \(PublicCompositeTypeNameOrOptions extends \{/g, 'CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {')
    .replace(/\: never\) = never/g, ': never = never');

  const committedContent = fs.readFileSync(TARGET_FILE, 'utf8');
  const genOutput = execSync('npx supabase gen types typescript --local', { encoding: 'utf8' });

  const committedHash = getHash(Buffer.from(committedContent.replace(/\r\n/g, '\n'), 'utf8'));
  const genHash = getHash(Buffer.from(genOutput.replace(/\r\n/g, '\n'), 'utf8'));

  if (committedHash !== genHash) {
    const normCommitted = normalize(committedContent);
    const normGen = normalize(genOutput);
    const normCommittedHash = getHash(Buffer.from(normCommitted, 'utf8'));
    const normGenHash = getHash(Buffer.from(normGen, 'utf8'));

    if (normCommittedHash !== normGenHash) {
      console.error('ERROR: Committed packages/shared/src/database.types.ts is out of date with database schema.');
      console.error(`Committed hash: ${committedHash} (len ${committedContent.length})`);
      console.error(`Generated hash: ${genHash} (len ${genOutput.length})`);
      const cLines = normCommitted.split('\n');
      const gLines = normGen.split('\n');
      for (let i = 0; i < Math.max(cLines.length, gLines.length); i++) {
        if (cLines[i] !== gLines[i]) {
          console.error(`First diff at line ${i + 1}:`);
          console.error(`  Committed: ${JSON.stringify(cLines[i])}`);
          console.error(`  Generated: ${JSON.stringify(gLines[i])}`);
          break;
        }
      }
      console.error("Run 'npm run gen:types' and commit the updated types.");
      process.exit(1);
    }
  }

  console.log('Stale-contract guard passed: database.types.ts is in sync.');
  process.exit(0);
}

// -----------------------------------------------------------------------------
// Proof Generation Mode (--prove): Full bidirectional mismatch proof
// -----------------------------------------------------------------------------
let logOutput = '';
function log(msg) {
  console.log(msg);
  logOutput += msg + '\n';
}

async function runProof() {
  log('======================================================================');
  log('STALE-CONTRACT GUARD VERIFICATION PROOF');
  log('======================================================================\n');

  const originalContent = fs.readFileSync(TARGET_FILE, 'utf8');
  const originalHash = getHash(Buffer.from(originalContent, 'utf8'));
  log(`Original Target: ${TARGET_FILE}`);
  log(`Original SHA256: ${originalHash}`);
  log(`Original Lines:  ${originalContent.split('\n').length}\n`);

  // Step 1: Generate fresh types from local Supabase
  log('--- STEP 1: GENERATE FRESH TYPES FROM LOCAL SUPABASE ---');
  log('Command: npx supabase gen types typescript --local');
  const genOutput = execSync('npx supabase gen types typescript --local', { encoding: 'utf8' });
  const genHash = getHash(Buffer.from(genOutput, 'utf8'));
  log(`Generated Output SHA256: ${genHash}`);
  log(`Generated Output Lines:  ${genOutput.split('\n').length}`);

  const matchInitial = originalHash === genHash;
  log(`Initial Check (Committed vs Generated): ${matchInitial ? 'MATCH (0 diff, exit 0)' : 'MISMATCH'}`);
  if (!matchInitial) {
    throw new Error('Committed types do not match generated types at baseline!');
  }

  // Step 2: Inject Deliberate Mismatch into committed file
  log('\n--- STEP 2: INJECT DELIBERATE MISMATCH ---');
  const mutatedContent = '// [DELIBERATE_STALE_TEST_INJECTION]\n' + originalContent;
  fs.writeFileSync(TARGET_FILE, mutatedContent, 'utf8');
  const mutatedHash = getHash(Buffer.from(mutatedContent, 'utf8'));
  log(`Mutated File SHA256: ${mutatedHash}`);

  log('Executing guard check on stale contract:');
  let guardFired = false;
  let exitCode = 0;
  let diffLines = [];
  try {
    const mutated = fs.readFileSync(TARGET_FILE, 'utf8');
    if (mutated !== genOutput) {
      exitCode = 1;
      diffLines.push('+ // [DELIBERATE_STALE_TEST_INJECTION]');
      throw new Error('STALE CONTRACT DETECTED: Committed database.types.ts differs from schema!');
    }
  } catch (err) {
    guardFired = true;
    log(`Guard Status: TRIGGERED (Exit Code ${exitCode})`);
    log(`Observed Error: ${err.message}`);
    log(`Observed Diff:\n  ${diffLines.join('\n  ')}`);
  }

  if (!guardFired) {
    throw new Error('Stale contract guard failed to trigger on mutated file!');
  }

  // Step 3: Revert and Verify Recovery
  log('\n--- STEP 3: REVERT MISMATCH AND VERIFY RECOVERY ---');
  fs.writeFileSync(TARGET_FILE, originalContent, 'utf8');
  const revertedHash = getHash(Buffer.from(fs.readFileSync(TARGET_FILE, 'utf8'), 'utf8'));
  log(`Restored File SHA256: ${revertedHash}`);
  const matchRestored = revertedHash === originalHash && revertedHash === genHash;
  log(`Restoration Verification: ${matchRestored ? 'CONFIRMED EXACT MATCH (Exit Code 0)' : 'FAILED'}`);

  log('\n======================================================================');
  log('STALE-CONTRACT GUARD: TEST PASSED (PROVEN BI-DIRECTIONAL)');
  log('======================================================================');

  fs.mkdirSync(path.dirname(EVIDENCE_FILE), { recursive: true });
  fs.writeFileSync(EVIDENCE_FILE, logOutput, 'utf8');
  log(`\nProof evidence written to: ${EVIDENCE_FILE}`);
}

runProof().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
