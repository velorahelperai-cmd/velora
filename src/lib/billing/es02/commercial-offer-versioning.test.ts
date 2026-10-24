import { describe, expect, it } from "vitest";
import { resolveEs02Offer } from "./commercial-offer";
import { parseOfferRow } from "./account-order";

function recorded(term: "monthly" | "yearly", amount: number) {
  return { catalogRevision: "2026-10-14", term, slots: [{ slotIndex: 0, persona: "level_3", package: "basic", amountBaisa: amount, repliesPerMonth: 3000, employees: 2, channels: 1 }], branchSlots: 1, amountBaisa: amount, currency: "OMR", purpose: "initial_subscription", productCode: "velora_subscription", repliesPerMonth: 3000, employees: 2, channels: 1, persona: "level_3", package: "basic" };
}
describe("Dana approved new-offer pricing with immutable legacy orders", () => {
  it.each([["monthly", 90000, 75000], ["yearly", 864000, 720000]] as const)("prices new %s offers while preserving recorded old amounts", (term, current, previous) => {
    const frozen = recorded(term, previous);
    expect(parseOfferRow(frozen)).toEqual(frozen);
    const result = resolveEs02Offer({ term, slots: [{ persona: "level_3", package: "basic" }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.offer.amountBaisa).toBe(current);
    expect(result.offer.catalogRevision).not.toBe(frozen.catalogRevision);
    expect(parseOfferRow(result.offer)).toEqual(result.offer);
    expect(parseOfferRow({ ...frozen, amountBaisa: current })).toBeNull();
    expect(resolveEs02Offer({ term, slots: [{ persona: "level_3", package: "basic" }], claimedCatalogRevision: frozen.catalogRevision, claimedAmountBaisa: previous })).toEqual({ ok: false, code: "OFFER_TAMPER" });
  });
  it("keeps the unaffected Noura billing contract and price unchanged", () => {
    const result = resolveEs02Offer({ term: "monthly", slots: [{ persona: "level_1", package: "basic" }] });
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.offer.catalogRevision).toBe("2026-10-14"); expect(result.offer.amountBaisa).toBe(45000); }
  });
  it("rejects an unknown historical revision rather than guessing its price", () => {
    expect(parseOfferRow({ ...recorded("monthly", 75000), catalogRevision: "unknown-revision" })).toBeNull();
  });
});
