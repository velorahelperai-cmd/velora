import { describe, expect, it } from "vitest";
import { emptyPreparation } from "@/lib/tenancy/prepayment-preparation";
import { buildPreparationCheckoutHandoff, sanitizeCheckoutPayload } from "./preparation-handoff";

const accountId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const clientOpId = "11111111-2222-4333-8444-555555555555";
const complete = (branches = [{ name: "الرئيسي", city: "مسقط" }]) => ({
  ...emptyPreparation(),
  name: "متجر الندى",
  type: "retail",
  country: "OM",
  city: "مسقط",
  phone: "+96892123456",
  branches,
});

describe("es02 preparation handoff", () => {
  it("keeps business facts out of checkout handoff", () => {
    const result = buildPreparationCheckoutHandoff({
      accountId,
      preparation: complete(),
      selection: { persona: "level_1", package: "basic", term: "monthly" },
      consentAccepted: true,
      clientOpId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.handoff).not.toHaveProperty("preparation");
    expect(JSON.stringify(result.handoff)).not.toContain("متجر الندى");
    expect(JSON.stringify(result.handoff)).not.toContain("+968");
    expect(result.handoff.offer.amountBaisa).toBe(45000);
    expect(result.handoff.offer.branchSlots).toBe(1);
  });

  it("does not accept two prepared branches against one purchased branch slot", () => {
    const r = buildPreparationCheckoutHandoff({
      accountId,
      clientOpId,
      consentAccepted: true,
      selection: { persona: "level_1", package: "basic", term: "monthly" },
      preparation: complete([
        { name: "A", city: "Muscat" },
        { name: "B", city: "Muscat" },
      ]),
    });
    expect(!r.ok || r.handoff.offer.branchSlots >= 2).toBe(true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SLOT_MISMATCH");
  });

  it("rejects leaked business keys in checkout payload", () => {
    expect(
      sanitizeCheckoutPayload({
        selection: { persona: "level_1", package: "basic", term: "monthly" },
        consentAccepted: true,
        clientOpId,
        preparation: complete(),
      }),
    ).toBeNull();
  });
});
