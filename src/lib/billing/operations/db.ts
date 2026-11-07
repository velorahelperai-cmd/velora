import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";
import type { OperationResult } from "./contracts";

export type OperationRpcFunctions = Database["public"]["Functions"];

export async function operationRpc<
  T,
  FName extends keyof OperationRpcFunctions = keyof OperationRpcFunctions
>(
  name: FName,
  args: OperationRpcFunctions[FName]["Args"],
  internal = false
): Promise<OperationResult<T>> {
  try {
    const client = (internal ? createAdminClient() : await createClient()) as unknown as SupabaseClient | null;
    if (!client) return { ok: false, code: "unavailable" };
    const { data, error } = await client.rpc(name, args as Record<string, unknown>);
    if (error) {
      return {
        ok: false,
        code: error.code === "42501"
          ? "forbidden"
          : ["PGRST202", "42P01", "42883"].includes(error.code)
          ? "schema_unavailable"
          : "unavailable",
      };
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, code: "invalid_payload" };
    if (data.ok !== true) return { ok: false, code: typeof data.code === "string" ? data.code : "unavailable" };
    return { ok: true, data: data.data as T };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}
