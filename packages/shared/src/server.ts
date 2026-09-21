import { createServerClient as createSupabaseServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PORTAL_CONFIGS } from './config';

export interface CookieStoreAdapter {
  getAll: () => Array<{ name: string; value: string }>;
  set?: (name: string, value: string, options?: any) => void;
}

/**
 * Creates an isolated server Supabase client using portal-specific cookie name.
 */
export function createServerClient(
  portalKey: 'admin' | 'owner' | 'player',
  cookieStore: CookieStoreAdapter,
  customUrl?: string,
  customAnonKey?: string
): SupabaseClient {
  const cfg = PORTAL_CONFIGS[portalKey];
  const url = customUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const anonKey = customAnonKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  return createSupabaseServerClient(url, anonKey, {
    cookieOptions: {
      name: cfg.cookieName,
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        if (cookieStore.set) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set!(name, value, options);
            });
          } catch {
            // Ignored when invoked in Server Components (read-only cookie store)
          }
        }
      },
    },
  });
}
