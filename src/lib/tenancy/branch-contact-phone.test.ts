import { expect, it, vi } from "vitest";
vi.mock("@/lib/billing/es02/account-order-actions", () => ({ beginAccountPaymentAction: vi.fn() }));
import { createPreparationBranch, emptyPreparation, normalizeOptionalBranchContactPhone, validatePreparation, type Preparation } from "./prepayment-preparation";
import { createSetupPlanJourney } from "@/components/app/setup-plan-journey";
import { buildReviewModel } from "@/components/app/setup-order-review-model";
const preparation = (): Preparation => ({ ...emptyPreparation(), name: "Phone audit", type: "retail", country: "OM", city: "Muscat", phone: "+96871234567", branches: [{ localId: "main", name: "Main", city: "Muscat" }, { localId: "second", name: "Second", city: "Sur", contactPhone: "+96892123456" }] });
it("keeps blank optional, normalizes Arabic international input, and rejects ambiguous/malformed values", () => {
  expect(normalizeOptionalBranchContactPhone(undefined)).toEqual({ ok: true, value: null });
  expect(normalizeOptionalBranchContactPhone(" ")).toEqual({ ok: true, value: null });
  expect(normalizeOptionalBranchContactPhone("+٩٦٨٩٢١٢٣٤٥٦")).toEqual({ ok: true, value: "+96892123456" });
  for (const value of ["92123456", "123", 123, "\n", "+96892123456 ext1"]) expect(normalizeOptionalBranchContactPhone(value).ok).toBe(false);
});
it("validates each optional branch contact without copying the business phone", () => {
  expect(createPreparationBranch().contactPhone ?? "").toBe("");
  expect(validatePreparation(preparation())).toEqual([]);
  const invalid = preparation(); invalid.branches[1].contactPhone = "123";
  expect(validatePreparation(invalid)).toContain("branches.1.contactPhone");
});
it("creates distinct stable local row identities without deriving them from names or phones", () => {
  const a = createPreparationBranch(), b = createPreparationBranch();
  expect(a.localId).toBeTruthy(); expect(b.localId).not.toBe(a.localId);
});
it("retains contact and identity through snapshots/review while keeping financial selection contact-free", () => {
  const draft = preparation();
  const journey = createSetupPlanJourney({ actor: { accountId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", captureToken: "capture", isCurrent: () => true }, preparation: draft });
  journey.openPlans(); journey.setSlot(0, { persona: "level_3", package: "basic" }); journey.setSlot(1, { persona: "level_2", package: "premium" }); journey.setTerm("yearly"); journey.localReview();
  const snapshot = journey.snapshot();
  expect(snapshot.preview).not.toBeNull();
  expect(JSON.stringify(snapshot.preview)).not.toContain("+96892123456");
  expect(snapshot.preparation.branches[1]).toMatchObject({ localId: "second", contactPhone: "+96892123456" });
  expect(buildReviewModel(snapshot.slots, snapshot.term).rows[1].contactPhone).toBe("+96892123456");
  journey.backToPreparation(); draft.branches.reverse(); journey.replacePreparation(draft); journey.openPlans();
  const moved = journey.snapshot();
  expect(moved.preparation.branches[0].contactPhone).toBe("+96892123456");
  expect(moved.slots[0].persona).toBe("level_2");
  expect(JSON.stringify(moved.preview)).not.toContain("+96892123456");
});
