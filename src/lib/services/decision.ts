/** Readiness contract only: catalog targets and persona choices never grant access. */
export const SERVICE_CAPABILITIES = ["noura.knowledge.read", "lina.website.read", "dana.reports.read", "dana.pos.read"] as const;
export type ServiceCapability = typeof SERVICE_CAPABILITIES[number];
export type ServiceAccessCode = "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "UNAVAILABLE" | "SUBSCRIPTION_INACTIVE" | "UNSUPPORTED_CAPABILITY" | "SERVICE_CONTRACT_MISSING";
// No successful decision exists until immutable service grants and activation
// can be read authoritatively. Existing paid status is insufficient evidence.
export type ServiceAccessDecision = { allowed: false; code: ServiceAccessCode };
export const denyServiceAccess = (code: ServiceAccessCode): ServiceAccessDecision => ({ allowed: false, code });
export function isServiceCapability(value: unknown): value is ServiceCapability {
  return typeof value === "string" && (SERVICE_CAPABILITIES as readonly string[]).includes(value);
}
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function decideLegacyServiceAccess(evidence: unknown, now: number): ServiceAccessDecision {
  if (!Number.isFinite(now) || !evidence || typeof evidence !== "object" || Array.isArray(evidence)) return denyServiceAccess("UNAVAILABLE");
  const e = evidence as Record<string, unknown>;
  if (e.ok !== true || typeof e.active !== "boolean" || typeof e.status !== "string" || e.environment !== "live") return denyServiceAccess("UNAVAILABLE");
  if (!e.active || !["active", "cancel_at_period_end"].includes(e.status)) return denyServiceAccess("SUBSCRIPTION_INACTIVE");
  if (typeof e.paid_through !== "string" || !uuid(e.plan_version_id)) return denyServiceAccess("UNAVAILABLE");
  const expires = Date.parse(e.paid_through);
  if (!Number.isFinite(expires)) return denyServiceAccess("UNAVAILABLE");
  if (expires <= now) return denyServiceAccess("SUBSCRIPTION_INACTIVE");
  return denyServiceAccess("SERVICE_CONTRACT_MISSING");
}
