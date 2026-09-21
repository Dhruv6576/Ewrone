const { Client } = require('pg');

async function main() {
  const pg = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    statement_timeout: 5000
  });

  try {
    await pg.connect();

    const tables = [
      'auth.users',
      'public.profiles',
      'public.players',
      'public.employees',
      'public.employee_turf_assignments',
      'public.master_owners',
      'public.turfs',
      'public.resources',
      'public.slots',
      'public.bookings',
      'private.payment_orders',
      'private.audit_events',
      'private.outbox_events',
      'private.platform_admins',
      'private.ledger_journals',
      'private.ledger_entries',
      'public.notifications'
    ];

    console.log('=== RESIDUE TABLE AUDIT ===');
    for (const t of tables) {
      const res = await pg.query('SELECT count(*)::int AS c FROM ' + t);
      console.log(t + ': ' + res.rows[0].c);
    }

    console.log('\n--- auth.users details ---');
    const users = await pg.query('SELECT id, email, created_at FROM auth.users ORDER BY created_at ASC');
    users.rows.forEach((u, i) => {
      console.log(`[${i}] id: ${u.id} | email: ${u.email} | created_at: ${u.created_at.toISOString()}`);
    });

    console.log('\n--- public.employees details ---');
    const emps = await pg.query('SELECT id, user_id, master_owner_id, status FROM public.employees');
    emps.rows.forEach((e, i) => {
      console.log(`[${i}] id: ${e.id} | user_id: ${e.user_id} | master_owner_id: ${e.master_owner_id} | status: ${e.status}`);
    });

    console.log('\n--- public.employee_turf_assignments details ---');
    const assigns = await pg.query('SELECT id, employee_id, turf_id, active FROM public.employee_turf_assignments');
    assigns.rows.forEach((a, i) => {
      console.log(`[${i}] id: ${a.id} | employee_id: ${a.employee_id} | turf_id: ${a.turf_id} | active: ${a.active}`);
    });

    console.log('\n--- public.turfs details ---');
    const turfs = await pg.query('SELECT id, name, slug, archived_at FROM public.turfs ORDER BY created_at ASC');
    turfs.rows.forEach((t, i) => {
      console.log(`[${i}] id: ${t.id} | name: ${t.name} | slug: ${t.slug} | archived_at: ${t.archived_at ? t.archived_at.toISOString() : 'null'}`);
    });
  } catch (err) {
    console.error('Error during residue check:', err);
    process.exitCode = 1;
  } finally {
    await pg.end();
  }
}

main().catch(err => {
  console.error('Fatal outer residue check error:', err);
  process.exit(1);
});
