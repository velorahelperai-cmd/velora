import "server-only";
import { getCompanyAccess } from "@/lib/tenancy/access";
import { sessionHasCompanyCapability } from "@/lib/access/actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { decideLegacyServiceAccess, denyServiceAccess, isServiceCapability, type ServiceAccessDecision } from "./decision";

/** Session actor only. Caller-supplied companies, personas or billing flags are never accepted. */
export async function readSessionServiceAccess(capability: unknown): Promise<ServiceAccessDecision> {
  if (!isServiceCapability(capability)) return denyServiceAccess("INVALID_INPUT");
  // These product capabilities have no fully enforced RBAC/data surface yet.
  if (capability !== "noura.knowledge.read") return denyServiceAccess("UNSUPPORTED_CAPABILITY");
  try {
    const access = await getCompanyAccess();
    if (!access.ok) return denyServiceAccess(access.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : access.code === "UNAVAILABLE" ? "UNAVAILABLE" : "FORBIDDEN");
    const { company, membership, userId, emailConfirmed, needsCompanyContext } = access.context;
    if (!emailConfirmed || needsCompanyContext || !company || company.status !== "active" || !membership
      || membership.status !== "active" || membership.company_id !== company.id || membership.user_id !== userId
      || !["owner", "staff"].includes(membership.role)) return denyServiceAccess("FORBIDDEN");
    // Existing RPC revalidates session lease, tenant membership and grants.
    // Compat null is unknown and cannot authorize service or privileged data access.
    if (await sessionHasCompanyCapability(company.id, "knowledge.read") !== true) return denyServiceAccess("FORBIDDEN");
    const admin = createAdminClient();
    if (!admin) return denyServiceAccess("UNAVAILABLE");
    const billing = admin as unknown as { rpc(name: "billing_read_company_operational_entitlement", args: { p_company_id: string }): PromiseLike<{ data: unknown; error: unknown }> };
    const { data, error } = await billing.rpc("billing_read_company_operational_entitlement", { p_company_id: company.id });
    if (error) return denyServiceAccess("UNAVAILABLE");
    // Paid evidence is scoped by the existing server RPC. No plan-code prefixes,
    // financial history, feature targets or UI persona are interpreted as grants.
    return decideLegacyServiceAccess(data, Date.now());
  } catch {
    return denyServiceAccess("UNAVAILABLE");
  }
}
