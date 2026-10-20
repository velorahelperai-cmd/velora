import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Minimal hook harness (node env, no DOM library installed): runs the REAL SetupOrderReview wrapper,
// keeps hook slots across renders, and lets a test decide when effects flush / unmount.
const H = vi.hoisted(() => ({
  slots: [] as Array<{ value?: unknown; deps?: unknown[]; cleanup?: () => void }>,
  cursor: 0,
  pending: [] as Array<() => void>,
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const slot = () => (H.slots[H.cursor++] ??= {});
  return {
    ...actual,
    useState(initial: unknown) {
      const s = slot();
      if (!("value" in s)) s.value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [s.value, (next: unknown) => { s.value = typeof next === "function" ? (next as (p: unknown) => unknown)(s.value) : next; }];
    },
    useRef(initial: unknown) {
      const s = slot();
      return (s.value ??= { current: initial });
    },
    useId() {
      const s = slot();
      return (s.value ??= `id-${H.cursor}`);
    },
    useEffect(fn: () => void | (() => void), deps?: unknown[]) {
      const s = slot();
      if (!s.deps || !deps || deps.some((d, i) => !Object.is(d, s.deps?.[i]))) {
        s.deps = deps ?? [];
        H.pending.push(() => {
          s.cleanup?.();
          s.cleanup = fn() || undefined;
        });
      }
    },
  };
});
vi.mock("@/lib/billing/es02/account-order-actions", () => ({ createAccountBoundOrderAction: vi.fn() }));

import type { SetupPlanConfirmResult, SetupPlanWrite } from "@/components/app/setup-plan-journey";
import { resolveEs02Offer } from "@/lib/billing/es02/commercial-offer";
import type { Es02AccountOrderView, Es02ImmutableOffer } from "@/lib/billing/es02/contracts";
import { SetupOrderReview, SetupOrderReviewView, type SetupOrderReviewProps, type ViewProps } from "./setup-order-review";
import { FAILURE_COPY } from "./setup-order-review-model";

const A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const B = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OP = "11111111-2222-4333-8444-555555555555";
const actorA = { accountId: A, captureToken: "capture-A" };
const actorB = { accountId: B, captureToken: "capture-B" };

function offer(): Es02ImmutableOffer {
  const r = resolveEs02Offer({ term: "monthly", slots: [{ persona: "level_1", package: "basic" }] });
  if (!r.ok) throw new Error("fixture");
  return r.offer;
}
function order(o: Es02ImmutableOffer = offer()): Es02AccountOrderView {
  return { orderId: OP, accountId: A, status: "open", offer: o, specialReference: "SERVER-REF", paymentAttemptId: OP, environment: "test", settledAt: null, provisionedCompanyId: null, originalOrderGroupId: OP };
}
function okResult(o?: Es02ImmutableOffer): Extract<SetupPlanConfirmResult, { ok: true }> {
  return { ok: true, settlement: "UNPAID", serviceReady: false, action: "insert", clientOpId: OP, order: order(o) };
}
function props(over: Partial<SetupOrderReviewProps> = {}): SetupOrderReviewProps {
  return {
    ar: false,
    slots: [{ label: { name: "Main", city: "Muscat" }, persona: "level_1", package: "basic" }],
    term: "monthly",
    write: { kind: "idle" },
    actor: actorA,
    consentAccepted: true,
    confirmReview: vi.fn(async () => okResult()),
    onConfirmed: vi.fn(),
    onEditBranch: vi.fn(),
    onBackToPlans: vi.fn(),
    ...over,
  };
}
const flush = () => H.pending.splice(0).forEach((fn) => fn());
function render(p: SetupOrderReviewProps, effects = true): ViewProps {
  H.cursor = 0;
  const el = SetupOrderReview(p) as ReactElement<ViewProps>;
  if (effects) flush();
  return el.props;
}
const unmount = () => H.slots.forEach((s) => s.cleanup?.());
const settle = () => new Promise<void>((r) => setTimeout(r, 0));
const markup = (v: ViewProps) => renderToStaticMarkup(createElement(SetupOrderReviewView, v));
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

beforeEach(() => {
  H.slots = [];
  H.cursor = 0;
  H.pending = [];
});
afterEach(() => unmount());

describe("SetupOrderReview wrapper lifecycle (real component, hook harness)", () => {
  it("retained handler from A does not invoke confirm after B rendered", async () => {
    const p = props();
    const old = render(p);
    render({ ...p, actor: actorB });
    old.onConfirm();
    await settle();
    expect(p.confirmReview).not.toHaveBeenCalled();
  });
  it("B rendered before effects (render-to-effect gap): pending A success is not published nor confirmed", async () => {
    const d = deferred<SetupPlanConfirmResult>();
    const p = props({ confirmReview: vi.fn(() => d.promise) });
    render(p).onConfirm();
    expect(render({ ...p, actor: actorB }, false).phase).toBe("switched");
    d.resolve(okResult());
    await settle();
    expect(p.onConfirmed).not.toHaveBeenCalled();
    flush();
    expect(render({ ...p, actor: actorB }).phase).toBe("switched");
  });
  it("A's pending failure after A->B does not touch state (still switched, no created/failed)", async () => {
    const d = deferred<SetupPlanConfirmResult>();
    const p = props({ confirmReview: vi.fn(() => d.promise) });
    render(p).onConfirm();
    render({ ...p, actor: actorB });
    d.resolve({ ok: false, code: "UNKNOWN" });
    await settle();
    const v = render({ ...p, actor: actorB });
    expect(v.phase).toBe("switched");
    expect(v.failureCode).toBeNull();
  });
  it("pending result after unmount is dropped; retained handler after unmount does nothing", async () => {
    const d = deferred<SetupPlanConfirmResult>();
    const p = props({ confirmReview: vi.fn(() => d.promise) });
    const v = render(p);
    v.onConfirm();
    unmount();
    d.resolve(okResult());
    await settle();
    expect(p.onConfirmed).not.toHaveBeenCalled();
    const q = props();
    const w = render(q);
    unmount();
    w.onConfirm();
    w.onEdit(0);
    w.onBack();
    w.onConsent(true);
    await settle();
    expect(q.confirmReview).not.toHaveBeenCalled();
    expect(q.onEditBranch).not.toHaveBeenCalled();
    expect(q.onBackToPlans).not.toHaveBeenCalled();
  });
  it("edit/back/consent handlers from A are inert after B is live", () => {
    const onConsentChange = vi.fn();
    const p = props({ onConsentChange });
    const old = render(p);
    render({ ...p, actor: actorB });
    old.onEdit(0);
    old.onBack();
    old.onConsent(false);
    expect(p.onEditBranch).not.toHaveBeenCalled();
    expect(p.onBackToPlans).not.toHaveBeenCalled();
    expect(onConsentChange).not.toHaveBeenCalled();
  });
  it("consent gate, double click single-flight, created is UNPAID and onConfirmed fires once", async () => {
    const d = deferred<SetupPlanConfirmResult>();
    const noConsent = props({ consentAccepted: false });
    render(noConsent).onConfirm();
    expect(noConsent.confirmReview).not.toHaveBeenCalled();
    H.slots = [];
    const p = props({ confirmReview: vi.fn(() => d.promise) });
    const v = render(p);
    v.onConfirm();
    v.onConfirm();
    expect(p.confirmReview).toHaveBeenCalledTimes(1);
    d.resolve(okResult());
    await settle();
    const done = render(p);
    expect(done.phase).toBe("created");
    expect(p.onConfirmed).toHaveBeenCalledTimes(1);
    expect(markup(done)).toContain("Not paid");
  });
  it("STALE_CAPTURE after start: outcome stays unconfirmed, same-op id kept, truthful copy, no 'nothing was sent', no new confirm", async () => {
    const write: SetupPlanWrite = { kind: "inflight", clientOpId: OP, selection: { term: "monthly", slots: [{ persona: "level_1", package: "basic" }] } };
    const p = props({ write: { kind: "idle" }, confirmReview: vi.fn(async () => ({ ok: false as const, code: "STALE_CAPTURE" as const })) });
    render(p).onConfirm();
    await settle();
    // host journey now reports the stored operation (same id); component does not mint one
    const v = render({ ...p, write: { ...write, kind: "unknown", code: "UNKNOWN" } as SetupPlanWrite });
    expect(v.phase === "failed" || v.phase === "unknown").toBe(true);
    const out = markup(render({ ...p, write: { kind: "idle" } }));
    expect(out).not.toMatch(/nothing was sent/i);
    expect(out).toContain("may exist");
    expect(out).toContain("not confirmed");
    const ar = markup({ ...render({ ...p, write: { kind: "idle" } }), ar: true });
    expect(ar).toContain("قد يكون الطلب قد أُنشئ");
    expect(ar).not.toContain("لم يُرسل");
    expect(p.confirmReview).toHaveBeenCalledTimes(1);
    expect(render({ ...p, write: { kind: "idle" } }).outcomeUnknown).toBe(true);
    expect(FAILURE_COPY.session.en).toMatch(/may exist/);
  });
  it("UNKNOWN retry goes through the guarded path: once, then dropped for A after B", async () => {
    const retry = vi.fn(async () => okResult());
    const p = props({
      confirmReview: vi.fn(async () => ({ ok: false as const, code: "UNKNOWN" as const })),
      retrySameOperation: retry,
    });
    render(p).onConfirm();
    await settle();
    const u = render(p);
    expect(u.phase).toBe("unknown");
    expect(u.canRetry).toBe(true);
    u.onRetry();
    u.onRetry();
    expect(retry).toHaveBeenCalledTimes(1);
    await settle();
    expect(p.onConfirmed).toHaveBeenCalledTimes(1);

    H.slots = [];
    const retry2 = vi.fn(async () => okResult());
    const q = props({ confirmReview: vi.fn(async () => ({ ok: false as const, code: "UNKNOWN" as const })), retrySameOperation: retry2 });
    render(q).onConfirm();
    await settle();
    const old = render(q);
    render({ ...q, actor: actorB });
    old.onRetry();
    await settle();
    expect(retry2).not.toHaveBeenCalled();
    expect(q.onConfirmed).not.toHaveBeenCalled();
  });
  it("existing order: amounts shown are order.offer, not the catalog (differs on purpose)", async () => {
    const base = offer();
    const bumped: Es02ImmutableOffer = { ...base, amountBaisa: base.amountBaisa + 5000, slots: base.slots.map((s) => ({ ...s, amountBaisa: s.amountBaisa + 5000 })) };
    const catalogTotal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(base.amountBaisa / 1000);
    const orderTotal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(bumped.amountBaisa / 1000);
    expect(orderTotal).not.toBe(catalogTotal);

    const pre = markup(render(props()));
    expect(pre).toContain(`>${catalogTotal}<`);
    expect(pre).toContain('data-source="preview"');

    // journey write.unpaid carries the server order
    H.slots = [];
    const write: SetupPlanWrite = { kind: "unpaid", clientOpId: OP, selection: { term: "monthly", slots: [{ persona: "level_1", package: "basic" }] }, order: order(bumped), action: "insert", settlement: "UNPAID", serviceReady: false };
    const fromWrite = markup(render(props({ write })));
    expect(fromWrite).toContain(`>${orderTotal}<`);
    expect(fromWrite).not.toContain(`>${catalogTotal}<`);
    expect(fromWrite).toContain('data-source="order"');

    // and straight after confirm (local created result)
    H.slots = [];
    const p = props({ confirmReview: vi.fn(async () => okResult(bumped)) });
    render(p).onConfirm();
    await settle();
    const created = markup(render(p));
    expect(created).toContain(`>${orderTotal}<`);
    expect(created).toContain("SERVER-REF");
  });
});
