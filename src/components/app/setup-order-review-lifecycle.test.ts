import { describe, expect, it, vi } from "vitest";
import { commercialPlan } from "@/components/app/subscription-commercial-catalog";
import type { Es02ImmutableOffer } from "@/lib/billing/es02/contracts";
import { resolveEs02Offer } from "@/lib/billing/es02/commercial-offer";
import {
  FAILURE_COPY,
  PERSONA_VIDEOS,
  buildReviewModel,
  createMotionBudget,
  createMotionController,
  createReviewController,
  shouldPlayMotion,
  type ControllerEvent,
  type ControllerResult,
  type MotionEnv,
} from "./setup-order-review-model";

type R = ControllerResult;
const OP = "11111111-2222-4333-8444-555555555555";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function harness(opts: { currentOpId?: string } = {}) {
  const live = { key: "A", mounted: true };
  const events: ControllerEvent<R>[] = [];
  const onConfirmed = vi.fn();
  const controller = createReviewController<R>({
    live: () => live,
    emit: (e) => events.push(e),
    onConfirmed,
    currentOpId: opts.currentOpId ? () => opts.currentOpId : undefined,
  });
  return { live, events, onConfirmed, controller };
}

describe("review controller: live actor and mount fences", () => {
  it("account A->B during the await: A's success is dropped (no state events after busy, no onConfirmed)", async () => {
    const h = harness();
    const d = deferred<R>();
    const run = h.controller.start("A", () => d.promise);
    expect(h.events).toEqual([{ type: "busy" }]);
    h.live.key = "B";
    d.resolve({ ok: true, clientOpId: OP });
    expect(await run).toEqual({ kind: "dropped" });
    expect(h.events).toEqual([{ type: "busy" }]);
    expect(h.onConfirmed).not.toHaveBeenCalled();
    expect(h.controller.isBusy()).toBe(false);
  });
  it("account A->B during the await: A's failure is dropped too", async () => {
    const h = harness();
    const d = deferred<R>();
    const run = h.controller.start("A", () => d.promise);
    h.live.key = "B";
    d.resolve({ ok: false, code: "UNKNOWN" });
    expect((await run).kind).toBe("dropped");
    expect(h.events).toEqual([{ type: "busy" }]);
  });
  it("unmount during the await: result dropped, nothing emitted, nothing confirmed", async () => {
    const h = harness();
    const d = deferred<R>();
    const run = h.controller.start("A", () => d.promise);
    h.live.mounted = false;
    d.resolve({ ok: true, clientOpId: OP });
    expect((await run).kind).toBe("dropped");
    expect(h.events).toEqual([{ type: "busy" }]);
    expect(h.onConfirmed).not.toHaveBeenCalled();
  });
  it("a retained handler from A is blocked before invoking the callback once B is live or after unmount", async () => {
    const h = harness();
    const invoke = vi.fn(async (): Promise<R> => ({ ok: true }));
    h.live.key = "B";
    expect(await h.controller.start("A", invoke)).toEqual({ kind: "blocked" });
    h.live.key = "A";
    h.live.mounted = false;
    expect(await h.controller.start("A", invoke)).toEqual({ kind: "blocked" });
    expect(invoke).not.toHaveBeenCalled();
    expect(h.events).toEqual([]);
  });
  it("actor change after the result arrived but before onConfirmed (emit moves the actor) still skips onConfirmed", async () => {
    const live = { key: "A", mounted: true };
    const onConfirmed = vi.fn();
    const controller = createReviewController<R>({
      live: () => live,
      emit: (e) => {
        if (e.type === "created") live.key = "B";
      },
      onConfirmed,
    });
    await controller.start("A", async () => ({ ok: true, clientOpId: OP }));
    expect(onConfirmed).not.toHaveBeenCalled();
  });
  it("live success calls onConfirmed once and emits created", async () => {
    const h = harness();
    const result: R = { ok: true, clientOpId: OP };
    expect(await h.controller.start("A", async () => result)).toEqual({ kind: "settled" });
    expect(h.onConfirmed).toHaveBeenCalledTimes(1);
    expect(h.onConfirmed).toHaveBeenCalledWith(result);
    expect(h.events.map((e) => e.type)).toEqual(["busy", "created"]);
  });
});

describe("review controller: single flight and retry", () => {
  it("double click invokes the callback once; the second start is ignored while pending", async () => {
    const h = harness();
    const d = deferred<R>();
    const invoke = vi.fn(() => d.promise);
    const first = h.controller.start("A", invoke);
    const second = await h.controller.start("A", invoke);
    expect(second).toEqual({ kind: "ignored" });
    d.resolve({ ok: true });
    await first;
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(h.onConfirmed).toHaveBeenCalledTimes(1);
  });
  it("UNKNOWN is followed by an explicit same-operation retry through the same guard (single-flight, once)", async () => {
    const h = harness({ currentOpId: OP });
    await h.controller.start("A", async () => ({ ok: false, code: "UNKNOWN" }));
    const failed = h.events.at(-1);
    expect(failed).toEqual({ type: "failed", code: "UNKNOWN", outcome: "UNKNOWN", clientOpId: OP });
    const d = deferred<R>();
    const retry = vi.fn(() => d.promise);
    const a = h.controller.start("A", retry);
    const b = await h.controller.start("A", retry);
    expect(b).toEqual({ kind: "ignored" });
    d.resolve({ ok: true, clientOpId: OP });
    await a;
    expect(retry).toHaveBeenCalledTimes(1);
    expect(h.onConfirmed).toHaveBeenCalledTimes(1);
  });
  it("retry from the old account after A->B is blocked: no retry callback, no state, no confirmed", async () => {
    const h = harness({ currentOpId: OP });
    await h.controller.start("A", async () => ({ ok: false, code: "UNKNOWN" }));
    const before = h.events.length;
    const retry = vi.fn(async (): Promise<R> => ({ ok: true }));
    h.live.key = "B";
    expect(await h.controller.start("A", retry)).toEqual({ kind: "blocked" });
    expect(retry).not.toHaveBeenCalled();
    expect(h.events).toHaveLength(before);
    expect(h.onConfirmed).not.toHaveBeenCalled();
  });
  it("retry result arriving after A->B or unmount is dropped", async () => {
    for (const mutate of [(l: { key: string; mounted: boolean }) => (l.key = "B"), (l: { key: string; mounted: boolean }) => (l.mounted = false)]) {
      const h = harness();
      const d = deferred<R>();
      const run = h.controller.start("A", () => d.promise);
      mutate(h.live);
      d.resolve({ ok: true, clientOpId: OP });
      expect((await run).kind).toBe("dropped");
      expect(h.onConfirmed).not.toHaveBeenCalled();
      expect(h.events).toEqual([{ type: "busy" }]);
    }
  });
  it("a rejected call becomes UNKNOWN (never a false failure) and keeps the same operation id", async () => {
    const h = harness({ currentOpId: OP });
    await h.controller.start("A", async () => {
      throw new Error("network");
    });
    expect(h.events.at(-1)).toEqual({ type: "failed", code: "UNKNOWN", outcome: "UNKNOWN", clientOpId: OP });
    await tick();
    expect(h.controller.isBusy()).toBe(false);
  });
});

describe("review controller: STALE_CAPTURE after the operation started", () => {
  it("stays UNKNOWN with the SAME operation id from the result (no new id)", async () => {
    const h = harness({ currentOpId: "some-other-host-id" });
    await h.controller.start("A", async () => ({ ok: false, code: "STALE_CAPTURE", clientOpId: OP }));
    expect(h.events.at(-1)).toEqual({ type: "failed", code: "STALE_CAPTURE", outcome: "UNKNOWN", clientOpId: OP });
    expect(h.onConfirmed).not.toHaveBeenCalled();
  });
  it("falls back to the host's current operation id only, and reports null rather than inventing one", async () => {
    const withHost = harness({ currentOpId: OP });
    await withHost.controller.start("A", async () => ({ ok: false, code: "STALE_CAPTURE" }));
    expect(withHost.events.at(-1)).toMatchObject({ outcome: "UNKNOWN", clientOpId: OP });
    const none = harness();
    await none.controller.start("A", async () => ({ ok: false, code: "STALE_CAPTURE" }));
    expect(none.events.at(-1)).toMatchObject({ outcome: "UNKNOWN", clientOpId: null });
  });
  it("definite local rejections stay FAILED; only possibly-committed codes are UNKNOWN", async () => {
    const h = harness();
    await h.controller.start("A", async () => ({ ok: false, code: "CONSENT_REQUIRED" }));
    expect(h.events.at(-1)).toMatchObject({ outcome: "FAILED" });
  });
  it("session copy (AR+EN) never asserts that nothing was sent and says the outcome is unconfirmed / order may exist", () => {
    const all = `${FAILURE_COPY.session.ar} ${FAILURE_COPY.session.en}`;
    expect(all).not.toMatch(/nothing was sent/i);
    expect(all).not.toMatch(/لم يُرسل|ولم يُرسل/);
    expect(FAILURE_COPY.session.en).toMatch(/not confirmed/i);
    expect(FAILURE_COPY.session.en).toMatch(/may exist/i);
    expect(FAILURE_COPY.session.ar).toContain("لم يتأكد لنا ناتج العملية");
    expect(FAILURE_COPY.session.ar).toContain("قد يكون الطلب قد أُنشئ");
    expect(FAILURE_COPY.session.ar).not.toMatch(/\?{2,}/);
  });
});

// ---------- order.offer is the amount authority for an existing order ----------
function offerFixture(): Es02ImmutableOffer {
  const r = resolveEs02Offer({
    term: "monthly",
    slots: [
      { persona: "level_1", package: "basic" },
      { persona: "level_2", package: "premium" },
    ],
  });
  if (!r.ok) throw new Error("fixture");
  return r.offer;
}
const SLOT_LABELS = [
  { label: { name: "Main", city: "Muscat" }, persona: "level_1" as const, package: "basic" as const },
  { label: { name: "Second", city: "Sohar" }, persona: "level_2" as const, package: "premium" as const },
];

describe("existing order: amounts come from order.offer; feature labels from offer snapshot", () => {
  it("without an order the model is a labelled catalog preview", () => {
    const m = buildReviewModel(SLOT_LABELS, "monthly");
    expect(m.source).toBe("preview");
    expect(m.totalBaisa).toBe(m.rows.reduce((s, r) => s + r.amountBaisa, 0));
  });
  it("order.offer amounts that differ from the catalog win for rows, total and term", () => {
    const offer = offerFixture();
    const bumped: Es02ImmutableOffer = {
      ...offer,
      term: "yearly",
      amountBaisa: offer.amountBaisa + 7777,
      slots: offer.slots.map((s) => ({ ...s, amountBaisa: s.amountBaisa + 1111 })),
    };
    const preview = buildReviewModel(SLOT_LABELS, "monthly");
    const m = buildReviewModel(SLOT_LABELS, "monthly", bumped);
    expect(m.source).toBe("order");
    expect(m.term).toBe("yearly");
    expect(m.totalBaisa).toBe(bumped.amountBaisa);
    expect(m.totalBaisa).not.toBe(preview.totalBaisa);
    expect(m.rows.map((r) => r.amountBaisa)).toEqual(bumped.slots.map((s) => s.amountBaisa));
    expect(m.rows[0].amountBaisa).not.toBe(preview.rows[0].amountBaisa);
    expect(m.branchCount).toBe(bumped.branchSlots);
    // Quotas/persona stay catalog-backed; features prefer the frozen offer-slot snapshot (cloned plan).
    const catalog = commercialPlan("level_1", "basic");
    expect(catalog).toBeTruthy();
    expect(m.rows[0].plan).not.toBe(catalog);
    expect(m.rows[0].plan).toEqual({
      ...catalog!,
      features: bumped.slots[0]!.features.map((feature) => ({
        id: feature.id,
        label: { ar: feature.label.ar, en: feature.label.en },
      })),
    });
    expect(m.rows.map((r) => r.name)).toEqual(["Main", "Second"]);
  });
  it("the order's persona/package are authoritative over the local slot choice", () => {
    const offer = offerFixture();
    const m = buildReviewModel(
      [
        { ...SLOT_LABELS[0], persona: "level_3", package: "premium" },
        { ...SLOT_LABELS[1], persona: null, package: null },
      ],
      null,
      offer,
    );
    expect(m.complete).toBe(true);
    expect(m.rows.map((r) => `${r.persona}/${r.package}`)).toEqual(["level_1/basic", "level_2/premium"]);
  });
});

describe("shared review motion budget", () => {
  it("caps 32 visible branch figures at two and transfers capacity after pause, error and unmount", () => {
    const budget = createMotionBudget(2);
    const envs = Array.from({ length: 32 }, () => fakeEnv());
    const playing = new Set<number>();
    let peak = 0;
    const controllers = envs.map((fixture, index) => createMotionController(
      { ...fixture.env, budget }, true, (play) => {
        if (play) playing.add(index);
        else playing.delete(index);
        peak = Math.max(peak, playing.size);
      },
    ));
    envs.forEach((fixture) => fixture.intersect(true));
    expect(controllers.filter((c) => c.isPlaying())).toHaveLength(2);
    expect([...playing]).toEqual([0, 1]);
    // A waiting figure leaving the page must never receive a later grant.
    controllers[2].dispose();
    envs[0].intersect(false);
    expect([...playing]).toEqual([1, 3]);
    controllers[1].reportError();
    expect([...playing]).toEqual([3, 4]);
    // React removes a disposed figure; its controller releases the shared permit.
    playing.delete(3);
    controllers[3].dispose();
    expect([...playing]).toEqual([4, 5]);
    expect(peak).toBe(2);
    envs.forEach((fixture) => fixture.setReduced(true));
    expect(controllers.filter((c) => c.isPlaying())).toHaveLength(0);
    controllers.forEach((c) => c.dispose());
  });

  it("removes a waiting request without starving later figures", () => {
    const budget = createMotionBudget(1);
    const first = budget.request(() => {});
    const cancelled = vi.fn();
    const second = budget.request(cancelled);
    const granted = vi.fn();
    const third = budget.request(granted);
    second.release();
    first.release();
    first.release();
    expect(cancelled).not.toHaveBeenCalled();
    expect(granted).toHaveBeenCalledTimes(1);
    expect(third.granted()).toBe(true);
    third.release();
    expect(third.granted()).toBe(false);
  });
});

// ---------- motion ----------
function fakeEnv(over: { reduced?: boolean; observer?: boolean; media?: boolean; visible?: boolean } = {}) {
  const reducedListeners = new Set<() => void>();
  const visListeners = new Set<() => void>();
  const query = { matches: over.reduced ?? false, addEventListener: (_t: "change", cb: () => void) => reducedListeners.add(cb), removeEventListener: (_t: "change", cb: () => void) => reducedListeners.delete(cb) };
  let io: ((inView: boolean) => void) | null = null;
  const observe = vi.fn();
  const disconnect = vi.fn();
  let visible = over.visible ?? true;
  const env: MotionEnv = {
    reducedQuery: over.media === false ? null : query,
    createObserver:
      over.observer === false
        ? null
        : (cb) => {
            io = cb;
            return { observe, disconnect };
          },
    isPageVisible: () => visible,
    subscribeVisibility: (cb) => {
      visListeners.add(cb);
      return () => visListeners.delete(cb);
    },
  };
  return {
    env,
    observe,
    disconnect,
    reducedListeners,
    visListeners,
    intersect: (v: boolean) => io?.(v),
    setReduced: (v: boolean) => {
      query.matches = v;
      reducedListeners.forEach((f) => f());
    },
    setVisible: (v: boolean) => {
      visible = v;
      visListeners.forEach((f) => f());
    },
  };
}

describe("persona motion", () => {
  it("uses verified alpha exports and the original Noura identity, never a GIF or rejected asset", () => {
    expect(Object.values(PERSONA_VIDEOS).sort()).toEqual(["/media/setup/dana-team-alpha.webm", "/media/setup/lina-team-alpha.webm", "/media/setup/noura-studio.mp4"]);
    expect(JSON.stringify(PERSONA_VIDEOS)).not.toMatch(/\.gif|e25570a9/);
  });
  it("shouldPlayMotion needs every condition", () => {
    const all = { enabled: true, supported: true, reduced: false, inView: true, pageVisible: true, failed: false };
    expect(shouldPlayMotion(all)).toBe(true);
    for (const k of Object.keys(all) as (keyof typeof all)[]) {
      const bad = { ...all, [k]: typeof all[k] === "boolean" ? !all[k] : all[k] };
      expect(shouldPlayMotion(bad)).toBe(false);
    }
  });
  it("starts on the poster, plays only in view, pauses offscreen, with reduced-motion changes and hidden tab", () => {
    const f = fakeEnv();
    const calls: boolean[] = [];
    const c = createMotionController(f.env, true, (p) => calls.push(p));
    c.observe({});
    expect(f.observe).toHaveBeenCalledTimes(1);
    expect(c.isPlaying()).toBe(false);
    f.intersect(true);
    expect(c.isPlaying()).toBe(true);
    f.intersect(false);
    expect(c.isPlaying()).toBe(false);
    f.intersect(true);
    f.setReduced(true);
    expect(c.isPlaying()).toBe(false);
    f.setReduced(false);
    expect(c.isPlaying()).toBe(true);
    f.setVisible(false);
    expect(c.isPlaying()).toBe(false);
    f.setVisible(true);
    expect(c.isPlaying()).toBe(true);
    expect(calls).toEqual([true, false, true, false, true, false, true]);
  });
  it("reduced-motion at start never plays even when visible", () => {
    const f = fakeEnv({ reduced: true });
    const c = createMotionController(f.env, true, () => undefined);
    f.intersect(true);
    expect(c.isPlaying()).toBe(false);
  });
  it("missing IntersectionObserver or matchMedia keeps the static poster", () => {
    for (const over of [{ observer: false }, { media: false }]) {
      const f = fakeEnv(over);
      const c = createMotionController(f.env, true, () => undefined);
      f.intersect(true);
      expect(c.isPlaying()).toBe(false);
    }
  });
  it("a video error falls back to the poster for good; the toggle pauses and resumes", () => {
    const f = fakeEnv();
    const c = createMotionController(f.env, true, () => undefined);
    f.intersect(true);
    c.setEnabled(false);
    expect(c.isPlaying()).toBe(false);
    c.setEnabled(true);
    expect(c.isPlaying()).toBe(true);
    c.reportError();
    expect(c.isPlaying()).toBe(false);
    f.intersect(false);
    f.intersect(true);
    expect(c.isPlaying()).toBe(false);
  });
  it("dispose disconnects, unsubscribes and ignores later events", () => {
    const f = fakeEnv();
    const calls: boolean[] = [];
    const c = createMotionController(f.env, true, (p) => calls.push(p));
    f.intersect(true);
    c.dispose();
    expect(f.disconnect).toHaveBeenCalledTimes(1);
    expect(f.reducedListeners.size).toBe(0);
    expect(f.visListeners.size).toBe(0);
    f.intersect(true);
    f.setReduced(false);
    expect(calls).toEqual([true]);
    expect(c.isPlaying()).toBe(false);
  });
});
