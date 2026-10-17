import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getSupabaseEnv } from "@/lib/supabase/env";

const STORAGE_KEY = "sb-broker-provider";

export type ProviderAuthBundle = {
  client: SupabaseClient<Database>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void | Promise<void>;
  entries(): Array<[string, string]>;
};

/** Stateless provider client — no cookie persistence (BR01). */
export function createProviderAuthClient(options?: { persistPkceVerifier?: (verifier: string) => Promise<void> }): ProviderAuthBundle | null {
  const env = getSupabaseEnv();
  if (!env.ok) return null;
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key === `${STORAGE_KEY}-code-verifier` && options?.persistPkceVerifier) {
        // Supabase awaits storage: persist the verifier before it sends the recovery email.
        return options.persistPkceVerifier(value).then(() => { memory.set(key, value); });
      }
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
  };
  const client = createClient<Database>(env.url, env.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage,
      storageKey: STORAGE_KEY,
      flowType: "pkce",
    },
  });
  return {
    client,
    getItem: storage.getItem,
    setItem: storage.setItem,
    entries: () => [...memory.entries()],
  };
}

export function readPkceVerifier(bundle: ProviderAuthBundle): string | null {
  const direct = bundle.getItem(`${STORAGE_KEY}-code-verifier`);
  if (typeof direct === "string" && direct.length > 0) return direct;
  for (const [key, value] of bundle.entries()) {
    if (key.includes("code-verifier") && value.length > 0) return value;
  }
  return null;
}

export function seedPkceVerifier(bundle: ProviderAuthBundle, verifier: string): void {
  bundle.setItem(`${STORAGE_KEY}-code-verifier`, verifier);
}
