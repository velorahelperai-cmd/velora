/** Only implemented capability surfaces are grantable; product targets are not grants. */
export const SERVICE_CAPABILITIES = ["noura.knowledge.read", "lina.website.read", "dana.reports.read", "dana.pos.read"] as const;
export type ServiceCapability = typeof SERVICE_CAPABILITIES[number];
export type ServiceAccessCode = "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "UNAVAILABLE" | "SUBSCRIPTION_INACTIVE" | "UNSUPPORTED_CAPABILITY" | "SERVICE_CONTRACT_MISSING" | "SERVICE_NOT_ACTIVE";
export type ServiceAccessDecision = { allowed: false; code: ServiceAccessCode } | {
  allowed: true; service: "noura"; tier: "basic" | "premium"; capability: "noura.knowledge.read"; expiresAt: string; planVersionId: string;
};
export const denyServiceAccess = (code: ServiceAccessCode): ServiceAccessDecision => ({ allowed: false, code });
export function isServiceCapability(value: unknown): value is ServiceCapability {
  return typeof value === "string" && (SERVICE_CAPABILITIES as readonly string[]).includes(value);
}
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const denied = new Set<ServiceAccessCode>(["INVALID_INPUT", "UNAUTHENTICATED", "FORBIDDEN", "UNAVAILABLE", "SUBSCRIPTION_INACTIVE", "UNSUPPORTED_CAPABILITY", "SERVICE_CONTRACT_MISSING", "SERVICE_NOT_ACTIVE"]);
/** Parse only the authoritative service RPC, never a generic paid or catalog result. */
export function decideServiceAccess(evidence: unknown, companyId: string, capability: ServiceCapability, now: number): ServiceAccessDecision {
  if (!Number.isFinite(now) || !uuid(companyId) || !evidence || typeof evidence !== "object" || Array.isArray(evidence)) return denyServiceAccess("UNAVAILABLE");
  const e = evidence as Record<string, unknown>;
  if (e.ok === false && denied.has(e.code as ServiceAccessCode)) return denyServiceAccess(e.code as ServiceAccessCode);
  if (e.ok !== true || e.allowed !== true || e.company_id !== companyId || e.capability !== capability
    || capability !== "noura.knowledge.read" || e.service_code !== "noura" || e.environment !== "live"
    || (e.tier !== "basic" && e.tier !== "premium") || !uuid(e.plan_version_id) || typeof e.expires_at !== "string") return denyServiceAccess("UNAVAILABLE");
  const expires = Date.parse(e.expires_at);
  if (!Number.isFinite(expires)) return denyServiceAccess("UNAVAILABLE");
  if (expires <= now) return denyServiceAccess("SERVICE_NOT_ACTIVE");
  return { allowed: true, service: "noura", tier: e.tier as "basic" | "premium", capability, expiresAt: e.expires_at, planVersionId: e.plan_version_id };
}
