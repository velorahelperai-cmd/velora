import { describe, expect, it } from "vitest";
import { listApprovedEs02BaseOffers, resolveEs02Offer } from "./commercial-offer";
import { ES02_CATALOG_REVISION } from "./contracts";

describe("es02 commercial offer", () => {
  it("exposes twelve approved BASE terms from six plans", () => {
    expect(listApprovedEs02BaseOffers()).toHaveLength(12);
  });

  it("rejects forged amount, revision, and slot count", () => {
    expect(
      resolveEs02Offer({
        term: "monthly",
        slots: [{ persona: "level_1", package: "basic" }],
        claimedAmountBaisa: 1,
      }),
    ).toEqual({ ok: false, code: "OFFER_TAMPER" });
    expect(
      resolveEs02Offer({
        term: "monthly",
        slots: [{ persona: "level_1", package: "basic" }],
        claimedCatalogRevision: "forged",
      }),
    ).toEqual({ ok: false, code: "OFFER_TAMPER" });
    expect(
      resolveEs02Offer({
        term: "monthly",
        slots: [{ persona: "level_1", package: "basic" }],
        claimedBranchSlots: 2,
      }),
    ).toEqual({ ok: false, code: "OFFER_TAMPER" });
  });

  it("sums per-branch slot prices under one term (channels ≠ branch slots)", () => {
    const resolved = resolveEs02Offer({
      term: "monthly",
      slots: [
        { persona: "level_1", package: "basic" },
        { persona: "level_2", package: "basic" },
      ],
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.offer.catalogRevision).toBe(ES02_CATALOG_REVISION);
    expect(resolved.offer.branchSlots).toBe(2);
    expect(resolved.offer.amountBaisa).toBe(45000 + 65000);
    expect(resolved.offer.channels).toBe(1 + 1);
    expect(resolved.offer.slots).toHaveLength(2);
  });
});
