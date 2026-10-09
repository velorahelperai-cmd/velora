import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { financialDb, readFinancialEvidence, readFinancialCollections } from "../financial-read";
import { qualifyFinancialOrder } from "../financial-truth";
import { loadBillingReturnRow } from "./return-load";
import { mapBillingReturnDisplay } from "./return-status";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }));
// @ts-expect-error Dependency-free local PostgreSQL test harness.
import { appDatabaseAdapter } from "../../../../scripts/billing-acceptance/app-database-adapter.mjs";
// @ts-expect-error Dependency-free local PostgreSQL test harness.
import { fixture, storedEvent, settle } from "../../../../scripts/billing-acceptance/fixtures.mjs";
// @ts-expect-error Dependency-free local PostgreSQL test harness. No remote URL.
import { rows, sql, lit, verifyLocalContainer } from "../../../../scripts/billing-acceptance/postgres.mjs";

describe.skipIf(process.env.BILLING_ACCEPTANCE_POSTGRES_TESTS !== "1")("G07 actual PostgreSQL financial read parity", () => {
  async function prepare(environment: "live" | "test") {
    await verifyLocalContainer(); state.client = appDatabaseAdapter();
    const f = await fixture({ environment, providerOrderId: randomUUID(), deadlinePolicyApproved: true });
    const e = await storedEvent(f, randomUUID()); expect((await settle(e)).outcome).toBe("granted");
    return { f, e };
  }
  it("qualifies Test/Live receipts identically to the canonical SQL proof views and hides foreign orders", async () => {
    for (const environment of ["test", "live"] as const) {
      const { f } = await prepare(environment);
      const [order] = await rows(`SELECT * FROM public.billing_orders WHERE id=${lit(f.orderId)}`);
      const evidence = await readFinancialEvidence(financialDb(state.client as SupabaseClient), [order], f.companyId);
      const truth = qualifyFinancialOrder(f.companyId, order, evidence);
      expect(truth.collectionProven).toBe((await rows(`SELECT id FROM private.billing_verified_collection_history WHERE order_id=${lit(f.orderId)}`)).length === 1);
      expect(truth.state === "proven").toBe((await rows(`SELECT id FROM private.billing_proven_entitlement_grants WHERE order_id=${lit(f.orderId)}`)).length === 1);
      expect(mapBillingReturnDisplay({ requestCompanyId: f.companyId, row: await loadBillingReturnRow({ requestCompanyId: f.companyId, orderId: f.orderId }) })).toMatchObject({ kind: "success", environment });
      expect(await loadBillingReturnRow({ requestCompanyId: randomUUID(), orderId: f.orderId })).toBeNull();
    }
  }, 60000);
  it("preserves partial-refund review and original collection after repeated refund/old success", async () => {
    const { f, e } = await prepare("live");
    const refund = await storedEvent(f, e.provider_transaction_id, { eventStatus: "refunded", observationKey: randomUUID(), flags: { is_refunded: true, amount_cents: 1000 } });
    expect((await settle(refund)).outcome).toBe("lifecycle_review");
    expect((await settle(refund)).outcome).toBe("lifecycle_review");
    expect((await settle(e)).outcome).toBe("lifecycle_review");
    const display = mapBillingReturnDisplay({ requestCompanyId: f.companyId, row: await loadBillingReturnRow({ requestCompanyId: f.companyId, orderId: f.orderId }) });
    expect(display.kind).toBe("requires_review");
    expect(await rows(`SELECT id FROM private.billing_verified_collection_history WHERE order_id=${lit(f.orderId)}`)).toHaveLength(1);
    const summary = await readFinancialCollections(state.client as SupabaseClient);
    const [gross] = await rows(`SELECT coalesce(sum(o.amount_baisa),0)::bigint gross FROM private.billing_verified_collection_history g JOIN public.billing_orders o ON o.id=g.order_id WHERE g.provider_environment='live' AND g.applied_at>=${lit(summary.period_start)}::timestamptz AND g.applied_at<${lit(summary.period_end)}::timestamptz AND g.applied_at<=clock_timestamp()`);
    expect(summary.live_collected_baisa).toBe(Number(gross.gross));
    expect(summary.review_orders).toBeGreaterThan(0); expect(summary.refund_amount_baisa).toBeNull(); expect(summary.net_collected_baisa).toBeNull();
    // Exercise the existing allowed one-way revoked transition; no refund policy
    // is implemented or approved by this synthetic fixture.
    await sql(`SET ROLE service_role; UPDATE public.billing_entitlement_applications SET status='revoked' WHERE order_id=${lit(f.orderId)};`);
    expect(mapBillingReturnDisplay({ requestCompanyId: f.companyId, row: await loadBillingReturnRow({ requestCompanyId: f.companyId, orderId: f.orderId }) }).kind).toBe("reversed");
    expect(await rows(`SELECT id FROM private.billing_verified_collection_history WHERE order_id=${lit(f.orderId)}`)).toHaveLength(1);
    expect(await rows(`SELECT id FROM private.billing_proven_entitlement_grants WHERE order_id=${lit(f.orderId)}`)).toHaveLength(0);
  }, 60000);
});
