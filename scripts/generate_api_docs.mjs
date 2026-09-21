#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const TIMEOUT_MS = 15000;

async function main() {
  const timeout = setTimeout(() => {
    console.error('FATAL: Script timed out after 15 seconds.');
    process.exit(1);
  }, TIMEOUT_MS);

  const client = new pg.Client({ connectionString: DB_URL });

  try {
    await client.connect();

    // 1. Query public functions / RPCs
    const rpcQuery = `
      select 
        n.nspname as schema_name,
        p.proname as function_name,
        pg_get_function_arguments(p.oid) as arguments,
        pg_get_function_result(p.oid) as return_type,
        case 
          when p.prosecdef then 'SECURITY DEFINER'
          else 'SECURITY INVOKER'
        end as security_type,
        obj_description(p.oid, 'pg_proc') as description
      from pg_proc p
      join pg_namespace n on p.pronamespace = n.oid
      where n.nspname in ('public', 'private')
        and p.prokind = 'f'
        and p.proname not like 'pg_%'
        and p.proname not like '_st_%'
        and p.proname not like 'st_%'
        and p.proname not like 'postgis_%'
        and p.proname not like 'geometry_%'
        and p.proname not like 'geography_%'
      order by n.nspname, p.proname;
    `;
    const rpcRes = await client.query(rpcQuery);

    // 2. Query Row Level Security Policies
    const policyQuery = `
      select 
        schemaname,
        tablename,
        policyname,
        permissive,
        roles,
        cmd,
        qual,
        with_check
      from pg_policies
      where schemaname in ('public', 'private')
      order by schemaname, tablename, policyname;
    `;
    const policyRes = await client.query(policyQuery);

    // Build API.md content
    let md = '# Box Codex — Database API & RPC Catalog\n\n';
    md += 'Generated automatically from the database schema via `scripts/generate_api_docs.mjs`.\n\n';
    md += '> [!NOTE]\n';
    md += '> The `Capability / Caller` and `Typical Error SQLSTATEs` columns represent architectural conventions based on schema and function-naming rules (not directly derived from pg_proc / AST analysis). Always verify the specific SQL function implementation for exact error conditions and caller capabilities.\n\n';
    md += '## 1. Remote Procedure Calls (RPCs)\n\n';
    md += '| Schema | Function Name | Arguments | Returns | Security | Capability / Caller (Convention) | Typical Error SQLSTATEs (Convention) |\n';
    md += '|:---|:---|:---|:---|:---|:---|:---|\n';

    for (const row of rpcRes.rows) {
      let caller = 'authenticated';
      let errState = '42501 (Unauthorized)';
      
      if (row.schema_name === 'private') {
        caller = 'service_role / internal';
        errState = '42501';
      } else if (row.function_name.startsWith('admin_') || ['settle_owner_payout', 'request_refund'].includes(row.function_name)) {
        caller = 'platform_admin';
        errState = '42501 (Forbidden)';
      } else if (row.function_name.startsWith('owner_') || row.function_name.startsWith('master_')) {
        caller = 'master_owner / employee';
        errState = '42501 (Forbidden)';
      } else if (['get_public_turfs', 'get_public_turf_by_slug', 'get_public_slots', 'get_public_reviews'].includes(row.function_name)) {
        caller = 'anon / public';
        errState = 'None (Public Read)';
      } else if (['create_booking_hold', 'confirm_booking', 'cancel_booking'].includes(row.function_name)) {
        caller = 'player (authenticated)';
        errState = '42501, 23P01 (Slot unavailable)';
      }

      const args = row.arguments ? `\`${row.arguments.replace(/\|/g, '\\|')}\`` : '*none*';
      const ret = `\`${row.return_type.replace(/\|/g, '\\|')}\``;
      md += `| \`${row.schema_name}\` | \`${row.function_name}\` | ${args} | ${ret} | ${row.security_type} | ${caller} | ${errState} |\n`;
    }

    md += '\n## 2. Row Level Security (RLS) Table Policies\n\n';
    md += '| Schema | Table | Policy Name | Command | Roles Permitted | Permissive |\n';
    md += '|:---|:---|:---|:---|:---|:---|\n';

    for (const pol of policyRes.rows) {
      const roles = Array.isArray(pol.roles) ? pol.roles.join(', ') : pol.roles;
      md += `| \`${pol.schemaname}\` | \`${pol.tablename}\` | \`${pol.policyname}\` | \`${pol.cmd}\` | \`${roles}\` | ${pol.permissive} |\n`;
    }

    const outPath = path.resolve('docs/API.md');
    fs.writeFileSync(outPath, md, 'utf8');
    console.log(`Successfully generated ${outPath} (${rpcRes.rows.length} RPCs, ${policyRes.rows.length} policies).`);

  } catch (err) {
    console.error('API Doc Generation failed:', err);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    await client.end();
  }
}

main();
