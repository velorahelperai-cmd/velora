import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  checkAppSession: vi.fn(),
  userRpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: mocks.getClaims },
    rpc: mocks.userRpc,
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: vi.fn() }),
}));
vi.mock("@/lib/auth/session-guard", () => ({
  checkAppSession: mocks.checkAppSession,
}));
vi.mock("@/lib/logging/logger.mjs", () => ({
  logEvent: vi.fn(),
  withLogContext: (_: unknown, fn: () => unknown) => fn(),
}));

import {
  beginAccountPaymentAction,
  completeOwnedProvisioningAction,
  createAccountBoundOrderAction,
  readOwnedPurchaseRecoveryAction,
  settleAccountOrderPaymobAction,
  settleAccountOrderSyntheticAction,
} from "./account-order-actions";

const accountId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const foreign = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const sessionId = "11111111-2222-4333-8444-555555555555";
const offer = {
  catalogRevision: "2026-10-14",
  persona: "level_1",
  package: "basic",
  term: "monthly",
  amountBaisa: 45000,
  currency: "OMR",
  repliesPerMonth: 1000,
  employees: 2,
  channels: 1,
  branchSlots: 1,
  purpose: "initial_subscription",
  productCode: "velora_subscription",
  slots: [
    {
      slotIndex: 0,
      persona: "level_1",
      package: "basic",
      amountBaisa: 45000,
      repliesPerMonth: 1000,
      employees: 2,
      channels: 1,
    },
  ],
};

describe("es02 account order actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: accountId, session_id: sessionId } },
      error: null,
    });
    mocks.checkAppSession.mockResolvedValue({ ok: true });
  });

  it("validates explicit payment intent without creating an order while provider is deferred", async () => {
    const input = { expectedAccountId: accountId, selection: { term: "monthly" as const, slots: [{ persona: "level_1" as const, package: "basic" as const }] }, consentAccepted: true, clientOpId: sessionId };
    await expect(beginAccountPaymentAction(input)).resolves.toEqual({ ok: false, code: "PAYMOB_EXTERNAL_DEFERRED" });
    expect(mocks.userRpc).not.toHaveBeenCalled();
    await expect(beginAccountPaymentAction({ ...input, consentAccepted: false })).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(beginAccountPaymentAction({ ...input, clientOpId: "invalid" })).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(beginAccountPaymentAction({ ...input, expectedAccountId: foreign })).resolves.toEqual({ ok: false, code: "UNAUTHENTICATED" });
    mocks.checkAppSession.mockResolvedValue({ ok: false });
    await expect(beginAccountPaymentAction(input)).resolves.toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(mocks.userRpc).not.toHaveBeenCalled();
  });

  it("creates account-bound order without accepting business draft fields", async () => {
    mocks.userRpc.mockResolvedValue({
      data: {
        ok: true,
        action: "insert",
        data: {
          orderId: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
          accountId,
          status: "open",
          offer,
          specialReference: "ES02-TESTREF01",
          paymentAttemptId: "66666666-7777-4888-8999-000000000000",
          environment: "test",
          settledAt: null,
          provisionedCompanyId: null,
          originalOrderGroupId: "12121212-3434-4656-8787-909090909090",
        },
      },
      error: null,
    });
    const result = await createAccountBoundOrderAction({
      expectedAccountId: accountId,
      selection: { persona: "level_1", package: "basic", term: "monthly" },
      consentAccepted: true,
      clientOpId: "13131313-1414-4151-8161-171717171717",
    });
    expect(result.ok).toBe(true);
    expect(mocks.userRpc).toHaveBeenCalledWith(
      "es02_create_account_order",
      expect.objectContaining({
        p_slots: [{ persona: "level_1", package: "basic" }],
        p_term: "monthly",
      }),
    );
  });

  it("preserves UNKNOWN after an attempted write with SDK outer503 observation", async () => {
    mocks.userRpc.mockResolvedValue({
      data: null,
      error: { message: "Service Unavailable" },
      status: 503,
    });
    await expect(
      createAccountBoundOrderAction({
        expectedAccountId: accountId,
        selection: { persona: "level_1", package: "basic", term: "monthly" },
        consentAccepted: true,
        clientOpId: "13131313-1414-4151-8161-171717171717",
      }),
    ).resolves.toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("malformed acknowledgement after attempted write remains UNKNOWN", async () => {
    mocks.userRpc.mockResolvedValue({
      data: { ok: true, action: "insert", data: { orderId: "malformed" } },
      error: null,
      status: 200,
    });
    await expect(
      createAccountBoundOrderAction({
        expectedAccountId: accountId,
        selection: { persona: "level_1", package: "basic", term: "monthly" },
        consentAccepted: true,
        clientOpId: "13131313-1414-4151-8161-171717171717",
      }),
    ).resolves.toEqual({ ok: false, code: "UNKNOWN" });
  });

  it.each([null, "<html>upstream lost response</html>", {}, { ok: false, code: "UNRECOGNIZED_REPLY" }])(
    "unstructured or unrecognized create ack remains UNKNOWN: %j",
    async (data) => {
      mocks.userRpc.mockResolvedValue({ data, error: null, status: 200 });
      await expect(
        createAccountBoundOrderAction({
          expectedAccountId: accountId,
          selection: { persona: "level_1", package: "basic", term: "monthly" },
          consentAccepted: true,
          clientOpId: "13131313-1414-4151-8161-171717171717",
        }),
      ).resolves.toEqual({ ok: false, code: "UNKNOWN" });
    },
  );

  it("rejects nonboolean ok and unexpected action without false final success", async () => {
    mocks.userRpc.mockResolvedValue({
      data: {
        ok: "true",
        action: "insert",
        data: {
          orderId: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
          accountId,
          status: "open",
          offer,
          specialReference: "ES02-TESTREF01",
          paymentAttemptId: "66666666-7777-4888-8999-000000000000",
          environment: "test",
          settledAt: null,
          provisionedCompanyId: null,
          originalOrderGroupId: "12121212-3434-4656-8787-909090909090",
        },
      },
      error: null,
      status: 200,
    });
    await expect(
      createAccountBoundOrderAction({
        expectedAccountId: accountId,
        selection: { persona: "level_1", package: "basic", term: "monthly" },
        consentAccepted: true,
        clientOpId: "13131313-1414-4151-8161-171717171717",
      }),
    ).resolves.toEqual({ ok: false, code: "UNKNOWN" });

    mocks.userRpc.mockResolvedValue({
      data: {
        ok: true,
        action: "unexpected",
        data: {
          orderId: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
          accountId,
          status: "open",
          offer,
          specialReference: "ES02-TESTREF01",
          paymentAttemptId: "66666666-7777-4888-8999-000000000000",
          environment: "test",
          settledAt: null,
          provisionedCompanyId: null,
          originalOrderGroupId: "12121212-3434-4656-8787-909090909090",
        },
      },
      error: null,
      status: 200,
    });
    await expect(
      createAccountBoundOrderAction({
        expectedAccountId: accountId,
        selection: { persona: "level_1", package: "basic", term: "monthly" },
        consentAccepted: true,
        clientOpId: "13131313-1414-4151-8161-171717171717",
      }),
    ).resolves.toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("keeps explicit FORBIDDEN denial distinct from unknown write ack", async () => {
    mocks.userRpc.mockResolvedValue({
      data: { ok: false, code: "FORBIDDEN" },
      error: null,
      status: 200,
    });
    await expect(
      createAccountBoundOrderAction({
        expectedAccountId: accountId,
        selection: { persona: "level_1", package: "basic", term: "monthly" },
        consentAccepted: true,
        clientOpId: "13131313-1414-4151-8161-171717171717",
      }),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("rejects foreign actor returned by recovery RPC without overwriting accountId", async () => {
    mocks.userRpc.mockResolvedValue({
      data: {
        ok: true,
        data: {
          accountId: foreign,
          orderId: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
          status: "settled_unprovisioned",
          specialReference: "ES02-FOREIGN-RESULT",
          companyId: null,
          offer,
        },
      },
      error: null,
    });
    expect((await readOwnedPurchaseRecoveryAction({ expectedAccountId: accountId })).ok).toBe(false);
  });

  it("disables customer synthetic settle and keeps Paymob deferred", async () => {
    await expect(settleAccountOrderSyntheticAction()).resolves.toEqual({
      ok: false,
      code: "SYNTHETIC_DISABLED",
    });
    await expect(settleAccountOrderPaymobAction()).resolves.toEqual({
      ok: false,
      code: "PAYMOB_EXTERNAL_DEFERRED",
    });
  });
});


describe("optional branch contact provisioning", () => {
 beforeEach(() => { vi.clearAllMocks(); mocks.getClaims.mockResolvedValue({data:{claims:{sub:accountId,session_id:"11111111-2222-4333-8444-555555555555"}},error:null}); mocks.checkAppSession.mockResolvedValue({ok:true}); });
it("projects optional branch contact canonically without local IDs in paid provisioning", async () => {
  mocks.userRpc.mockResolvedValue({data:{ok:false,code:"NOT_SETTLED"},error:null,status:200});
  await completeOwnedProvisioningAction({expectedAccountId:accountId,orderId:"12121212-3434-4656-8787-909090909090",idempotencyKey:"77777777-8888-4999-8aaa-bbbbbbbbbbbb",preparation:{name:"Local",type:"retail",country:"OM",city:"Muscat",phone:"+96871234567",branches:[{localId:"main",name:"Main",city:"Muscat"},{localId:"second",name:"Other",city:"Sur",contactPhone:"+٩٦٨٩٢١٢٣٤٥٦"}]}});
  expect(mocks.userRpc).toHaveBeenCalledWith("es02_provision_owned_purchase",expect.objectContaining({p_branches:[{name:"Main",city:"Muscat",contact_phone:null},{name:"Other",city:"Sur",contact_phone:"+96892123456"}]}));
});
it("invalid branch contact is rejected before the provisioning RPC", async () => {
  const result=await completeOwnedProvisioningAction({expectedAccountId:accountId,orderId:"12121212-3434-4656-8787-909090909090",idempotencyKey:"77777777-8888-4999-8aaa-bbbbbbbbbbbb",preparation:{name:"Local",type:"retail",country:"OM",city:"Muscat",phone:"+96871234567",branches:[{name:"Other",city:"Sur",contactPhone:"123"}]}});
  expect(result).toMatchObject({ok:false,code:"INVALID_INPUT"});
  expect(mocks.userRpc).not.toHaveBeenCalled();
});

});
