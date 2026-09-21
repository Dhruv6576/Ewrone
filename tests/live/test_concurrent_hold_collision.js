const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

async function main() {
  console.log('=== TESTING CONCURRENT HOLD COLLISION ===');

  // Sign up/in two distinct player clients
  const clientA = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const clientB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  await clientA.auth.signUp({ email: 'player_one@test.com', password: 'Password123!' });
  await clientA.auth.signInWithPassword({ email: 'player_one@test.com', password: 'Password123!' });

  await clientB.auth.signUp({ email: 'player_two@test.com', password: 'Password123!' });
  await clientB.auth.signInWithPassword({ email: 'player_two@test.com', password: 'Password123!' });

  const resourceId = '2d06940a-d000-4739-a9a9-41e875829c71'; // Pitch A (Floodlit)
  const resourceName = 'Pitch A (Floodlit)';

  // Calculate tomorrow 10:00 AM - 11:00 AM in Asia/Kolkata
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yyyy = tomorrow.getFullYear();
  const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const dd = String(tomorrow.getDate()).padStart(2, '0');

  const startsAt = `${yyyy}-${mm}-${dd}T10:00:00+05:30`;
  const endsAt = `${yyyy}-${mm}-${dd}T11:00:00+05:30`;

  console.log(`Targeting Resource: ${resourceName} (${resourceId})`);
  console.log(`Time Interval:      ${startsAt} -> ${endsAt}\n`);

  console.log('Dispatching 2 concurrent hold requests for the exact same slot...');
  const [resA, resB] = await Promise.all([
    clientA.rpc('create_booking_hold', {
      p_resource_id: resourceId,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_idempotency_key: `collision_a_${Date.now()}`,
      p_contact_name: 'Player A'
    }),
    clientB.rpc('create_booking_hold', {
      p_resource_id: resourceId,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_idempotency_key: `collision_b_${Date.now()}`,
      p_contact_name: 'Player B'
    })
  ]);

  console.log('\n--- SESSION A RESPONSE ---');
  console.log('Data:', resA.data ? { booking_id: resA.data.booking_id, ref: resA.data.reference_code, status: resA.data.status } : null);
  console.log('Error:', resA.error?.message || 'none');

  console.log('\n--- SESSION B RESPONSE ---');
  console.log('Data:', resB.data ? { booking_id: resB.data.booking_id, ref: resB.data.reference_code, status: resB.data.status } : null);
  console.log('Error:', resB.error?.message || 'none');

  const oneSucceeded = (resA.data && !resB.data) || (!resA.data && resB.data);
  const oneBlocked = (resA.error || resB.error);
  const blockedError = resA.error || resB.error;

  console.log('\n--- COLLISION EVALUATION ---');
  console.log('Exactly one hold succeeded: ', oneSucceeded);
  console.log('Conflicting session blocked:', Boolean(oneBlocked));
  console.log('Blocked Error Code:         ', blockedError?.code);
  console.log('Blocked Error Message:      ', blockedError?.message);

  if (oneSucceeded && (blockedError?.code === '23P01' || blockedError?.message?.includes('SLOT_UNAVAILABLE'))) {
    console.log('\n[PASS] Concurrent hold collision handled with 100% database exclusion lock protection!');
  } else {
    throw new Error('Collision test failed to assert mutually exclusive hold creation.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
