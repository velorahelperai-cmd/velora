import { createClient } from "@/lib/supabase/server";

export type AccountPlatformIdentity = {
  role: "owner" | "delegated" | null;
  status: "active" | "disabled" | null;
  unavailable: boolean;
};

export const unavailablePlatformIdentity = (): AccountPlatformIdentity => ({ role: null, status: null, unavailable: true });

/** Display metadata only. Caller supplies its verified current user, never an account search. */
export async function readAccountPlatformIdentity(userId: string): Promise<AccountPlatformIdentity> {
  try {
    const client = await createClient();
    const { data, error } = await client.from("platform_admins").select("role,status").eq("user_id", userId).maybeSingle();
    if (error) return unavailablePlatformIdentity();
    if (data === null) return { role: null, status: null, unavailable: false };
    // Generated types predate these existing columns; validate the response at runtime.
    const row: unknown = data;
    if (!row || typeof row !== "object" || Array.isArray(row)) return unavailablePlatformIdentity();
    const { role, status } = row as Record<string, unknown>;
    if ((role !== "owner" && role !== "delegated") || (status !== "active" && status !== "disabled")) return unavailablePlatformIdentity();
    return { role, status, unavailable: false };
  } catch {
    return unavailablePlatformIdentity();
  }
}
