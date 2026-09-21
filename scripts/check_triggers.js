const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    statement_timeout: 5000
  });

  try {
    await client.connect();
    const res = await client.query(`
      SELECT tgname, tgenabled
      FROM pg_trigger
      WHERE tgname IN (
        'trg_immutable_ledger_journals',
        'trg_immutable_ledger_entries',
        'trg_enforce_journal_balance',
        'trg_enforce_entry_balance',
        'trg_audit_events_immutability'
      )
      ORDER BY tgname;
    `);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error('Trigger check failed:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run().catch(err => {
  console.error('Fatal trigger check error:', err);
  process.exit(1);
});

