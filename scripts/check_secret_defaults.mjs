#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const FUNCTIONS_DIR = path.resolve('supabase/functions');
const SECRET_KEY_PATTERN = /(SECRET|KEY)[^=]*=[^;]*(\|\||\?\?)\s*["'][^"']+["']/i;

let violations = [];

function scanDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (SECRET_KEY_PATTERN.test(line)) {
          violations.push({
            file: path.relative(process.cwd(), fullPath),
            line: idx + 1,
            code: line.trim()
          });
        }
      });
    }
  }
}

scanDir(FUNCTIONS_DIR);

if (violations.length > 0) {
  console.error(`FAIL: Found ${violations.length} secret/key fallback default violation(s) in edge functions:`);
  violations.forEach(v => console.error(`  ${v.file}:${v.line} -> ${v.code}`));
  process.exit(1);
}

console.log('PASS: No fail-open string literals found for SECRET or KEY variables under supabase/functions/.');
