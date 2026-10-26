import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commercialAmount, commercialPlan, commercialPlans } from "@/components/app/subscription-commercial-catalog";
import { resolveEs02Offer, type Es02OfferSelection } from "@/lib/billing/es02/commercial-offer";
import type { Es02AccountOrderView, Es02Result } from "@/lib/billing/es02/contracts";
import { emptyPreparation, type Preparation } from "@/lib/tenancy/prepayment-preparation";

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
  withLogContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

import { createAccountBoundOrderAction } from "@/lib/billing/es02/account-order-actions";
import {
  createSetupPlanJourney,
  setupPlanBeginPayment,
  type SetupPlanActor,
  type SetupPlanCreateOrder,
  type SetupPlanJourney,
} from "./setup-plan-journey";

const accountId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const otherAccountId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

function preparation(branches: { name: string; city: string }[] = [{ name: "الرئيسي", city: "صور" }]): Preparation {
  return {
    name: "متجر الندى",
    type: "retail",
    country: "OM",
    city: "مسقط",
    phone: "+96892123456",
    branches,
  };
}

function branches(count: number) {
  return Array.from({ length: count }, (_, index) => ({ name: `فرع-${index}`, city: `مدينة-${index}` }));
}

function orderFor(selection: Es02OfferSelection, status: Es02AccountOrderView["status"] = "open"): Es02AccountOrderView {
  const resolved = resolveEs02Offer(selection);
  if (!resolved.ok) throw new Error(resolved.code);
  return {
    orderId: "12121212-3434-4656-8787-909090909090",
    accountId,
    status,
    offer: resolved.offer,
    specialReference: "vel_test_ref",
    paymentAttemptId: "abababab-cdcd-4efe-8f0f-121212121212",
    environment: "test",
    settledAt: status === "settled" ? "2026-10-18T00:00:00.000Z" : null,
    provisionedCompanyId: null,
    originalOrderGroupId: "34343434-5656-4787-8909-090909090909",
  };
}

function success(selection: Es02OfferSelection, status: Es02AccountOrderView["status"] = "open"): Es02Result<{ order: Es02AccountOrderView; action: "insert" | "reuse" }> {
  return { ok: true, data: { order: orderFor(selection, status), action: "insert" } };
}

describe("setup plan journey", () => {
  let sequence = 0;
  beforeEach(() => {
    sequence = 0;
  });

  function nextId() {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  }

  function journey(options?: {
    actor?: SetupPlanActor;
    preparation?: Preparation;
    createOrder?: SetupPlanCreateOrder;
    current?: () => boolean;
  }): SetupPlanJourney {
    const current = options?.current ?? (() => true);
    return createSetupPlanJourney({
      actor: options?.actor ?? { accountId, captureToken: "capture-a", isCurrent: current },
      preparation: options?.preparation ?? preparation(),
      createOrder: options?.createOrder ?? (async () => success({ term: "monthly", slots: [{ persona: "level_1", package: "basic" }] })),
      newClientOpId: nextId,
    });
  }

  function arm(target: SetupPlanJourney, slots: Es02OfferSelection["slots"] = [{ persona: "level_1", package: "basic" }], term: "monthly" | "yearly" = "monthly") {
    expect(target.openPlans().ok).toBe(true);
    slots.forEach((choice, index) => {
      expect(target.setSlot(index, choice).ok).toBe(true);
    });
    expect(target.setTerm(term).ok).toBe(true);
    const review = target.localReview();
    expect(review.ok).toBe(true);
    if (review.ok) expect(review.seam?.confirmWired).toBe(false);
    expect(target.setConsent(true).ok).toBe(true);
    return review;
  }

  it("retains the same checkout URL when confirming an already-created order", async () => {
    const checkoutUrl = "https://om.checkout.paymob.com/?publicKey=om_pk_test_fixture&clientSecret=pi_test_fixture";
    const createOrder = vi.fn(async () => ({ ok: true as const, data: { order: orderFor({ term: "monthly", slots: [{ persona: "level_1", package: "basic" }] }), action: "insert" as const, checkoutUrl } }));
    const target = journey({ createOrder });
    arm(target);
    expect(await target.confirmReview(true)).toMatchObject({ ok: true, checkoutUrl });
    expect(target.snapshot().write).toMatchObject({ kind: "unpaid", checkoutUrl });
    expect(await target.confirmReview(true)).toMatchObject({ ok: true, checkoutUrl });
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it("derives one slot per branch and preserves choices when the draft grows", () => {
    const target = journey({
      preparation: preparation([
        { name: "الرئيسي", city: "صور" },
        { name: "الثاني", city: "نزوى" },
      ]),
    });
    expect(target.openPlans().ok).toBe(true);
    expect(target.snapshot().slots.map((slot) => slot.label)).toEqual([
      { name: "الرئيسي", city: "صور" },
      { name: "الثاني", city: "نزوى" },
    ]);
    expect(target.snapshot().slots.every((slot) => slot.persona === null && slot.package === null)).toBe(true);
    expect(target.setSlot(0, { persona: "level_2", package: "premium" }).ok).toBe(true);
    expect(target.replacePreparation(preparation([
      { name: "الرئيسي", city: "صور" },
      { name: "الثاني", city: "نزوى" },
      { name: "الثالث", city: "صلالة" },
    ])).ok).toBe(true);
    const slots = target.snapshot().slots;
    expect(slots).toHaveLength(3);
    expect(slots[0]).toMatchObject({ persona: "level_2", package: "premium" });
    expect(slots[2]).toMatchObject({ persona: null, package: null, label: { name: "الثالث", city: "صلالة" } });
  });

  it("prices every persona and package from the catalog, with a monthly reply allowance on yearly terms", () => {
    for (const plan of commercialPlans) {
      for (const term of ["monthly", "yearly"] as const) {
        const target = journey();
        expect(target.openPlans().ok).toBe(true);
        expect(target.setSlot(0, { persona: plan.persona, package: plan.package }).ok).toBe(true);
        expect(target.setTerm(term).ok).toBe(true);
        const review = target.localReview();
        expect(review.ok).toBe(true);
        if (!review.ok || !review.seam) continue;
        expect(review.seam.preview.amountBaisa).toBe(commercialAmount(plan, term));
        expect(review.seam.preview.repliesPerMonth).toBe(plan.replies);
        expect(review.seam.preview.slots[0]).toMatchObject({
          repliesPerMonth: plan.replies,
          employees: plan.employees,
          channels: plan.channels,
        });
        expect(review.seam.preview.catalogRevision).toBe(
          plan.persona === "level_3" && plan.package === "basic" ? "2026-10-24" : "2026-10-14",
        );
      }
    }
  });

  it("uses one term for every slot and keeps the yearly reply total on the monthly allowance", () => {
    const target = journey({
      preparation: preparation([
        { name: "الرئيسي", city: "صور" },
        { name: "الثاني", city: "نزوى" },
      ]),
    });
    const first = commercialPlan("level_1", "basic");
    const second = commercialPlan("level_3", "premium");
    arm(target, [
      { persona: "level_1", package: "basic" },
      { persona: "level_3", package: "premium" },
    ], "yearly");
    const preview = target.snapshot().preview;
    expect(preview?.term).toBe("yearly");
    expect(preview?.branchSlots).toBe(2);
    expect(preview?.amountBaisa).toBe(commercialAmount(first, "yearly") + commercialAmount(second, "yearly"));
    expect(preview?.repliesPerMonth).toBe(first.replies + second.replies);
    expect(preview?.employees).toBe(first.employees + second.employees);
    expect(preview?.channels).toBe(first.channels + second.channels);
    expect(target.readPlan("level_1", "basic")).toBe(first);
  });

  it("accepts 1 and 32 branches and refuses 0 or 33 without truncation", () => {
    const one = journey();
    arm(one);
    expect(one.snapshot().preview?.branchSlots).toBe(1);

    const full = journey({ preparation: preparation(branches(32)) });
    expect(full.openPlans().ok).toBe(true);
    for (let index = 0; index < 32; index += 1) expect(full.setSlot(index, { persona: "level_1", package: "basic" }).ok).toBe(true);
    expect(full.setTerm("monthly").ok).toBe(true);
    const reviewed = full.localReview();
    expect(reviewed.ok).toBe(true);
    if (reviewed.ok) expect(reviewed.seam?.preview.branchSlots).toBe(32);
    expect(full.snapshot().preview?.amountBaisa).toBe(32 * commercialAmount(commercialPlan("level_1", "basic"), "monthly"));

    const over = journey({ preparation: preparation(branches(33)) });
    const blocked = over.openPlans();
    expect(blocked).toMatchObject({ ok: false, code: "SLOT_COUNT", branchCount: 33 });
    expect(over.snapshot().slots).toHaveLength(33);
    expect(over.snapshot().preparation.branches).toHaveLength(33);

    const none = journey();
    expect(none.replacePreparation({ ...preparation(), branches: [] })).toMatchObject({ ok: true });
    expect(none.openPlans()).toMatchObject({ ok: false, code: "PREPARATION_INCOMPLETE" });
    expect(none.snapshot().slots).toHaveLength(0);
  });

  it("keeps consent off until an explicit check and keeps business facts out of the action payload", async () => {
    const calls: unknown[] = [];
    const target = journey({
      createOrder: async (input) => {
        calls.push(input);
        return success(input.selection);
      },
    });
    expect(target.snapshot().consentAccepted).toBe(false);
    expect(target.openPlans().ok).toBe(true);
    expect(target.setSlot(0, { persona: "level_1", package: "basic" }).ok).toBe(true);
    expect(target.setTerm("monthly").ok).toBe(true);
    expect(calls).toHaveLength(0);
    expect(await target.confirmReview(true)).toMatchObject({ ok: false, code: "REVIEW_REQUIRED" });
    const review = target.localReview();
    expect(review.ok).toBe(true);
    if (review.ok) {
      expect(review.seam?.confirmWired).toBe(false);
      expect(review.seam?.consentAccepted).toBe(false);
    }
    expect(await target.confirmReview(true)).toMatchObject({ ok: false, code: "CONSENT_REQUIRED" });
    expect(target.setConsent(true).ok).toBe(true);
    expect(await target.confirmReview(false)).toMatchObject({ ok: false, code: "CONSENT_REQUIRED" });
    expect(calls).toHaveLength(0);
    const created = await target.confirmReview(true);
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.settlement).toBe("UNPAID");
      expect(created.serviceReady).toBe(false);
    }
    expect(calls).toHaveLength(1);
    const payload = calls[0] as { selection: Es02OfferSelection };
    expect(Object.keys(payload).sort()).toEqual(["clientOpId", "consentAccepted", "expectedAccountId", "selection"]);
    expect(Object.keys(payload.selection).sort()).toEqual(["slots", "term"]);
    expect(Object.keys(payload.selection.slots[0]!).sort()).toEqual(["package", "persona"]);
    const encoded = JSON.stringify(payload);
    for (const secret of ["متجر الندى", "+96892123456", "مسقط", "صور", "الرئيسي", "preparation", "branches"]) {
      expect(encoded).not.toContain(secret);
    }
    expect(target.snapshot().slots[0]?.label).toEqual({ name: "الرئيسي", city: "صور" });
  });

  it("preserves the local draft when returning from plans and clears it when the actor capture changes", () => {
    const target = journey();
    arm(target);
    expect(target.backToPreparation().ok).toBe(true);
    expect(target.snapshot().step).toBe("preparation");
    expect(target.snapshot().preparation).toEqual(preparation());
    expect(target.snapshot().slots[0]).toMatchObject({ persona: "level_1", package: "basic" });
    expect(target.snapshot().consentAccepted).toBe(false);
    expect(target.snapshot().preview).toBeNull();

    target.bindActor({ accountId: otherAccountId, captureToken: "capture-b", isCurrent: () => true });
    expect(target.snapshot().accountId).toBe(otherAccountId);
    expect(target.snapshot().preparation).toEqual({ ...emptyPreparation(), branches: [{ name: "", city: "", localId: expect.any(String) }] });
    expect(target.snapshot().term).toBeNull();
    expect(target.snapshot().write.kind).toBe("idle");
    expect(target.snapshot().generation).toBe(1);
  });

  it("coalesces duplicate confirmation into one in-flight write", async () => {
    let release: (value: Es02Result<{ order: Es02AccountOrderView; action: "insert" | "reuse" }>) => void = () => undefined;
    const gate = new Promise<Es02Result<{ order: Es02AccountOrderView; action: "insert" | "reuse" }>>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const target = journey({
      createOrder: () => {
        calls += 1;
        return gate;
      },
    });
    arm(target);
    const first = target.confirmReview(true);
    const second = target.confirmReview(true);
    expect(second).toBe(first);
    expect(calls).toBe(1);
    expect(target.setSlot(0, { persona: "level_2", package: "basic" })).toMatchObject({ ok: false, code: "WRITE_LOCKED" });
    release(success({ term: "monthly", slots: [{ persona: "level_1", package: "basic" }] }));
    const [left, right] = await Promise.all([first, second]);
    expect(left).toEqual(right);
    expect(left.ok && left.settlement).toBe("UNPAID");
    expect(await target.confirmReview(true)).toEqual(left);
    expect(calls).toBe(1);
  });

  it("retries UNKNOWN and thrown writes with the same operation id and payload", async () => {
    const calls: { clientOpId: string; selection: Es02OfferSelection }[] = [];
    let attempt = 0;
    const target = journey({
      createOrder: async (input) => {
        calls.push({ clientOpId: input.clientOpId, selection: input.selection });
        attempt += 1;
        if (attempt === 1) return { ok: false, code: "UNKNOWN" };
        throw new Error("socket hang up");
      },
    });
    arm(target);
    const unknown = await target.confirmReview(true);
    expect(unknown).toMatchObject({ ok: false, code: "UNKNOWN" });
    expect(target.setTerm("yearly")).toMatchObject({ ok: false, code: "WRITE_LOCKED" });
    const thrown = await target.confirmReview(true);
    expect(thrown).toMatchObject({ ok: false, code: "UNKNOWN", clientOpId: calls[0]?.clientOpId });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
  });

  it("does not replace a conflict or tamper denial with a new operation", async () => {
    for (const code of ["CONFLICT", "OFFER_TAMPER"] as const) {
      const calls: string[] = [];
      const target = journey({
        createOrder: async (input) => {
          calls.push(input.clientOpId);
          return { ok: false, code };
        },
      });
      arm(target);
      const denied = await target.confirmReview(true);
      expect(denied).toMatchObject({ ok: false, code, clientOpId: calls[0] });
      expect(await target.confirmReview(true)).toEqual(denied);
      expect(calls).toHaveLength(1);
      expect(target.replacePreparation(preparation([{ name: "بديل", city: "صحار" }]))).toMatchObject({ ok: false, code: "WRITE_LOCKED" });
      expect(target.snapshot().preparation).toEqual(preparation());
      expect(target.snapshot().editingLocked).toBe(true);
    }
  });

  it("drops a late result after actor change, unmount, or a failed current-actor fence", async () => {
    const calls: string[] = [];
    let release: (value: Es02Result<{ order: Es02AccountOrderView; action: "insert" | "reuse" }>) => void = () => undefined;
    const gate = new Promise<Es02Result<{ order: Es02AccountOrderView; action: "insert" | "reuse" }>>((resolve) => {
      release = resolve;
    });
    const changed = journey({
      createOrder: (input) => {
        calls.push(input.expectedAccountId);
        return gate;
      },
    });
    arm(changed);
    const pending = changed.confirmReview(true);
    changed.bindActor({ accountId: otherAccountId, captureToken: "capture-b", isCurrent: () => true });
    release(success({ term: "monthly", slots: [{ persona: "level_1", package: "basic" }] }, "settled"));
    await expect(pending).resolves.toMatchObject({ ok: false, code: "STALE_CAPTURE" });
    expect(changed.snapshot().accountId).toBe(otherAccountId);
    expect(changed.snapshot().preparation).toEqual({ ...emptyPreparation(), branches: [{ name: "", city: "", localId: expect.any(String) }] });
    expect(changed.snapshot().write.kind).toBe("idle");
    expect(calls).toEqual([accountId]);

    let phase: "before" | "after" = "before";
    const fenced = journey({
      current: () => phase === "before",
      createOrder: async (input) => {
        phase = "after";
        return success(input.selection, "settled");
      },
    });
    arm(fenced);
    const stale = await fenced.confirmReview(true);
    expect(stale).toMatchObject({ ok: false, code: "STALE_CAPTURE" });
    expect(fenced.snapshot().discarded).toBe(true);
    expect(fenced.snapshot().write.kind).toBe("idle");

    let unmountRelease: (value: Es02Result<{ order: Es02AccountOrderView; action: "insert" | "reuse" }>) => void = () => undefined;
    const unmountGate = new Promise<Es02Result<{ order: Es02AccountOrderView; action: "insert" | "reuse" }>>((resolve) => {
      unmountRelease = resolve;
    });
    const mounted = journey({ createOrder: () => unmountGate });
    arm(mounted);
    const inflight = mounted.confirmReview(true);
    mounted.release();
    unmountRelease(success({ term: "monthly", slots: [{ persona: "level_1", package: "basic" }] }));
    await expect(inflight).resolves.toMatchObject({ ok: false, code: "STALE_CAPTURE" });
    expect(mounted.snapshot().discarded).toBe(true);
    await expect(mounted.confirmReview(true)).resolves.toMatchObject({ ok: false, code: "DISCARDED" });
  });

  it("labels a server order unpaid and inactive even when the row status is settled", async () => {
    const target = journey({
      createOrder: async (input) => success(input.selection, "settled"),
    });
    arm(target);
    const created = await target.confirmReview(true);
    if (!created.ok) throw new Error("expected unpaid order");
    const write = target.snapshot().write;
    if (write.kind !== "unpaid") throw new Error(`expected unpaid write, received ${write.kind}`);
    expect(created.order.status).toBe("settled");
    expect(created.settlement).toBe("UNPAID");
    expect(created.serviceReady).toBe(false);
    expect(created.order.orderId).toBe(write.order.orderId);
    expect(created.order.offer.amountBaisa).toBe(write.order.offer.amountBaisa);
    expect(created.order.offer.package).toBe(write.order.offer.package);
    expect(created.clientOpId).toBe(write.clientOpId);
  });

  it("refuses a write when the actor is already not current", async () => {
    let calls = 0;
    const target = journey({
      current: () => false,
      createOrder: async () => {
        calls += 1;
        return { ok: false, code: "UNKNOWN" };
      },
    });
    arm(target);
    expect(await target.confirmReview(true)).toMatchObject({ ok: false, code: "ACTOR_NOT_CURRENT" });
    expect(calls).toBe(0);
    expect(target.snapshot().write.kind).toBe("idle");
  });

  it("marks AI phone calls as not for sale and leaves every other add-on unpriced and excluded", () => {
    const target = journey();
    const premium = commercialPlan("level_2", "premium");
    const presented = target.presentAddons("level_2", "premium");
    expect(presented.map((addon) => addon.id)).toEqual(premium.addons.map((addon) => addon.id));
    expect(presented.find((addon) => addon.id === "calls")).toMatchObject({ included: false, sale: "FUTURE_NOT_READY_FOR_SALE" });
    expect(presented.filter((addon) => addon.id !== "calls").every((addon) => addon.sale === "OPTIONAL_SEPARATE" && addon.included === false)).toBe(true);
    expect(presented.some((addon) => "amountBaisa" in addon || "price" in addon)).toBe(false);
    expect(target.readPlan("level_1", "premium").features.map((feature) => feature.id)).toEqual(commercialPlan("level_1", "premium").features.map((feature) => feature.id));
    expect(target.readPlan("level_1", "basic").features.map((feature) => feature.id)).toEqual(commercialPlan("level_1", "basic").features.map((feature) => feature.id));
  });

  it("does not return a cached order or denial when the live actor fence fails", async () => {
    let current = true;
    const calls: string[] = [];
    const paid = journey({
      current: () => current,
      createOrder: async (input) => {
        calls.push(input.clientOpId);
        return success(input.selection, "settled");
      },
    });
    arm(paid);
    const created = await paid.confirmReview(true);
    if (!created.ok) throw new Error("expected unpaid order");
    current = false;
    const hidden = await paid.confirmReview(true);
    expect(hidden).toEqual({ ok: false, code: "ACTOR_NOT_CURRENT" });
    expect(hidden).not.toHaveProperty("order");
    expect(hidden).not.toHaveProperty("settlement");
    current = true;
    const reread = await paid.confirmReview(true);
    if (!reread.ok) throw new Error("expected reattested read");
    expect(reread.order.orderId).toBe(created.order.orderId);
    expect(reread.clientOpId).toBe(created.clientOpId);
    expect(reread.settlement).toBe("UNPAID");
    expect(reread.serviceReady).toBe(false);
    expect(calls).toHaveLength(1);

    let deniedCalls = 0;
    const denied = journey({
      current: () => current,
      createOrder: async () => {
        deniedCalls += 1;
        return { ok: false, code: "CONFLICT" };
      },
    });
    arm(denied);
    const conflict = await denied.confirmReview(true);
    expect(conflict).toMatchObject({ ok: false, code: "CONFLICT" });
    current = false;
    expect(await denied.confirmReview(true)).toEqual({ ok: false, code: "ACTOR_NOT_CURRENT" });
    current = true;
    expect(await denied.confirmReview(true)).toEqual(conflict);
    expect(deniedCalls).toBe(1);

    let releaseInflight: (value: Es02Result<{ order: Es02AccountOrderView; action: "insert" | "reuse" }>) => void = () => undefined;
    const gate = new Promise<Es02Result<{ order: Es02AccountOrderView; action: "insert" | "reuse" }>>((resolve) => {
      releaseInflight = resolve;
    });
    const pendingJourney = journey({
      current: () => current,
      createOrder: (input) => {
        calls.push(input.clientOpId);
        return gate;
      },
    });
    arm(pendingJourney);
    const inflight = pendingJourney.confirmReview(true);
    current = false;
    const blocked = pendingJourney.confirmReview(true);
    expect(blocked).not.toBe(inflight);
    await expect(blocked).resolves.toEqual({ ok: false, code: "ACTOR_NOT_CURRENT" });
    current = true;
    expect(pendingJourney.confirmReview(true)).toBe(inflight);
    releaseInflight(success({ term: "monthly", slots: [{ persona: "level_1", package: "basic" }] }));
    const finished = await inflight;
    if (!finished.ok) throw new Error("expected the original inflight order");
    expect(finished.settlement).toBe("UNPAID");
    expect(calls).toEqual([created.clientOpId, finished.clientOpId]);
  });

  it("keeps an UNKNOWN retry on the frozen operation after snapshot and argument mutation", async () => {
    const calls: { clientOpId: string; package: string }[] = [];
    const target = journey({
      createOrder: async (input) => {
        const slot = input.selection.slots[0];
        if (!slot) throw new Error("missing attempt slot");
        calls.push({ clientOpId: input.clientOpId, package: slot.package });
        input.clientOpId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
        slot.package = "premium";
        return { ok: false, code: "UNKNOWN" };
      },
    });
    arm(target);
    const first = await target.confirmReview(true);
    expect(first).toMatchObject({ ok: false, code: "UNKNOWN" });
    const exposed = target.snapshot().write;
    if (exposed.kind !== "unknown") throw new Error(`expected unknown write, received ${exposed.kind}`);
    exposed.clientOpId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const exposedSlot = exposed.selection.slots[0];
    if (!exposedSlot) throw new Error("missing exposed slot");
    exposedSlot.package = "premium";
    const choice = target.snapshot().slots[0];
    if (!choice) throw new Error("missing local slot");
    choice.package = "premium";
    const second = await target.confirmReview(true);
    const original = calls[0];
    const retry = calls[1];
    if (!original || !retry) throw new Error("expected two attempts");
    expect(second).toMatchObject({ ok: false, code: "UNKNOWN", clientOpId: original.clientOpId });
    expect(retry).toEqual(original);
    expect(retry.package).toBe("basic");
    expect(retry.clientOpId).not.toBe("ffffffff-ffff-4fff-8fff-ffffffffffff");
  });

  it("gives a new capture its own write while an older confirm is still pending", async () => {
    const calls: { accountId: string; clientOpId: string; package: string }[] = [];
    let releaseA: (value: Es02Result<{ order: Es02AccountOrderView; action: "insert" | "reuse" }>) => void = () => undefined;
    let releaseB: (value: Es02Result<{ order: Es02AccountOrderView; action: "insert" | "reuse" }>) => void = () => undefined;
    const gateA = new Promise<Es02Result<{ order: Es02AccountOrderView; action: "insert" | "reuse" }>>((resolve) => {
      releaseA = resolve;
    });
    const gateB = new Promise<Es02Result<{ order: Es02AccountOrderView; action: "insert" | "reuse" }>>((resolve) => {
      releaseB = resolve;
    });
    const target = journey({
      createOrder: (input) => {
        const slot = input.selection.slots[0];
        calls.push({
          accountId: input.expectedAccountId,
          clientOpId: input.clientOpId,
          package: slot ? slot.package : "",
        });
        return calls.length === 1 ? gateA : gateB;
      },
    });
    arm(target);
    const pendingA = target.confirmReview(true);
    target.bindActor({ accountId: otherAccountId, captureToken: "capture-b", isCurrent: () => true });
    expect(target.replacePreparation(preparation([{ name: "فرع ب", city: "نزوى" }])).ok).toBe(true);
    arm(target, [{ persona: "level_2", package: "premium" }], "yearly");
    const pendingB = target.confirmReview(true);
    expect(pendingB).not.toBe(pendingA);
    const older = calls[0];
    const newer = calls[1];
    if (!older || !newer) throw new Error("expected separate writes");
    expect(older.accountId).toBe(accountId);
    expect(newer.accountId).toBe(otherAccountId);
    expect(newer.package).toBe("premium");
    expect(newer.clientOpId).not.toBe(older.clientOpId);
    releaseA(success({ term: "monthly", slots: [{ persona: "level_1", package: "basic" }] }, "settled"));
    await expect(pendingA).resolves.toMatchObject({ ok: false, code: "STALE_CAPTURE" });
    const during = target.snapshot();
    if (during.write.kind !== "inflight") throw new Error(`expected B inflight, received ${during.write.kind}`);
    expect(during.accountId).toBe(otherAccountId);
    expect(during.write.clientOpId).toBe(newer.clientOpId);
    releaseB(success({ term: "yearly", slots: [{ persona: "level_2", package: "premium" }] }));
    const created = await pendingB;
    if (!created.ok) throw new Error("expected B order");
    expect(created.settlement).toBe("UNPAID");
    expect(created.serviceReady).toBe(false);
    expect(created.clientOpId).toBe(newer.clientOpId);
    expect(created.order.offer.package).toBe("premium");
    const stored = target.snapshot().write;
    if (stored.kind !== "unpaid") throw new Error(`expected B unpaid, received ${stored.kind}`);
    expect(stored.clientOpId).toBe(newer.clientOpId);
    expect(stored.order.offer.package).toBe("premium");
    expect(target.snapshot().accountId).toBe(otherAccountId);
    expect(calls).toHaveLength(2);
  });

  it("does not bind unpaid order creation to prepayment review", () => {
    expect(setupPlanBeginPayment).not.toBe(createAccountBoundOrderAction);
    const source = readFileSync("src/components/app/setup-plan-journey.ts", "utf8");
    expect(source).not.toContain("createAccountBoundOrderAction");
    expect(source).not.toContain("readOwnedPurchaseRecoveryAction");
    expect(source).not.toContain("settleAccountOrder");
  });

  it("keeps review editable and restartable when payment is deferred, without any RPC", async () => {
    mocks.userRpc.mockReset();
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: accountId, session_id: "11111111-2222-4333-8444-555555555555" } }, error: null });
    mocks.checkAppSession.mockResolvedValue({ ok: true });
    const target = createSetupPlanJourney({
      actor: { accountId, captureToken: "local", isCurrent: () => true },
      preparation: preparation(), newClientOpId: nextId,
    });
    arm(target);
    expect(mocks.userRpc).not.toHaveBeenCalled();
    await expect(target.confirmReview(true)).resolves.toMatchObject({ ok: false, code: "PAYMOB_EXTERNAL_DEFERRED" });
    expect(mocks.userRpc).not.toHaveBeenCalled();
    expect(target.snapshot().write.kind).toBe("idle");
    expect(target.snapshot().editingLocked).toBe(false);
    expect(target.openPlans().ok).toBe(true);
    expect(target.setSlot(0, { persona: "level_2", package: "premium" }).ok).toBe(true);
    target.release();
    const restarted = createSetupPlanJourney({ actor: { accountId, captureToken: "new", isCurrent: () => true } });
    expect(restarted.snapshot().write.kind).toBe("idle");
    expect(restarted.snapshot().preview).toBeNull();
  });
});

it("keeps plan choices with their branch when an earlier branch is removed or reordered", () => {
  const original = preparation([{ name: "Main", city: "Muscat" }, { name: "Second", city: "Sohar" }]);
  const j = createSetupPlanJourney({ actor: { accountId, captureToken: "audit", isCurrent: () => true }, preparation: original });
  j.openPlans();
  j.setSlot(0, { persona: "level_1", package: "basic" });
  j.setSlot(1, { persona: "level_3", package: "premium" });
  j.backToPreparation();
  j.replacePreparation({ ...original, branches: [original.branches[1]!] });
  expect(j.openPlans()).toEqual({ ok: true });
  expect(j.snapshot().slots[0]).toMatchObject({ label: original.branches[1], persona: "level_3", package: "premium" });
  j.backToPreparation();
  j.replacePreparation({ ...original, branches: [{ name: "New", city: "Nizwa" }, original.branches[1]!] });
  j.openPlans();
  expect(j.snapshot().slots[0]).toMatchObject({ persona: null, package: null });
  expect(j.snapshot().slots[1]).toMatchObject({ persona: "level_3", package: "premium" });
});

it("requires an explicit plan for changed branch labels instead of transferring an old purchase", () => {
  const original = preparation([{ name: "Main", city: "Muscat" }]);
  const j = createSetupPlanJourney({ actor: { accountId, captureToken: "audit", isCurrent: () => true }, preparation: original });
  j.openPlans();
  j.setSlot(0, { persona: "level_2", package: "premium" });
  j.setTerm("yearly");
  j.backToPreparation();
  j.replacePreparation({ ...original, branches: [{ name: "Different", city: "Sur" }] });
  j.openPlans();
  expect(j.snapshot().slots[0]).toMatchObject({ persona: null, package: null });
  expect(j.localReview()).toMatchObject({ ok: false, code: "SELECTION_INCOMPLETE" });
  expect(j.snapshot().write.kind).toBe("idle");
});
it("does not lock local editing after the current read-only preflight rejects the session", async () => {
  mocks.getClaims.mockResolvedValue({ data: { claims: null }, error: null });
  mocks.userRpc.mockReset();
  const j = createSetupPlanJourney({ actor: { accountId, captureToken: "audit", isCurrent: () => true }, preparation: preparation() });
  j.openPlans();
  j.setSlot(0, { persona: "level_1", package: "basic" });
  j.setTerm("monthly");
  j.localReview();
  j.setConsent(true);
  await expect(j.confirmReview(true)).resolves.toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  expect(j.snapshot().editingLocked).toBe(false);
  expect(j.snapshot().write.kind).toBe("idle");
  expect(j.backToPreparation()).toEqual({ ok: true });
  expect(mocks.userRpc).not.toHaveBeenCalled();
});

it("keeps optional answers on Back, isolates clones, and drops them when the capture changes", async () => {
  const answers = { version: 1 as const, goals: ["support"], channels: { whatsapp: true }, whatsapp: { existingUse: "no" as const, platform: "Twilio" }, website: { url: "https://example.com" } };
  const seen: unknown[] = [];
  let release: (value: { ok: true; data: { order: Es02AccountOrderView; action: "insert" } }) => void = () => {};
  const pending = new Promise<{ ok: true; data: { order: Es02AccountOrderView; action: "insert" } }>((resolve) => { release = resolve; });
  const draft = { ...preparation(), branches: [{ name: "الرئيسي", city: "صور", contactPhone: "+96892123456", localId: "branch-1" }], answers };
  const current = createSetupPlanJourney({
    actor: { accountId, captureToken: "capture-a", isCurrent: () => true },
    preparation: draft,
    createOrder: async (input) => { seen.push(input); return pending; },
    newClientOpId: () => "00000000-0000-4000-8000-000000000099",
  });
  expect(current.snapshot().preparation.answers?.whatsapp).toEqual({ existingUse: "no", platform: null, platformOther: null, verification: null, facebookBusinessAccount: null });
  expect(current.snapshot().preparation.branches[0]).toMatchObject({ contactPhone: "+96892123456", localId: "branch-1" });
  const returned = current.snapshot();
  returned.preparation.answers?.goals.push("sales");
  expect(current.snapshot().preparation.answers?.goals).toEqual(["support"]);
  current.openPlans();
  current.backToPreparation();
  expect(current.snapshot().preparation.answers?.website).toEqual({ kind: "url", value: "https://example.com/" });
  expect(current.snapshot().consentAccepted).toBe(false);
  expect(current.replacePreparation({ ...draft, answers: { version: 1, goals: ["loyalty"] } })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  expect(current.snapshot().preparation.answers?.goals).toEqual(["support"]);
  current.openPlans();
  current.setSlot(0, { persona: "level_3", package: "basic" });
  current.setTerm("yearly");
  current.localReview();
  current.setConsent(true);
  const late = current.confirmReview(true);
  current.bindActor({ accountId: otherAccountId, captureToken: "capture-b", isCurrent: () => true });
  release({ ok: true, data: { order: orderFor({ term: "yearly", slots: [{ persona: "level_3", package: "basic" }] }), action: "insert" } });
  await expect(late).resolves.toMatchObject({ ok: false, code: "STALE_CAPTURE" });
  expect(current.snapshot().preparation.answers).toBeUndefined();
  expect(current.snapshot().preparation.name).toBe("");
  expect(seen).toHaveLength(1);
  expect(JSON.stringify(seen[0])).not.toMatch(/example.com|support|Twilio|\+968/);
  expect(createSetupPlanJourney({ actor: { accountId, captureToken: "fresh", isCurrent: () => true } }).snapshot().preparation.answers).toBeUndefined();
});

it("does not treat malformed supplied answers as an absent valid visit", () => {
  const malformed = createSetupPlanJourney({
    actor: { accountId, captureToken: "capture-a", isCurrent: () => true },
    preparation: { ...preparation(), answers: { version: 1, goals: ["loyalty"] } },
  });
  expect(malformed.openPlans()).toMatchObject({ ok: false, code: "PREPARATION_INCOMPLETE", preparationErrors: ["answers"] });
  expect(malformed.snapshot().step).toBe("preparation");
  expect(malformed.localReview()).toMatchObject({ ok: false, code: "PREPARATION_INCOMPLETE", preparationErrors: ["answers"] });
  expect(malformed.replacePreparation({ ...preparation(), answers: { version: 1, goals: ["support"] } }).ok).toBe(true);
  expect(malformed.openPlans().ok).toBe(true);
});
