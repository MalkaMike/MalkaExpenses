import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// Anon-key Supabase client — respects Row Level Security.
//
// Use this for household-serving reads so the DB enforces the privacy wall
// (shared_amount <> 0 row filter + column-level grants from 0028_rls_policies)
// in addition to the runtime guards in lib/supabase/shared-client.ts.
//
// NEVER use for admin operations — anon has no access to admin-only tables.

let _client: SupabaseClient | null = null;

export function anonClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return _client;
}
