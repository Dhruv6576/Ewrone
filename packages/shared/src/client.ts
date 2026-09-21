import { createBrowserClient as createSupabaseBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PORTAL_CONFIGS } from './config';

/**
 * Creates an isolated browser Supabase client with portal-specific cookie and storageKey.
 */
export function createBrowserClient(
  portalKey: 'admin' | 'owner' | 'player',
  customUrl?: string,
  customAnonKey?: string
): SupabaseClient {
  const cfg = PORTAL_CONFIGS[portalKey];
  const url = customUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const anonKey = customAnonKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  return createSupabaseBrowserClient(url, anonKey, {
    cookieOptions: {
      name: cfg.cookieName,
    },
    auth: {
      storageKey: cfg.storageKey,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}
