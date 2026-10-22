/** Display-only projection of immutable audit payloads.
 * Free-form strings are denied by default: regexes cannot identify every secret.
 * This does not rewrite stored events or attest that producers/logs are compliant.
 */
const REDACTED = "[REDACTED]";
const sensitiveKey = /password|token|secret|auth|bearer|apikey|credential|privatekey|card|cvv|session|phone|mobile|telephone|email|contact|fullname|displayname/i;
const safeEnums: Record<string, ReadonlySet<string>> = {
  role: new Set(["owner", "delegated", "support", "finance", "operations", "staff", "member"]),
  status: new Set(["active", "disabled", "open", "in_progress", "waiting_customer", "resolved", "closed", "pending", "approved", "rejected", "ended", "past_due"]),
  priority: new Set(["low", "medium", "high", "urgent"]),
  category: new Set(["onboarding", "billing", "technical", "channel", "ai", "other"]),
  currency: new Set(["OMR"]),
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function redactSensitiveData(value: unknown): unknown {
  const seen = new WeakSet<object>();
  function visit(item: unknown, key = ""): unknown {
    const normalized = key.replace(/[_\-\s]/g, "");
    if (sensitiveKey.test(normalized)) return REDACTED;
    if (typeof item === "string") {
      if (safeEnums[key]?.has(item)) return item;
      if ((key === "id" || /_id$/.test(key)) && uuid.test(item)) return item;
      if (/_at$/.test(key) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(item) && Number.isFinite(Date.parse(item))) return item;
      return REDACTED;
    }
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") return Number.isFinite(item) ? item : REDACTED;
    if (!item || typeof item !== "object") return REDACTED;
    if (seen.has(item)) return REDACTED;
    seen.add(item);
    const result = Array.isArray(item)
      ? item.map(entry => visit(entry, key))
      : Object.fromEntries(Object.entries(item).map(([field, entry]) => [field, visit(entry, field)]));
    seen.delete(item);
    return result;
  }
  return visit(value);
}
