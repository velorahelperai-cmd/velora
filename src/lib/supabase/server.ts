import { cache } from "react";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createBrokerUserClient } from "@/lib/auth/broker";
import { createProviderAuthClient } from "@/lib/auth/broker/provider";

function snapshotCookieKey(cookieStore: Awaited<ReturnType<typeof cookies>>): string {
  const pairs = cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
  return JSON.stringify(pairs);
}

// Per-request memoization keyed by a single stable primitive cookie snapshot string.
// Cookie mutations produce a new key within the same request; React.cache resets across requests.
const resolveBrokerForCookieSnapshot = cache(async (cookieSnapshotKey: string) => {
  const pairs = JSON.parse(cookieSnapshotKey) as Array<{ name: string; value: string }>;
  return createBrokerUserClient({
    getAll: () => pairs.map((c) => ({ name: c.name, value: c.value })),
  });
});

/**
 * Request-scoped Supabase client backed by the WP01A session broker.
 * Tokens live server-side; browser only carries opaque handle cookies.
 * Legacy sb-* auth cookies are ignored (no dual-reader fallback).
 */
export async function createClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  const cookieSnapshotKey = snapshotCookieKey(cookieStore);
  const resolved = await resolveBrokerForCookieSnapshot(cookieSnapshotKey);
  if (resolved.ok) return resolved.client;

  // A broker/refresh outage is not evidence of logout. Returning a sessionless
  // client here makes activity checks expire and quarantine a valid session.
  // Existing callers handle a failed client read as unavailable, without granting access.
  if (resolved.code === "UNAVAILABLE") throw new Error("BROKER_SESSION_UNAVAILABLE");

  // Unauthenticated request path: memory-only provider client with no session.
  // Callers that require auth still fail at getUser/RPC under RLS.
  const bundle = createProviderAuthClient();
  if (!bundle) {
    throw new Error("Supabase public env is incomplete");
  }
  return bundle.client;
}

/** Resolve broker session for writers that need handle/cookie mutation. */
export async function createBrokerBoundClient(options?: { fresh?: boolean }) {
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
  const cookieSnapshotKey = snapshotCookieKey(cookieStore);
  // Authority fences must observe DB revocation/rotation even when cookies did not change.
  const bound = options?.fresh
    ? await createBrokerUserClient(reader)
    : await resolveBrokerForCookieSnapshot(cookieSnapshotKey);
  return { cookieStore, reader, writer, bound };
}
