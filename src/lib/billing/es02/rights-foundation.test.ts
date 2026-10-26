import { describe, expect, it } from "vitest";
import type { Es02ImmutableOffer } from "./contracts";
import {
  buildInitialCreditBalances,
  consumeCreditsPurchasedFirst,
  isEdgePolicyEnabled,
  reconcileInitialActivationClock,
} from "./rights-foundation";

const offer: Es02ImmutableOffer = {
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
      features: [{ id: "faq", label: { ar: "الرد على الأسئلة ومعلومات النشاط", en: "Business information and FAQs" } }],
    },
  ],
};

describe("es02 rights foundation", () => {
  it("keeps INITIAL clock waiting until channel AND actual AI readiness", () => {
    const waiting = reconcileInitialActivationClock({
      companyId: "c1",
      orderGroupId: "g1",
      paymentConfirmedAt: "2026-10-14T00:00:00.000Z",
      entitlementCreatedAt: "2026-10-14T00:00:01.000Z",
      offer,
      firstChannelReady: true,
      actualAiReady: false,
      now: new Date("2026-10-15T00:00:00.000Z"),
    });
    expect(waiting.clockState).toBe("waiting_readiness");
    expect(waiting.subscriptionStartedAt).toBeNull();
  });

  it("readiness permits operation without starting the paid term", () => {
    const now = new Date("2026-11-01T00:00:00.000Z");
    const r = reconcileInitialActivationClock({
      companyId: "local-company",
      orderGroupId: "local-group",
      paymentConfirmedAt: "2026-10-01T00:00:00.000Z",
      entitlementCreatedAt: "2026-10-01T00:00:01.000Z",
      offer,
      firstChannelReady: true,
      actualAiReady: true,
      now,
    });
    expect(r.operationalReady).toBe(true);
    expect(r.clockState).toBe("waiting_readiness");
    expect(r.subscriptionStartedAt).toBeNull();
    expect(r.paidThroughAt).toBeNull();
  });

  it("consumes purchased credits before base and disables unapproved edges", () => {
    const balances = buildInitialCreditBalances({
      companyId: "c1",
      orderGroupId: "g1",
      baseReplies: 1000,
      purchasedReplies: 100,
    });
    const spent = consumeCreditsPurchasedFirst(balances, 50);
    expect(spent.ok).toBe(true);
    if (!spent.ok) return;
    expect(spent.next.find((b) => b.kind === "purchased")?.remaining).toBe(50);
    expect(isEdgePolicyEnabled("extra_reply_price")).toBe(false);
  });
});


// Synthetic native-receipt facts for the pure calculator; not provider or DB proof.
const readyInput = {
  companyId: "local-company",
  orderGroupId: "local-group",
  paymentConfirmedAt: "2026-10-01T00:00:00.000Z",
  entitlementCreatedAt: "2026-10-01T00:00:01.000Z",
  offer,
  firstChannelReady: true,
  actualAiReady: true,
  now: new Date("2026-11-01T00:01:00.000Z"),
};
const acceptedReply = {
  authority: "native_provider_acceptance" as const,
  companyId: readyInput.companyId,
  orderGroupId: readyInput.orderGroupId,
  jobId: "125b754e-f88f-4acc-9772-f569ee903206",
  intentId: "17a99a8b-8f6c-46cf-b49b-d5f5c3e07952",
  providerMessageId: "wamid.synthetic.acceptance",
  acceptedAt: "2026-11-01T00:00:00.000Z",
  usageMode: "company_live" as const,
  recipientClass: "real_customer" as const,
};

describe("ES02 first real accepted reply clock", () => {
  it("starts at persisted acceptance time rather than reconciliation time", () => {
    const r = reconcileInitialActivationClock({ ...readyInput, acceptedOperationalReply: acceptedReply });
    expect(r.clockState).toBe("active");
    expect(r.subscriptionStartedAt).toBe(acceptedReply.acceptedAt);
    expect(r.paidThroughAt).toBe("2026-12-08T00:00:00.000Z");
  });

  it.each([
    { ...acceptedReply, recipientClass: "test_number" as const },
    { ...acceptedReply, recipientClass: "unknown" as const },
    { ...acceptedReply, usageMode: "setup_trial" as const },
    { ...acceptedReply, companyId: "foreign-company" },
    { ...acceptedReply, orderGroupId: "foreign-order-group" },
    { ...acceptedReply, acceptedAt: "2026-12-01T00:00:00.000Z" },
    { ...acceptedReply, acceptedAt: "2026-09-01T00:00:00.000Z" },
    { ...acceptedReply, acceptedAt: "not-a-timestamp" },
    { ...acceptedReply, providerMessageId: "" },
    { ...acceptedReply, providerMessageId: "bad receipt" },
    { ...acceptedReply, jobId: "not-a-native-job-id" },
    { ...acceptedReply, intentId: "not-a-native-intent-id" },
  ])("does not start from excluded or unbound receipt %j", (receipt) => {
    const r = reconcileInitialActivationClock({ ...readyInput, acceptedOperationalReply: receipt });
    expect(r.clockState).toBe("waiting_readiness");
    expect(r.subscriptionStartedAt).toBeNull();
    expect(r.paidThroughAt).toBeNull();
  });

  it.each([
    { firstChannelReady: false, actualAiReady: true },
    { firstChannelReady: true, actualAiReady: false },
    { firstChannelReady: false, actualAiReady: false },
  ])("preserves historical real acceptance after readiness is revoked: %j", (currentReadiness) => {
    const r = reconcileInitialActivationClock({ ...readyInput, ...currentReadiness, acceptedOperationalReply: acceptedReply });
    expect(r.operationalReady).toBe(false);
    expect(r.clockState).toBe("active");
    expect(r.subscriptionStartedAt).toBe(acceptedReply.acceptedAt);
    expect(r.paidThroughAt).toBe("2026-12-08T00:00:00.000Z");
  });

  it("does not treat lost readiness as acceptance evidence", () => {
    const r = reconcileInitialActivationClock({ ...readyInput, firstChannelReady: false, actualAiReady: false });
    expect(r.operationalReady).toBe(false);
    expect(r.clockState).toBe("waiting_readiness");
    expect(r.subscriptionStartedAt).toBeNull();
    expect(r.paidThroughAt).toBeNull();
  });

  it("keeps the original clock on replay instead of restarting or extending it", () => {
    const existing = reconcileInitialActivationClock({ ...readyInput, acceptedOperationalReply: acceptedReply });
    const r = reconcileInitialActivationClock({
      ...readyInput, now: new Date("2026-11-10T00:00:00.000Z"), existing,
      acceptedOperationalReply: { ...acceptedReply, acceptedAt: "2026-11-09T00:00:00.000Z" },
    });
    expect(r.subscriptionStartedAt).toBe(acceptedReply.acceptedAt);
    expect(r.paidThroughAt).toBe(existing.paidThroughAt);
  });

  it("does not erase the started clock when readiness is later lost", () => {
    const existing = reconcileInitialActivationClock({ ...readyInput, acceptedOperationalReply: acceptedReply });
    const r = reconcileInitialActivationClock({ ...readyInput, firstChannelReady: false, existing });
    expect(r.operationalReady).toBe(false);
    expect(r.clockState).toBe("active");
    expect(r.subscriptionStartedAt).toBe(existing.subscriptionStartedAt);
    expect(r.paidThroughAt).toBe(existing.paidThroughAt);
  });

  it("does not reuse another company's active clock", () => {
    const existing = { ...reconcileInitialActivationClock({ ...readyInput, acceptedOperationalReply: acceptedReply }), companyId: "foreign-company" };
    expect(() => reconcileInitialActivationClock({ ...readyInput, existing })).toThrow("ACTIVATION_SCOPE_MISMATCH");
  });
});
