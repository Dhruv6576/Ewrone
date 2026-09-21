// tests/test_constants.js
// Single source of truth for baseline seed assertions and GoTrue-compliant auth user helpers

const EXPECTED_BASE_PROFILES = 4; // demo_owner@boxcodex.internal + live_player@example.com + demo_staff@boxcodex.internal + demo_admin@boxcodex.internal
const EXPECTED_BASE_PLAYERS = 4;  // demo_owner player row + live_player player row + demo_staff player row + demo_admin player row

/**
 * Inserts a fully formed, GoTrue-scannable auth.users row and corresponding auth.identities row.
 * Matches exact schema and non-nullable column shape seeded in supabase/seed.sql lines 41-89.
 */
async function insertTestAuthUser(client, {
  id,
  email,
  rawUserMetaData = {},
  password = 'Password123!',
  phone = null
}) {
  const metaJson = typeof rawUserMetaData === 'string' ? rawUserMetaData : JSON.stringify(rawUserMetaData);

  await client.query(`
    INSERT INTO auth.users (
      id, email, phone, raw_user_meta_data, encrypted_password, aud, role, instance_id, email_confirmed_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token,
      raw_app_meta_data, created_at, updated_at
    )
    VALUES (
      $1::uuid, $2::text, $3::text, $4::jsonb,
      extensions.crypt($5::text, extensions.gen_salt('bf')),
      'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
      now(), '', '', '', '', '', '', '', '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      now(), now()
    )
    ON CONFLICT (id) DO UPDATE SET
      encrypted_password = excluded.encrypted_password,
      aud = excluded.aud,
      role = excluded.role,
      instance_id = excluded.instance_id,
      email_confirmed_at = coalesce(auth.users.email_confirmed_at, excluded.email_confirmed_at),
      confirmation_token = excluded.confirmation_token,
      recovery_token = excluded.recovery_token,
      email_change = excluded.email_change,
      email_change_token_new = excluded.email_change_token_new,
      email_change_token_current = excluded.email_change_token_current,
      phone_change = excluded.phone_change,
      phone_change_token = excluded.phone_change_token,
      reauthentication_token = excluded.reauthentication_token,
      raw_app_meta_data = excluded.raw_app_meta_data,
      created_at = coalesce(auth.users.created_at, excluded.created_at),
      updated_at = now();
  `, [id, email, phone, metaJson, password]);

  await client.query(`
    INSERT INTO auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    )
    VALUES (
      $1::text, $2::uuid,
      jsonb_build_object('sub', $1::text, 'email', $3::text, 'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    )
    ON CONFLICT (provider_id, provider) DO NOTHING;
  `, [id, id, email]);
}

async function insertTestAuthUsers(client, usersList) {
  for (const u of usersList) {
    await insertTestAuthUser(client, u);
  }
}

const EXPECTED_BASE_NOTIFICATIONS = 0;
const EXPECTED_BASE_NOTIFICATION_DELIVERIES = 0;

async function assertNoOrphans(client) {
  const oOutbox = await client.query(`
    SELECT count(*)::int as count FROM private.outbox_events o
    WHERE not exists (select 1 from public.bookings b where b.id=o.aggregate_id)
      AND not exists (select 1 from private.payouts p where p.id=o.aggregate_id)
      AND not exists (select 1 from public.notifications n where n.id=o.aggregate_id);
  `);
  const oProfiles = await client.query(`
    SELECT count(*)::int as count FROM public.profiles p
    WHERE not exists (select 1 from auth.users u where u.id=p.user_id);
  `);
  const oPlayers = await client.query(`
    SELECT count(*)::int as count FROM public.players pl
    WHERE not exists (select 1 from auth.users u where u.id=pl.user_id);
  `);
  const oBookingEvents = await client.query(`
    SELECT count(*)::int as count FROM public.booking_events be
    WHERE not exists (select 1 from public.bookings b where b.id=be.booking_id);
  `);
  const oDeliveries = await client.query(`
    SELECT count(*)::int as count FROM private.notification_deliveries nd
    WHERE not exists (select 1 from public.notifications n where n.id=nd.notification_id);
  `);

  const errors = [];
  if (oOutbox.rows[0].count > 0) errors.push(`Orphan outbox_events: ${oOutbox.rows[0].count}`);
  if (oProfiles.rows[0].count > 0) errors.push(`Orphan profiles: ${oProfiles.rows[0].count}`);
  if (oPlayers.rows[0].count > 0) errors.push(`Orphan players: ${oPlayers.rows[0].count}`);
  if (oBookingEvents.rows[0].count > 0) errors.push(`Orphan booking_events: ${oBookingEvents.rows[0].count}`);
  if (oDeliveries.rows[0].count > 0) errors.push(`Orphan notification_deliveries: ${oDeliveries.rows[0].count}`);

  if (errors.length > 0) {
    throw new Error(`ORPHAN_RECORDS_DETECTED: ${errors.join(', ')}`);
  }
}

module.exports = {
  EXPECTED_BASE_PROFILES,
  EXPECTED_BASE_PLAYERS,
  EXPECTED_BASE_NOTIFICATIONS,
  EXPECTED_BASE_NOTIFICATION_DELIVERIES,
  insertTestAuthUser,
  insertTestAuthUsers,
  assertNoOrphans
};

