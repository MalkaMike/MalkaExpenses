import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import "server-only";

// Server-only Supabase client using the service_role key.
// Bypasses RLS — use ONLY in API routes and server components.
// NEVER import this file from any "use client" boundary.

let _client: SupabaseClient | null = null;

export function serverClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return _client;
}
