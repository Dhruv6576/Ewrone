const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
});

async function run() {
  try {
    await client.connect();
    console.log('Connected to local Supabase database.');

    await client.query(`
      grant update on public.master_owners to authenticated;

      create policy master_owners_update
        on public.master_owners for update to authenticated
        using (owner_user_id = auth.uid())
        with check (owner_user_id = auth.uid());
    `);

    console.log('Successfully created master_owners_update policy!');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
