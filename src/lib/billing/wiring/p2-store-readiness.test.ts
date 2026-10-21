// Infrastructure settlement/binding cases use synthetic Live scope; Test is evidence-only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ admin: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: state.admin }));
import { findOrderByProviderOrderId, insertProviderEvent, settleHmacVerifiedViaRpc } from "./store";

afterEach(() => vi.unstubAllEnvs());

describe("settlement RPC evidence boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.admin.mockReturnValue({ rpc: state.rpc });
  });

  it.each([null, undefined, {}, [], { outcome: null }, { outcome: 42 }])(
    "does not claim entitlement from a malformed RPC result %j", async data => {
      state.rpc.mockResolvedValue({ data, error: null });
      expect(await settleHmacVerifiedViaRpc({provider_environment:"live"})).toEqual({ ok: false, code: "settle_result_invalid" });
    },
  );

  it("does not infer successful replay from an arbitrary database error", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "connection already closed" } });
    expect(await settleHmacVerifiedViaRpc({provider_environment:"live"})).toEqual({ ok: false, code: "XX000" });
  });
  it("preserves the P1 RPC's explicit evidence rejection", async () => {
    state.rpc.mockResolvedValue({ data: { ok: false, code: "INVALID_STORED_EVIDENCE" }, error: null });
    expect(await settleHmacVerifiedViaRpc({provider_environment:"live"})).toEqual({ ok: false, code: "INVALID_STORED_EVIDENCE" });
  });

  it.each(["granted", "idempotent_replay", "duplicate_collection_review"])(
    "preserves explicit settlement outcome %s", async outcome => {
      state.rpc.mockResolvedValue({ data: { outcome }, error: null });
      expect(await settleHmacVerifiedViaRpc({provider_environment:"live"})).toEqual({ ok: true, outcome });
    },
  );
});

describe("persisted order identity boundary", () => {
  const order = { id: "order", company_id: "company", special_reference: "reference", amount_baisa: 9000,
    currency: "OMR", provider_amount: 9000, provider_account_ref: "123", provider_environment: "live", status: "submitted" };
  function configure(row: Record<string, unknown>, ambiguous = false) {
    vi.stubEnv("PAYMOB_MERCHANT_OWNER_ID", "456");
    vi.stubEnv("PAYMOB_INTEGRATION_ID_LIVE", "123");
    vi.stubEnv("PAYMOB_INTEGRATION_ID_TEST", "999");
    state.admin.mockReturnValue({ from: (table: string) => {
      let limit = 0;
      const query = { select: () => query, eq: () => query, order: () => query, limit: (n: number) => { limit = n; return query; },
        maybeSingle: async () => table === "billing_orders" ? { data: row, error: null } :
          ambiguous && limit > 1 ? { data: null, error: { code: "PGRST116" } } :
          { data: { id: "attempt", order_id: "order", company_id: "company", provider_order_id: "987", status: "provider_submitted" }, error: null } };
      return query;
    } });
  }
  it.each([
    { currency: "EGP" }, { provider_environment: "unknown" }, { amount_baisa: Number.MAX_SAFE_INTEGER + 1 },
    { provider_amount: -1 },
  ])("does not invent OMR/test binding for invalid persisted data %j", async difference => {
    configure({ ...order, ...difference });
    expect(await findOrderByProviderOrderId("987")).toBeNull();
  });
  it("fails closed instead of selecting a tenant when provider id is ambiguous", async () => {
    configure(order, true);
    expect(await findOrderByProviderOrderId("987")).toBeNull();
  });
  it("returns an unambiguous persisted binding without changing its tenant", async () => {
    configure(order);
    expect(await findOrderByProviderOrderId("987")).toMatchObject({ companyId: "company", orderId: "order", paymentAttemptId: "attempt", providerAmount: 9000 });
  });
});

describe("duplicate durable event tenant binding", () => {
  const row = {
    companyId: "company-a", paymentAttemptId: "attempt-a", providerTransactionId: "txn", eventStatus: "success" as const,
    observationKey: "obs", providerAccountRef: "123", providerEnvironment: "live" as const, amountBaisaExpected: 9000,
    currencyExpected: "OMR" as const, rawSummary: {},
  };
  function configure(existing: Record<string, unknown>) {
    const inserted = { select: () => inserted, single: async () => ({ data: null, error: { code: "23505" } }) };
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: existing, error: null }) };
    state.admin.mockReturnValue({ from: () => ({ insert: () => inserted, ...query }) });
  }
  it.each([
    { company_id: "company-b" }, { payment_attempt_id: "attempt-b" },
    { amount_baisa_expected: 9001 }, { currency_expected: "EGP" },
  ])("rejects a duplicate whose stored binding differs: %j", async difference => {
    configure({ id: "event", company_id: "company-a", payment_attempt_id: "attempt-a", amount_baisa_expected: 9000, currency_expected: "OMR", ...difference });
    expect(await insertProviderEvent(row)).toEqual({ ok: false, code: "duplicate_binding_mismatch" });
  });
  it("reuses a duplicate only when its original tenant and financial binding match", async () => {
    configure({ id: "event", company_id: "company-a", payment_attempt_id: "attempt-a", amount_baisa_expected: 9000, currency_expected: "OMR" });
    expect(await insertProviderEvent(row)).toEqual({ ok: true, inserted: false, eventId: "event" });
  });
});
