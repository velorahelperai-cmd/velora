import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadBillingReturnRow, mapBillingReturnDbParts } from "./return-load";
import { mapBillingReturnDisplay, redirectionQueryGrantsEntitlement } from "./return-status";
import { readAdminTruth } from "@/lib/answers/runtime/admin-truth";

import { financialFixture } from "./financial-truth.fixtures";
vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, fail: "", owner: true, companyId: "company-a" }));
vi.mock("@/lib/billing/admin/owner-gate", () => ({billingOwnerGate:async()=>state.owner?{ok:true,binding:{actorId:"synthetic-owner",sessionId:"synthetic-session"}}:{ok:false,code:"forbidden"},recheckBillingOwner:async()=>state.owner}));
vi.mock("@/lib/tenancy/access", () => ({ getCompanyAccess: async () => ({ ok: true, context: { company: { id: state.companyId } } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async () => ({ data: { live_collected_baisa: 9000, test_collected_baisa: 0, settled_orders: 1 }, error: null }),
  from: (table: string) => {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    let start = 0, end = Infinity, sort = "id", ascending = true;
    const run = (single = false) => {
      const data = [...(state.tables[table] ?? [])].filter(r => filters.every(f => f(r)))
        .sort((a, b) => String(a[sort]).localeCompare(String(b[sort])) * (ascending ? 1 : -1)).slice(start, end + 1);
      return Promise.resolve(state.fail === table ? { data: null, error: { code: "XX000" } } : { data: single ? data[0] ?? null : data, error: null });
    };
    const chain = {
      select: () => chain,
      returns: () => chain,
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return chain; },
      in: (k: string, v: unknown[]) => { filters.push(r => v.includes(r[k])); return chain; },
      gte: (k: string, v: string) => { filters.push(r => String(r[k]) >= v); return chain; },
      lt: (k: string, v: string) => { filters.push(r => String(r[k]) < v); return chain; },
      order: (k: string, options?: { ascending: boolean }) => { sort = k; ascending = options?.ascending !== false; return chain; },
      limit: (n: number) => { end = n - 1; return chain; },
      range: (a: number, b: number) => { start = a; end = b; return chain; },
      maybeSingle: () => run(true), then: (resolve: (v: unknown) => unknown) => run().then(resolve),
    };
    return chain;
  },
}) }));
vi.mock("@/lib/answers/runtime/admin-actions", () => ({ readAdminAIState: async () => state.owner
  ? { ok: true, data: { budget: { limit_baisa: 1000, spent_baisa: 0, held_baisa: 0, enabled: false }, companies: [], models: [], recent: [] } }
  : { ok: false, error: "forbidden" } }));

function seed(f = financialFixture()) {
  state.tables = { billing_orders: [f.order], billing_payment_attempts: [f.attempt], billing_provider_events: [f.event], billing_entitlement_applications: [f.grant], billing_settlement_outcomes: [f.outcome], billing_plan_versions: [f.plan] };
  return f;
}
async function display(f: ReturnType<typeof financialFixture>) {
  return mapBillingReturnDisplay({ requestCompanyId: f.order.company_id, row: await loadBillingReturnRow({ requestCompanyId: f.order.company_id, orderId: f.order.id }) });
}
describe("G07 financial truth regression", () => {
  beforeEach(() => { state.fail = ""; state.owner = true; state.companyId = "company-a"; seed(); });
  it("displays success for a complete proven receipt", async () => { expect((await display(financialFixture())).kind).toBe("success"); });
  it("does not mistake authorization for collected payment", async () => {
    const f = seed(); f.event.raw_summary.is_auth = true;
    expect((await display(f)).kind).toBe("requires_review");
  });
  it("does not qualify a legacy grant without settlement evidence", async () => {
    const f = seed(); state.tables.billing_settlement_outcomes = [];
    expect((await display(f)).kind).toBe("requires_review");
  });
  it("requires the receipt and outcome to match at PostgreSQL microsecond precision", async () => {
    const f = seed(); f.grant.applied_paid_through = "2099-01-01T00:00:00.123456+00:00";
    f.outcome.applied_paid_through = "2099-01-01T00:00:00.123457+00:00";
    expect((await display(f)).kind).toBe("requires_review");
  });
  it("accepts the same exact receipt timestamp expressed in equivalent time zones", async () => {
    const f = seed(); f.grant.applied_paid_through = "2099-01-01T04:00:00.123456+04:00";
    f.outcome.applied_paid_through = "2099-01-01T00:00:00.123456Z";
    expect((await display(f)).kind).toBe("success");
  });
  it("preserves the canonical SQL comparison of signed integration JSONB text", async () => {
    const f = seed(); f.event.financial_integration_ref = "71610.0";
    expect((await display(f)).kind).toBe("requires_review");
  });
  it("a bare grant can never produce a successful return", () => {
    const f = financialFixture(); const row = mapBillingReturnDbParts(f.order.company_id, { order: f.order, attempt: f.attempt, latestEvent: f.event, grant: f.grant });
    expect(mapBillingReturnDisplay({ requestCompanyId: f.order.company_id, row }).kind).toBe("requires_review");
  });
  it("preserves a recorded reversal after an old success replay", async () => {
    const f = seed(); f.grant.status = "revoked"; f.order.status = "refunded";
    expect((await display(f)).kind).toBe("reversed");
    const summary = await readAdminTruth(); if (!summary.ok) throw Error(summary.error);
    expect(summary.data.collections).toMatchObject({ live_collected_baisa: 9000, reversed_orders: 1, reversed_collection_baisa: 9000, refund_amount_baisa: null, net_collected_baisa: null });
  });
  it("partial refund evidence requires review without guessing a refund amount", async () => {
    const f = seed(); state.tables.billing_provider_events.push({ ...f.event, id: "refund", event_status: "refunded", observation_key: "refund", raw_summary: { ...f.event.raw_summary, is_refunded: true, amount_cents: 300 } });
    expect((await display(f)).kind).toBe("requires_review");
    const summary = await readAdminTruth(); expect(summary.ok).toBe(true);
    if (summary.ok) expect(summary.data.collections).toMatchObject({ live_collected_baisa: 9000, review_orders: 1, refund_amount_baisa: null, net_collected_baisa: null });
  });
  it("counts original collection once despite a duplicate event", async () => {
    const f = seed(); state.tables.billing_provider_events.push({ ...f.event, id: "replay" });
    expect((await display(f)).kind).toBe("success");
    const summary = await readAdminTruth(); if (!summary.ok) throw Error(summary.error);
    expect(summary.data.collections).toMatchObject({ live_collected_baisa: 9000, settled_orders: 1 });
  });
  it("duplicate collection is review even when the first grant remains active", async () => {
    const f = seed(); state.tables.billing_settlement_outcomes.push({ ...f.outcome, id: "duplicate", outcome: "duplicate_collection_review", provider_transaction_id: "second-transaction" });
    expect((await display(f)).kind).toBe("requires_review");
  });
  it("does not grant from a forged success URL", () => {
    expect(redirectionQueryGrantsEntitlement({ success: "true", hmac: "forged" })).toBe(false);
  });
  it("does not read another company's order", async () => {
    const f = seed(); expect(await loadBillingReturnRow({ requestCompanyId: "other", orderId: f.order.id })).toBeNull();
  });
  it.each(["billing_entitlement_applications", "billing_settlement_outcomes", "billing_provider_events"])("incomplete %s reads cannot claim success or zero revenue", async table => {
    const f = seed(); state.fail = table;
    expect((await display(f)).kind).not.toBe("success");
    expect((await readAdminTruth()).ok).toBe(false);
  });
  it("excludes unproven grants and separates Test from Live gross", async () => {
    const f = seed(); const test = financialFixture("test", "b");
    for (const [table, row] of Object.entries({ billing_orders: test.order, billing_payment_attempts: test.attempt, billing_provider_events: test.event, billing_entitlement_applications: test.grant, billing_settlement_outcomes: test.outcome, billing_plan_versions: test.plan })) state.tables[table].push(row);
    f.event.raw_summary.hmac_verified = false;
    const summary = await readAdminTruth(); if (!summary.ok) throw Error(summary.error);
    expect(summary.data.collections).toMatchObject({ live_collected_baisa: 0, test_collected_baisa: 9000, settled_orders: 0 });
  });
  it("keeps owner authorization before financial reads", async () => { state.owner = false; expect(await readAdminTruth()).toEqual({ ok: false, error: "forbidden" }); });
  it.each(["pending", "failed"])("keeps uncollected %s separate from proven payment", async status => {
    const f = seed(); state.tables.billing_entitlement_applications = []; state.tables.billing_settlement_outcomes = [];
    f.attempt.status = status === "failed" ? "failed" : "provider_submitted";
    f.event.event_status = status; f.event.raw_summary.pending = status === "pending"; f.event.raw_summary.success = false;
    expect((await display(f)).kind).toBe(status === "pending" ? "verifying" : "failed");
    const summary = await readAdminTruth(); if (!summary.ok) throw Error(summary.error);
    expect(summary.data.collections.live_collected_baisa).toBe(0);
    expect(status === "failed" ? summary.data.collections.failed_orders : summary.data.collections.pending_orders).toBe(1);
  });
  it.each(["company_id", "provider_account_ref", "provider_environment", "provider_transaction_id", "amount_baisa_expected", "currency_expected"])("rejects mismatched receipt event %s", async field => {
    const f = seed(); (f.event as Record<string, unknown>)[field] = "mismatch";
    expect((await display(f)).kind).toBe("requires_review");
  });
  it.each(["signed_owner", "amount_cents", "integration_id", "currency", "provider_order_id", "provider_transaction_id"])("rejects mismatched signed financial field %s", async field => {
    const f = seed(); (f.event.raw_summary as Record<string, unknown>)[field] = "mismatch";
    expect((await display(f)).kind).toBe("requires_review");
  });
  it("cannot attach another order's qualified truth to this return", () => {
    const f = financialFixture(); const row = mapBillingReturnDbParts(f.order.company_id, { order: f.order, attempt: f.attempt, latestEvent: f.event, grant: f.grant,
      financial: { companyId: "other", orderId: "other", state: "proven", collectionProven: true, paidThrough: f.grant.applied_paid_through, environment: "live", collectedAt: f.grant.applied_at } });
    expect(mapBillingReturnDisplay({ requestCompanyId: f.order.company_id, row }).kind).toBe("unresolved");
  });
  it("ignores another tenant's refund without corrupting this receipt", async () => {
    const f = seed(); state.tables.billing_provider_events.push({ ...f.event, id: "foreign-refund", company_id: "other", raw_summary: { ...f.event.raw_summary, is_refunded: true } });
    expect((await display(f)).kind).toBe("success");
  });
  it("distinguishes synthetic Test proof from Live", async () => {
    const f = seed(financialFixture("test")); f.outcome.authenticity_method = "authorized_synthetic_test"; f.event.raw_summary.hmac_verified = false;
    expect(await display(f)).toMatchObject({ kind: "success", environment: "test" });
    f.order.provider_environment = "live"; f.attempt.provider_environment = "live"; f.event.provider_environment = "live"; f.grant.provider_environment = "live"; f.outcome.provider_environment = "live";
    expect((await display(f)).kind).toBe("requires_review");
  });
  it("keeps revoked unproven legacy data under review, not verified reversal", async () => {
    const f = seed(); f.grant.status = "revoked"; state.tables.billing_settlement_outcomes = [];
    expect((await display(f)).kind).toBe("requires_review");
  });
  it("reviews an order refund flag without claiming that its active grant was reversed", async () => {
    const f = seed(); f.order.status = "refunded";
    expect((await display(f)).kind).toBe("requires_review");
  });
  it.each(["deadline_unapproved", "expired", "cancelled"])("keeps first collection blocked by C1 %s in review instead of pending", async reason => {
    const f = seed(); state.tables.billing_entitlement_applications = []; state.tables.billing_settlement_outcomes = [];
    f.attempt.status = "provider_submitted"; f.order.status = reason === "cancelled" ? "cancelled" : "submitted";
    Object.assign(f.order, { deadline_policy_approved: reason !== "deadline_unapproved", expires_at: reason === "expired" ? "2020-01-01T00:00:00.000Z" : "2099-01-01T00:00:00.000Z" });
    expect((await display(f)).kind).toBe("requires_review");
  });
  it("does not attribute a historical receipt to this month's gross after a refund", async () => {
    const f = seed(); f.grant.applied_at = "2020-01-01T00:00:00.000Z"; f.order.created_at = f.grant.applied_at;
    state.tables.billing_provider_events.push({ ...f.event, id: "old-receipt-refund", event_status: "refunded", raw_summary: { ...f.event.raw_summary, is_refunded: true, amount_cents: 300 } });
    const summary = await readAdminTruth(); if (!summary.ok) throw Error(summary.error);
    expect(summary.data.collections).toMatchObject({ live_collected_baisa: 0, review_orders: 1, review_collection_baisa: 9000 });
  });
  it("paginates receipts instead of silently truncating the gross metric", async () => {
    seed(); for (let i = 1; i <= 250; i++) {
      const f = financialFixture("live", String(i));
      for (const [table, row] of Object.entries({ billing_orders: f.order, billing_payment_attempts: f.attempt, billing_provider_events: f.event, billing_entitlement_applications: f.grant, billing_settlement_outcomes: f.outcome, billing_plan_versions: f.plan })) state.tables[table].push(row);
    }
    const summary = await readAdminTruth(); if (!summary.ok) throw Error(summary.error);
    expect(summary.data.collections).toMatchObject({ live_collected_baisa: 251 * 9000, settled_orders: 251 });
  });
});
