import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createBrokerUserClient } from "@/lib/auth/broker";
import { createProviderAuthClient } from "@/lib/auth/broker/provider";

/**
 * Request-scoped Supabase client backed by the WP01A session broker.
 * Tokens live server-side; browser only carries opaque handle cookies.
 * Legacy sb-* auth cookies are ignored (no dual-reader fallback).
 */
export async function createClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  const reader = {
    getAll: () => cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
  };
  const resolved = await createBrokerUserClient(reader);
  if (resolved.ok) return resolved.client;

  // Unauthenticated request path: memory-only provider client with no session.
  // Callers that require auth still fail at getUser/RPC under RLS.
  const bundle = createProviderAuthClient();
  if (!bundle) {
    throw new Error("Supabase public env is incomplete");
  }
  return bundle.client;
}

/** Resolve broker session for writers that need handle/cookie mutation. */
export async function createBrokerBoundClient() {
  const cookieStore = await cookies();
  const reader = {
    getAll: () => cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
  };
  const writer = {
    set(name: string, value: string, options?: Record<string, unknown>) {
      try {
        cookieStore.set(name, value, options as never);
      } catch {
        /* Server Component read-only cookie context */
      }
    },
  };
  return { cookieStore, reader, writer, bound: await createBrokerUserClient(reader) };
}
