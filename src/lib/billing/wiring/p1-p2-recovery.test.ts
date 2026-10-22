// General recovery outcomes use synthetic Live scope; hosted Test never invokes settlement.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  environment: "test", orderEnvironment: "test", status: "success", summary: {} as Record<string, unknown>,
  rpc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: state.rpc,
  from(table: string) {
    const row = table === "billing_orders"
      ? { id: "order", company_id: "tenant", special_reference: "reference", amount_baisa: 5000,
        provider_account_ref: "901", provider_environment: state.orderEnvironment, currency: "OMR" }
      : table === "billing_payment_attempts" ? { id: "attempt", order_id: "order", company_id: "tenant" }
      : { id: "event", company_id: "tenant", payment_attempt_id: "attempt", provider_transaction_id: "910001",
        event_status: state.status, provider_account_ref: "901", amount_baisa_expected: 5000, currency_expected: "OMR",
        observation_key: "verified", provider_environment: state.environment, raw_summary: state.summary };
    let included = true;
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { if ((row as Record<string, unknown>)[key] !== value) included = false; return query; },
      in(key: string, values: unknown[]) { if (!values.includes((row as Record<string, unknown>)[key])) included = false; return query; },
      limit() { return query; },
      maybeSingle: async () => ({ data: included ? row : null, error: null }),
      then(resolve: (result: { data: typeof row[]; error: null }) => unknown) {
        return Promise.resolve({ data: included ? [row] : [], error: null }).then(resolve);
      },
    };
    return query;
  },
}) }));

import { processOwnerOrderEvents } from "./order-event-processing";
import { reconcileStoredBillingEvent } from "../operations/reconciliation";

function successSummary() {
  return { event_status: "success", hmac_verified: true, pending: false, success: true, error_occured: false,
    is_auth: false, is_capture: false, is_refunded: false, is_voided: false, has_parent_transaction: false,
    is_standalone_payment: true };
}
beforeEach(() => {
  state.environment = state.orderEnvironment = "live"; state.status = "success"; state.summary = successSummary();
  state.rpc.mockReset().mockResolvedValue({ data: { ok: true, outcome: "granted" }, error: null });
  vi.stubEnv("BILLING_PAYMOB_SETTLE_ENABLED", "true"); vi.stubEnv("BILLING_PAYMOB_LIVE_ENABLED", "true");
  vi.stubEnv("PAYMOB_OMR_CONVERSION_VERIFIED", "true"); vi.stubEnv("PAYMOB_OMR_UNITS_PER_OMR", "1000");
});
afterEach(() => vi.unstubAllEnvs());

describe("durable P1/P2 receipt recovery", () => {
  it("blocks Live recovery until the explicit Live flag is enabled", async () => {
    vi.stubEnv("BILLING_PAYMOB_LIVE_ENABLED", "false");
    state.environment = state.orderEnvironment = "live";
    await processOwnerOrderEvents("tenant", "order");
    expect(await reconcileStoredBillingEvent("event")).toEqual({ kind: "blocked", code: "live_disabled" });
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each(["refunded", "voided"])("recovers a verified Live %s with its actual scope and status", async status => {
    state.environment = state.orderEnvironment = "live"; state.status = status;
    state.summary = { ...successSummary(), event_status: "other", is_refunded: status === "refunded", is_voided: status === "voided" };
    vi.stubEnv("BILLING_PAYMOB_LIVE_ENABLED", "true");
    state.rpc.mockResolvedValue({ data: { ok: true, outcome: "lifecycle_review" }, error: null });
    await processOwnerOrderEvents("tenant", "order");
    expect(state.rpc).toHaveBeenCalledWith("billing_settle_live_paymob_hmac_verified", {
      p_evidence: expect.objectContaining({ provider_environment: "live", event_status: status,
        company_id: "tenant", order_id: "order", provider_transaction_id: "910001" }),
    });
    expect(await reconcileStoredBillingEvent("event")).toEqual({ kind: "review", code: "lifecycle_review" });
  });
  it.each(["lifecycle_review", "late_payment_review", "deadline_policy_review"])("keeps %s in review", async outcome => {
    state.rpc.mockResolvedValue({ data: { ok: true, outcome }, error: null });
    expect(await reconcileStoredBillingEvent("event")).toEqual({ kind: "review", code: outcome });
  });
  it("keeps settlement off for the worker as well as owner recovery", async () => {
    vi.stubEnv("BILLING_PAYMOB_SETTLE_ENABLED", "false");
    await processOwnerOrderEvents("tenant", "order");
    expect(await reconcileStoredBillingEvent("event")).toEqual({ kind: "blocked", code: "settle_disabled" });
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("never recovers a lifecycle row without the stored HMAC attestation", async () => {
    state.status = "refunded"; state.summary = { ...successSummary(), hmac_verified: false, is_refunded: true };
    await processOwnerOrderEvents("tenant", "order");
    expect(await reconcileStoredBillingEvent("event")).toEqual({ kind: "review", code: "stored_evidence_requires_reconciliation" });
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("refuses a stored receipt whose environment differs from the order", async () => {
    state.environment = "test"; vi.stubEnv("BILLING_PAYMOB_LIVE_ENABLED", "true");
    await processOwnerOrderEvents("tenant", "order");
    expect(await reconcileStoredBillingEvent("event")).toEqual({ kind: "review", code: "provider_scope_binding_mismatch" });
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each(["INVALID_STORED_EVIDENCE", "INVALID_REVERSAL_EVIDENCE"])("does not retry permanent evidence rejection %s", async code => {
    state.rpc.mockResolvedValue({ data: { ok: false, code }, error: null });
    expect(await reconcileStoredBillingEvent("event")).toEqual({ kind: "review", code });
  });
});

it("durable Test recovery is blocked permanently without invoking entitlement RPC",async()=>{state.environment=state.orderEnvironment="test";expect(await reconcileStoredBillingEvent("event")).toEqual({kind:"blocked",code:"hosted_test_no_entitlement"});expect(state.rpc).not.toHaveBeenCalled();});
