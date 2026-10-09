/** Read-only financial qualification. Never grants, reverses or changes service.
 * Mirrors private.billing_verified_collection_history / proven_entitlement_grants
 * (20261008100000). Private SQL views are deliberately not exposed to PostgREST.
 * Keep parity covered by the opt-in PostgreSQL regression, not a new public RPC.
 */
export type FinancialRecord = Record<string, unknown>;
export type FinancialEvidence = {
  attempts: FinancialRecord[]; events: FinancialRecord[]; grants: FinancialRecord[];
  outcomes: FinancialRecord[]; plans: FinancialRecord[];
};
export type FinancialQualification = {
  companyId: string;
  orderId: string;
  state: "proven" | "pending" | "failed" | "reversed" | "requires_review" | "unknown";
  collectionProven: boolean;
  paidThrough: string | null;
  environment: "live" | "test" | null;
  collectedAt: string | null;
};
const scopeKeys = ["company_id", "provider", "provider_account_ref", "provider_environment"] as const;
const sameScope = (a: FinancialRecord, b: FinancialRecord) => scopeKeys.every(k => a[k] === b[k]);
const positiveInteger = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
const timestamp = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
function timestampMicros(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) return null;
  const seconds = Date.parse(m[1] + m[3]);
  // Date.parse alone truncates PostgreSQL's six fractional digits to three.
  return Number.isFinite(seconds) ? BigInt(seconds) * BigInt(1000) + BigInt((m[2] ?? "").padEnd(6, "0")) : null;
}
const sameTime = (a: unknown, b: unknown) => {
  const micros = timestampMicros(a);
  return micros !== null && micros === timestampMicros(b);
};
function rawSummary(event: FinancialRecord): FinancialRecord {
  return event.raw_summary && typeof event.raw_summary === "object" && !Array.isArray(event.raw_summary) ? event.raw_summary as FinancialRecord : {};
}
/** Persisted receiver attestation with the same order/account/environment binding
 * as billing_acceptance_hmac_event. A signed refund flag does NOT prove extent.
 */
function hmacBound(order: FinancialRecord, attempt: FinancialRecord, event: FinancialRecord): boolean {
  const r = rawSummary(event);
  return sameScope(order, attempt) && sameScope(order, event) && attempt.order_id === order.id
    && event.payment_attempt_id === attempt.id && event.amount_baisa_expected === order.amount_baisa
    && event.currency_expected === order.currency && order.currency === "OMR" && order.provider === "paymob"
    && positiveInteger(order.amount_baisa) && positiveInteger(order.provider_amount)
    && order.provider_amount_unit === "paymob_amount" && typeof attempt.provider_order_id === "string" && attempt.provider_order_id.length > 0
    && r.hmac_verified === true && typeof r.signed_owner === "string" && /^[1-9][0-9]{0,15}$/.test(r.signed_owner)
    && positiveInteger(Number(r.signed_owner)) && positiveInteger(r.integration_id)
    && String(r.integration_id) === order.provider_account_ref
    && event.financial_integration_ref === order.provider_account_ref
    && r.provider_order_id === attempt.provider_order_id && r.provider_transaction_id === event.provider_transaction_id
    && typeof event.provider_transaction_id === "string" && event.provider_transaction_id.length > 0
    && r.currency === order.currency && positiveInteger(r.amount_cents) && r.amount_cents <= order.provider_amount
    && ["pending", "success", "error_occured", "is_auth", "is_capture", "is_voided", "is_refunded", "has_parent_transaction", "is_standalone_payment"].every(k => typeof r[k] === "boolean");
}
function standaloneCollection(order: FinancialRecord, attempt: FinancialRecord, event: FinancialRecord): boolean {
  const r = rawSummary(event);
  return event.event_status === "success" && hmacBound(order, attempt, event) && r.amount_cents === order.provider_amount
    && r.pending === false && r.success === true && r.error_occured === false && r.is_auth === false && r.is_capture === false
    && r.is_refunded === false && r.is_voided === false && r.has_parent_transaction === false && r.is_standalone_payment === true;
}
function collectionReceipt(order: FinancialRecord, grant: FinancialRecord, evidence: FinancialEvidence): boolean {
  const a = evidence.attempts.find(a => a.id === grant.payment_attempt_id && a.order_id === order.id && sameScope(order, a));
  const e = evidence.events.find(e => e.id === grant.provider_event_id && e.payment_attempt_id === a?.id && sameScope(order, e));
  const pv = evidence.plans.find(p => p.id === order.plan_version_id);
  if (!a || !e || !pv || !sameScope(order, grant) || grant.order_id !== order.id || order.provider !== "paymob"
    || !["live", "test"].includes(String(order.provider_environment)) || order.currency !== "OMR"
    || !positiveInteger(order.amount_baisa) || e.amount_baisa_expected !== order.amount_baisa || e.currency_expected !== order.currency
    || e.event_status !== "success" || e.provider_transaction_id !== grant.provider_transaction_id
    || !["amount_baisa", "currency", "period_days", "period_unit", "period_count"].every(k => order[k] === pv[k])
    || grant.period_unit !== order.period_unit || grant.period_count !== order.period_count
    || grant.period_days !== (order.period_unit === "day" ? order.period_count : Math.max(Number(order.period_days), 1))
    || !timestamp(grant.applied_paid_through) || !timestamp(grant.applied_at)) return false;
  const outcome = evidence.outcomes.find(x => sameScope(order, x) && x.order_id === order.id && x.payment_attempt_id === a.id
    && x.provider_event_id === e.id && x.entitlement_application_id === grant.id && x.outcome === "granted"
    && x.provider_transaction_id === grant.provider_transaction_id && sameTime(x.applied_paid_through, grant.applied_paid_through));
  if (!outcome) return false;
  if (order.provider_environment === "test" && outcome.authenticity_method === "authorized_synthetic_test") return true;
  return outcome.authenticity_method === "paymob_hmac_verified" && outcome.evidence_marker === "VEL_PAYMOB_SERVER_HMAC_VERIFIED"
    && standaloneCollection(order, a, e);
}
export function qualifyFinancialOrder(requestCompanyId: string, order: FinancialRecord, evidence: FinancialEvidence, now = Date.now()): FinancialQualification {
  const environment = order.provider_environment === "live" || order.provider_environment === "test" ? order.provider_environment : null;
  const unknown: FinancialQualification = { companyId: String(order.company_id), orderId: String(order.id), state: "unknown", collectionProven: false, paidThrough: null, collectedAt: null, environment };
  if (order.company_id !== requestCompanyId || !environment) return unknown;
  const grants = evidence.grants.filter(g => g.order_id === order.id && g.company_id === requestCompanyId);
  const receipts = grants.filter(g => collectionReceipt(order, g, evidence));
  // Schema guarantees one receipt per order. Ambiguous data cannot be qualified.
  const receipt = receipts.length === 1 ? receipts[0] : null;
  const base: FinancialQualification = { ...unknown, collectionProven: Boolean(receipt), collectedAt: receipt ? String(receipt.applied_at) : null };
  if (receipt && receipt.status === "revoked") return { ...base, state: "reversed" };
  const attempts = evidence.attempts.filter(a => a.order_id === order.id && sameScope(order, a));
  const events = evidence.events.filter(e => attempts.some(a => a.id === e.payment_attempt_id && sameScope(order, e)));
  const lifecycleReview = events.some(e => {
    const a = attempts.find(a => a.id === e.payment_attempt_id)!; const r = rawSummary(e);
    return hmacBound(order, a, e) && (r.is_refunded === true || r.is_voided === true);
  });
  const duplicateReview = evidence.outcomes.some(x => x.order_id === order.id && sameScope(order, x)
    && attempts.some(a => a.id === x.payment_attempt_id) && x.outcome === "duplicate_collection_review");
  // C1's first-collection gates persist private review records, not grants or
  // public outcomes. Their bound receipt + existing order blockers suffice to
  // say review is required; never pretend that these are ordinary pending jobs.
  // This reads the policy already enforced in SQL, without approving a deadline.
  const firstCollectionReview = grants.length === 0 && events.some(e => standaloneCollection(order, attempts.find(a => a.id === e.payment_attempt_id)!, e))
    && ((environment === "live" && order.deadline_policy_approved !== true)
      || (timestamp(order.expires_at) && Date.parse(order.expires_at) <= now) || order.status === "cancelled");
  if (lifecycleReview || duplicateReview || firstCollectionReview || ["refunded", "voided"].includes(String(order.status)) || (grants.length > 0 && !receipt)) return { ...base, state: "requires_review" };
  if (receipt && receipt.status === "active" && order.status === "closed" && attempts.some(a => a.id === receipt.payment_attempt_id && a.status === "paid")) {
    return { ...base, state: "proven", paidThrough: String(receipt.applied_paid_through) };
  }
  if (receipt || attempts.some(a => a.status === "paid")) return { ...base, state: "requires_review" };
  const latest = [...attempts].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)))[0];
  if (latest?.status === "failed" || order.status === "failed") return { ...base, state: "failed" };
  if (latest?.status === "provider_submitted" || events.some(e => e.event_status === "pending" || e.event_status === "success")) return { ...base, state: "pending" };
  return base;
}
