import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCompanyAccess } from "@/lib/tenancy/access";
import { mapPublishedCatalog } from "./catalog-map";
import type { SubscriptionCatalog } from "./catalog-types";

/** Server-only owner-authorized catalog projection. No mutations, financial-account rows, provider I/O, or new grants. */
export async function readSubscriptionCatalog(): Promise<SubscriptionCatalog> {
  try {
    const access = await getCompanyAccess("owner");
    if (!access.ok || !access.context.company || !access.context.membership) {
      return { status: "forbidden", versions: [], reason: "owner_required" };
    }
    // Billing schema is not yet in generated Database types. Keep the unsafe boundary here
    // and validate every returned field in mapPublishedCatalog; this cast grants no DB access.
    const existingAdmin = createAdminClient();
    if (!existingAdmin) return { status: "unconfigured", versions: [], reason: "server_reader_unavailable" };
    const catalogClient = existingAdmin as unknown as SupabaseClient;
    const { data, error } = await catalogClient.from("billing_plan_versions")
      .select("id,plan_id,version,currency,amount_baisa,period_unit,period_count,limits,status,billing_plans!inner(id,code,status)")
      .eq("status", "published")
      .eq("billing_plans.status", "active")
      .order("version", { ascending: false })
      .limit(101);
    if (error) {
      if (error.code === "42501") return { status: "unconfigured", versions: [], reason: "read_permission_missing" };
      if (["42P01", "42703", "PGRST200", "PGRST204", "PGRST205"].includes(error.code)) {
        return { status: "unconfigured", versions: [], reason: "schema_unavailable" };
      }
      return { status: "error", versions: [], reason: "load_failed" };
    }
    if (data && data.length > 100) return { status: "unconfigured", versions: [], reason: "invalid_catalog" };
    return mapPublishedCatalog(data);
  } catch {
    return { status: "error", versions: [], reason: "load_failed" };
  }
}
