import type { AdminAIState } from "./admin-types";

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const metric = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const count = (v: unknown) => metric(v) && Number.isSafeInteger(v);
const nullableMetric = (v: unknown) => v === null || metric(v);
const nullableCount = (v: unknown) => v === null || count(v);

/** Validate the SQL JSON snapshot without replacing unknown evidence with zero. */
export function isAdminAIState(value: unknown): value is AdminAIState {
  if (!object(value) || !object(value.budget) || !Array.isArray(value.companies)
    || !Array.isArray(value.models) || !Array.isArray(value.recent)) return false;
  const budget = value.budget;
  if (![budget.limit_baisa, budget.spent_baisa, budget.held_baisa].every(metric) || typeof budget.enabled !== "boolean") return false;
  if (!value.companies.every(row => object(row) && [row.id, row.name, row.status].every(v => typeof v === "string"))) return false;
  if (!value.models.every(row => object(row) && typeof row.model_id === "string"
    && count(row.attempts) && count(row.succeeded) && metric(row.cost_baisa))) return false;
  return value.recent.every(row => object(row)
    && [row.id, row.company_id, row.model_id, row.status, row.created_at].every(v => typeof v === "string")
    && metric(row.reserved_baisa) && nullableMetric(row.cost_baisa) && nullableMetric(row.cost_usd)
    && [row.prompt_tokens, row.completion_tokens, row.cached_tokens, row.reasoning_tokens, row.latency_ms].every(nullableCount)
    && ["cache_write_tokens", "total_tokens"].every(key => row[key] === undefined || nullableCount(row[key]))
    && [row.error_code, row.request_id].every(v => v === null || typeof v === "string")
    && ["response_id", "actual_model_id", "reconciled_at", "reconciliation_evidence"].every(key => row[key] === undefined || row[key] === null || typeof row[key] === "string"));
}
