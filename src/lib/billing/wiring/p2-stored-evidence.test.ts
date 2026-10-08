import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  summary: undefined as unknown,
  selects: [] as Array<{ table: string; columns: string }>,
  rpc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: state.rpc,
  from(table: string) {
    const row = table === "billing_orders"
      ? { id: "order", special_reference: "reference", amount_baisa: 5000, provider_account_ref: "71610" }
      : table === "billing_payment_attempts" ? { id: "attempt", order_id: "order" }
      : { id: "event", company_id: "company", payment_attempt_id: "attempt", provider_transaction_id: "800001",
        event_status: "success", provider_account_ref: "71610", amount_baisa_expected: 5000,
        observation_key: "verified-observation", provider_environment: "test", raw_summary: state.summary };
    const query = {
      select(columns: string) { state.selects.push({ table, columns }); return query; },
      eq() { return query; },
      limit() { return query; },
      maybeSingle: async () => ({ data: row, error: null }),
      then(resolve: (result: { data: typeof row[]; error: null }) => unknown) {
        return Promise.resolve({ data: [row], error: null }).then(resolve);
      },
    };
    return query;
  },
}) }));

import { processOwnerOrderEvents } from "./order-event-processing";
import { reconcileStoredBillingEvent } from "@/lib/billing/operations/reconciliation";

function eligibleSummary() {
  return {
    event_status: "success", pending: false, success: true, error_occured: false,
    is_auth: false, is_capture: false, is_voided: false, is_refunded: false,
    has_parent_transaction: false, is_standalone_payment: true,
  };
}

beforeEach(() => {
  state.summary = eligibleSummary();
  state.selects = [];
  state.rpc.mockReset().mockResolvedValue({ data: { outcome: "granted" }, error: null });
  vi.stubEnv("BILLING_PAYMOB_SETTLE_ENABLED", "true");
  vi.stubEnv("BILLING_PAYMOB_LIVE_ENABLED", "false");
  vi.stubEnv("PAYMOB_OMR_CONVERSION_VERIFIED", "true");
  vi.stubEnv("PAYMOB_OMR_UNITS_PER_OMR", "1000");
});
afterEach(() => vi.unstubAllEnvs());

describe("actual stored Paymob evidence loaders", () => {
  it("processes complete newly verified evidence through the actual settlement bridge", async () => {
    await processOwnerOrderEvents("company", "order");
    expect(state.rpc).toHaveBeenCalledWith("billing_settle_paymob_hmac_verified", {
      p_evidence: expect.objectContaining({ company_id: "company", order_id: "order", payment_attempt_id: "attempt",
        provider_transaction_id: "800001", observation_key: "verified-observation" }),
    });
    expect(state.selects.find(row => row.table === "billing_provider_events")?.columns).toContain("raw_summary");
  });

  it("returns the explicit settlement outcome for eligible reconciliation evidence", async () => {
    expect(await reconcileStoredBillingEvent("event")).toEqual({ kind: "done", code: "granted" });
    expect(state.selects.find(row => row.table === "billing_provider_events")?.columns).toContain("raw_summary");
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["legacy incomplete summary", { success: true, pending: false, is_auth: false, is_capture: false }],
    ["missing summary", null],
    ["authorization", { ...eligibleSummary(), is_auth: true }],
    ["capture", { ...eligibleSummary(), is_capture: true }],
    ["refunded", { ...eligibleSummary(), is_refunded: true }],
    ["voided", { ...eligibleSummary(), is_voided: true }],
    ["child transaction", { ...eligibleSummary(), has_parent_transaction: true }],
    ["non-standalone", { ...eligibleSummary(), is_standalone_payment: false }],
    ["string lifecycle flag", { ...eligibleSummary(), is_auth: "false" }],
  ])("never activates a persisted success row with %s", async (_name, summary) => {
    state.summary = summary;
    await processOwnerOrderEvents("company", "order");
    expect(await reconcileStoredBillingEvent("event")).toEqual({ kind: "review", code: "stored_evidence_requires_reconciliation" });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["57P01", "retry"],
    ["08006", "retry"],
    ["settle_rpc_failed", "retry"],
    ["XX000", "retry"],
    ["unexpected_backend_failure", "retry"],
    ["PGRST202", "blocked"],
    ["42P01", "blocked"],
    ["P0001", "review"],
    ["22023", "review"],
    ["23505", "review"],
  ])("classifies settlement RPC failure %s as %s for the durable worker", async (code, kind) => {
    state.rpc.mockResolvedValue({ data: null, error: { code } });
    expect(await reconcileStoredBillingEvent("event")).toEqual({ kind, code });
  });

  it("keeps a malformed successful RPC response in review", async () => {
    state.rpc.mockResolvedValue({ data: null, error: null });
    expect(await reconcileStoredBillingEvent("event")).toEqual({ kind: "review", code: "settle_result_invalid" });
  });
});
