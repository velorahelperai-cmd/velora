import "server-only";
import { getCompanyAccess } from "@/lib/tenancy/access";
import { sessionHasCompanyCapability } from "@/lib/access/actions";
import { createClient } from "@/lib/supabase/server";
import { decideServiceAccess, denyServiceAccess, isServiceCapability, type ServiceAccessDecision } from "./decision";

/** Session actor only. Caller-supplied companies, personas or billing flags are never accepted. */
export async function readSessionServiceAccess(capability: unknown): Promise<ServiceAccessDecision> {
  if (!isServiceCapability(capability)) return denyServiceAccess("INVALID_INPUT");
  // These product capabilities have no fully enforced RBAC/data surface yet.
  if (capability !== "noura.knowledge.read") return denyServiceAccess("UNSUPPORTED_CAPABILITY");
  try {
    const access = await getCompanyAccess();
    if (!access.ok) return denyServiceAccess(access.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : access.code === "UNAVAILABLE" ? "UNAVAILABLE" : "FORBIDDEN");
    // Shared emailConfirmed field means verified email OR phone identity.
    const { company, membership, userId, emailConfirmed, needsCompanyContext } = access.context;
    if (!emailConfirmed || needsCompanyContext || !company || company.status !== "active" || !membership
      || membership.status !== "active" || membership.company_id !== company.id || membership.user_id !== userId
      || !["owner", "staff"].includes(membership.role)) return denyServiceAccess("FORBIDDEN");
    // Existing RBAC is an early deny; the service RPC independently checks the lease.
    // Compat null is unknown and cannot authorize service or privileged data access.
    if (await sessionHasCompanyCapability(company.id, "knowledge.read") !== true) return denyServiceAccess("FORBIDDEN");
    const session = await createClient();
    const service = session as unknown as { rpc(name: "billing_read_service_access", args: { p_company_id: string; p_capability: string }): PromiseLike<{ data: unknown; error: unknown }> };
    const { data, error } = await service.rpc("billing_read_service_access", { p_company_id: company.id, p_capability: capability });
    if (error) return denyServiceAccess("UNAVAILABLE");
    // This session-only RPC independently rechecks lease, actor and tenant/RBAC;
    // it derives service evidence solely from immutable offers and verified receipts.
    return decideServiceAccess(data, company.id, capability, Date.now());
  } catch {
    return denyServiceAccess("UNAVAILABLE");
  }
}
