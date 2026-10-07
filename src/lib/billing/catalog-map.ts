import type { CatalogTier, CatalogVersion, SubscriptionCatalog } from "./catalog-types";

/** Existing marketing IDs preserved. Unknown DB codes are never guessed or renamed. */
export const CATALOG_TIER_BY_CODE: Readonly<Record<string, CatalogTier>> = {
  support: "level_1", expanded: "level_2", integrated: "level_3",
  level_1: "level_1", level_2: "level_2", level_3: "level_3",
};
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function mapPublishedCatalog(rows: unknown): SubscriptionCatalog {
  if (!Array.isArray(rows)) return { status: "unconfigured", versions: [], reason: "invalid_catalog" };
  const versions: CatalogVersion[] = [];
  for (const input of rows) {
    const row = object(input);
    if (!row || row.status !== "published") continue;
    const plan = object(row.billing_plans);
    if (!plan || plan.status !== "active") continue;
    const tier = typeof plan.code === "string" ? CATALOG_TIER_BY_CODE[plan.code] : undefined;
    if (!tier) return { status: "unconfigured", versions: [], reason: "tier_mapping_missing" };
    const cycle = row.period_count === 1 && row.period_unit === "month" ? "monthly"
      : row.period_count === 1 && row.period_unit === "year" ? "yearly" : null;
    // Monetary integers can arrive as decimal strings from bigint columns.
    const amount = typeof row.amount_baisa === "string" && /^\d+$/.test(row.amount_baisa)
      ? Number(row.amount_baisa) : row.amount_baisa;
    if (!cycle || row.currency !== "OMR" || typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0
      || typeof row.id !== "string" || typeof row.plan_id !== "string"
      || typeof row.version !== "number" || !Number.isSafeInteger(row.version) || row.version < 1) {
      return { status: "unconfigured", versions: [], reason: "invalid_catalog" };
    }
    const previous = versions.find((version) => version.tier === tier && version.cycle === cycle);
    if (previous && previous.planId !== row.plan_id) {
      return { status: "unconfigured", versions: [], reason: "tier_mapping_missing" };
    }
    if (previous && previous.version >= row.version) continue;
    if (previous) versions.splice(versions.indexOf(previous), 1);
    const limits = object(row.limits);
    const quota = limits?.ai_text_responses_per_month;
    versions.push({
      versionId: row.id, planId: row.plan_id, planCode: String(plan.code),
      tier, version: row.version, cycle, currency: "OMR", amountBaisa: amount,
      aiTextResponsesPerMonth: typeof quota === "number" && Number.isSafeInteger(quota) && quota >= 0 ? quota : null,
      quotaEnforcement: "not_verified",
    });
  }
  return versions.length ? { status: "ready", versions } : { status: "empty", versions: [] };
}
