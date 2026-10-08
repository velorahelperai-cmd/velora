"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { getSupabaseEnv } from "@/lib/supabase/env";

export function createClient() {
  const env = getSupabaseEnv();
  if (!env.ok) {
    throw new Error("Supabase public env is incomplete");
  }
  return createBrowserClient<Database>(env.url, env.publishableKey);
}

/** Optional observers must not crash public pages when local setup is absent. */
export function tryCreateClient(): ReturnType<typeof createClient> | null {
  try { return createClient(); } catch { return null; }
}
