import { cache } from "react";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createBrokerUserClient } from "@/lib/auth/broker";
import { createProviderAuthClient } from "@/lib/auth/broker/provider";

function snapshotCookies(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  const pairs = cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
  const key = pairs.map((c) => `${c.name}=${c.value}`).join("; ");
  return { key, pairs };
}

// Per-request memoization keyed by current cookie state. Cookie mutations
// produce a new key within the same request; React cache resets across requests.
const resolveBrokerForCookieSnapshot = cache(
  async (key: string, pairs: Array<{ name: string; value: string }>) => {
    void key;
    return createBrokerUserClient({ getAll: () => pairs });
  },
);

/**
 * Request-scoped Supabase client backed by the WP01A session broker.
 * Tokens live server-side; browser only carries opaque handle cookies.
 * Legacy sb-* auth cookies are ignored (no dual-reader fallback).
 */
export async function createClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  const { key, pairs } = snapshotCookies(cookieStore);
  const resolved = await resolveBrokerForCookieSnapshot(key, pairs);
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
  const { key, pairs } = snapshotCookies(cookieStore);
  return { cookieStore, reader, writer, bound: await resolveBrokerForCookieSnapshot(key, pairs) };
}
