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

  it("does not backdate paid time before delayed actual channel-and-AI readiness", () => {
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
    expect(r.subscriptionStartedAt).toBe(now.toISOString());
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
