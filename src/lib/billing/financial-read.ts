import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { qualifyFinancialOrder, type FinancialEvidence, type FinancialRecord } from "./financial-truth";

// Service SELECT only. No credentials, raw provider payloads or tenant identities
// leave this module. All pagination failures fail closed rather than undercount.
const PAGE = 250, MAX_ROWS = 10000, CHUNK = 100;
type Query = PromiseLike<{ data: unknown; error: unknown }> & {
  eq(k: string, v: string): Query; in(k: string, v: string[]): Query;
  gte(k: string, v: string): Query; lt(k: string, v: string): Query;
  order(k: string, options?: { ascending: boolean }): Query; range(a: number, b: number): Query;
};
type Db = { from(table: string): { select(columns: string): Query } };
export function financialDb(client: SupabaseClient): Db { return client as unknown as Db; }
async function readRows(build: () => Query): Promise<FinancialRecord[]> {
  const rows: FinancialRecord[] = [];
  for (let offset = 0; offset <= MAX_ROWS; offset += PAGE) {
    const { data, error } = await build().order("id", { ascending: true }).range(offset, offset + PAGE - 1);
    if (error || !Array.isArray(data) || data.some(v => !v || typeof v !== "object" || Array.isArray(v))) throw Error("FINANCIAL_READ_UNAVAILABLE");
    rows.push(...data as FinancialRecord[]);
    if (rows.length > MAX_ROWS) throw Error("FINANCIAL_READ_LIMIT");
    if (data.length < PAGE) return rows;
  }
  throw Error("FINANCIAL_READ_LIMIT");
}
async function readByIds(db: Db, table: string, field: string, ids: string[], companyId?: string) {
  const rows: FinancialRecord[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    rows.push(...await readRows(() => {
      // JSON.parse loses JSONB numeric scale. Preserve exactly the signed account
      // text compared by the canonical SQL view (71610.0 must not become 71610).
      const columns = table === "billing_provider_events" ? "*,financial_integration_ref:raw_summary->>integration_id" : "*";
      const query = db.from(table).select(columns).in(field, part);
      return companyId ? query.eq("company_id", companyId) : query;
    }));
    if (rows.length > MAX_ROWS) throw Error("FINANCIAL_READ_LIMIT");
  }
  return rows;
}
const ids = (rows: FinancialRecord[], field: string) => [...new Set(rows.map(r => r[field]).filter((v): v is string => typeof v === "string"))];
export async function readFinancialEvidence(db: Db, orders: FinancialRecord[], companyId?: string): Promise<FinancialEvidence> {
  const orderIds = ids(orders, "id");
  const [attempts, grants, outcomes, plans] = await Promise.all([
    readByIds(db, "billing_payment_attempts", "order_id", orderIds, companyId),
    readByIds(db, "billing_entitlement_applications", "order_id", orderIds, companyId),
    readByIds(db, "billing_settlement_outcomes", "order_id", orderIds, companyId),
    readByIds(db, "billing_plan_versions", "id", ids(orders, "plan_version_id")),
  ]);
  const events = await readByIds(db, "billing_provider_events", "payment_attempt_id", ids(attempts, "id"), companyId);
  return { attempts, grants, outcomes, plans, events };
}
export type FinancialCollections = {
  live_collected_baisa: number; test_collected_baisa: number; settled_orders: number;
  reversed_orders: number; review_orders: number; pending_orders: number; failed_orders: number; unknown_orders: number;
  reversed_collection_baisa: number; review_collection_baisa: number;
  refund_amount_baisa: null; net_collected_baisa: null;
  period_start: string; period_end: string; basis: "verified_gross_collections";
};
export async function readFinancialCollections(client: SupabaseClient, now = new Date()): Promise<FinancialCollections> {
  const db = financialDb(client);
  // Calendar month in Asia/Muscat (UTC+04, no daylight saving). Upper bound also
  // excludes future-dated receipts. Activity counts include older orders whose
  // receipt/webhook was recorded this month, without moving their gross revenue.
  const muscat = new Date(now.getTime() + 4 * 3600000);
  const start = new Date(Date.UTC(muscat.getUTCFullYear(), muscat.getUTCMonth(), 1) - 4 * 3600000).toISOString();
  const end = new Date(Date.UTC(muscat.getUTCFullYear(), muscat.getUTCMonth() + 1, 1) - 4 * 3600000).toISOString();
  const inPeriod = (v: unknown) => typeof v === "string" && Date.parse(v) >= Date.parse(start) && Date.parse(v) < Math.min(Date.parse(end), now.getTime() + 1);
  const periodRows = (table: string, field: string) => readRows(() => db.from(table).select("*").gte(field, start).lt(field, new Date(Math.min(Date.parse(end), now.getTime() + 1)).toISOString()));
  const [newOrders, grants, events] = await Promise.all([periodRows("billing_orders", "created_at"), periodRows("billing_entitlement_applications", "applied_at"), periodRows("billing_provider_events", "received_at")]);
  const eventAttempts = await readByIds(db, "billing_payment_attempts", "id", ids(events, "payment_attempt_id"));
  const orderIds = [...new Set([...ids(newOrders, "id"), ...ids(grants, "order_id"), ...ids(eventAttempts, "order_id")])];
  const orders = await readByIds(db, "billing_orders", "id", orderIds);
  if (orders.length !== orderIds.length) throw Error("FINANCIAL_READ_INCOMPLETE");
  const evidence = await readFinancialEvidence(db, orders);
  const result: FinancialCollections = { live_collected_baisa: 0, test_collected_baisa: 0, settled_orders: 0,
    reversed_orders: 0, review_orders: 0, pending_orders: 0, failed_orders: 0, unknown_orders: 0,
    reversed_collection_baisa: 0, review_collection_baisa: 0, refund_amount_baisa: null, net_collected_baisa: null,
    period_start: start, period_end: end, basis: "verified_gross_collections" };
  for (const order of orders) {
    const truth = qualifyFinancialOrder(String(order.company_id), order, evidence, now.getTime());
    if (truth.collectionProven && inPeriod(truth.collectedAt)) {
      const amount = Number(order.amount_baisa);
      if (truth.environment === "live") { result.live_collected_baisa += amount; result.settled_orders++; }
      if (truth.environment === "test") result.test_collected_baisa += amount;
    }
    if (truth.environment !== "live") continue;
    if (truth.state === "requires_review") result.review_orders++;
    if (truth.state === "reversed") result.reversed_orders++;
    if (truth.state === "pending") result.pending_orders++;
    if (truth.state === "failed") result.failed_orders++;
    if (truth.state === "unknown") result.unknown_orders++;
    if (truth.collectionProven && truth.state === "reversed") result.reversed_collection_baisa += Number(order.amount_baisa);
    if (truth.collectionProven && truth.state === "requires_review") result.review_collection_baisa += Number(order.amount_baisa);
  }
  if (Object.values(result).some(v => typeof v === "number" && (!Number.isSafeInteger(v) || v < 0))) throw Error("FINANCIAL_TOTAL_OUT_OF_RANGE");
  // The ledger does not attest refund extent, fees or net cash. Null is deliberate:
  // these order exposures must never be subtracted as assumed full refunds.
  return result;
}
