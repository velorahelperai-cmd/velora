import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BranchSlotChoice, SetupPlanConfirmResult, SetupPlanWrite } from "@/components/app/setup-plan-journey";
import { annualDiscountPercent, commercialAmount, commercialPlan } from "@/components/app/subscription-commercial-catalog";
import {
  SetupOrderReview,
  SetupOrderReviewView,
  safeTestCheckoutUrl,
  type SetupOrderReviewProps,
  type ViewProps,
} from "./setup-order-review";
import {
  FAILURE_COPY,
  actorKey,
  branchCountLabel,
  buildReviewModel,
  channelsLabel,
  classifyFailure,
  createConfirmRunner,
  formatOmr,
  seatsLabel,
} from "./setup-order-review-model";

type Props = Record<string, unknown> & { children?: ReactNode };

/** Expand hook-free function components and collect host elements (no DOM in this repo's node env). */
function collect(node: ReactNode, out: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, out));
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as ReactElement<Props>;
  // Hook-bearing leaf components (marked `hooks`) cannot run outside React; keep them as host-like leaves.
  if (typeof el.type === "function" && (el.type as unknown as { hooks?: boolean }).hooks) {
    out.push(el);
    return out;
  }
  if (typeof el.type === "function") return collect((el.type as (p: Props) => ReactNode)(el.props), out);
  out.push(el);
  collect(el.props.children, out);
  return out;
}
const byAttr = (tree: ReactNode, attr: string, value: string) =>
  collect(tree).filter((e) => e.props[attr] === value);

const slot = (name: string, city: string, persona: BranchSlotChoice["persona"], pack: BranchSlotChoice["package"]): BranchSlotChoice => ({
  label: { name, city },
  persona,
  package: pack,
});
const SLOTS: BranchSlotChoice[] = [
  slot("Branch A", "Muscat", "level_1", "basic"),
  slot("Branch B", "Salalah", "level_2", "premium"),
  slot("Branch C", "Sohar", "level_3", "basic"),
];
const idle: SetupPlanWrite = { kind: "idle" };
const ACTOR = { accountId: "acc-1", captureToken: "tok-1" };

describe("Paymob Test destination", () => {
  it("accepts only the configured Test checkout origin and credentials", () => {
    const url = "https://om.checkout.paymob.com/?publicKey=om_pk_test_example&clientSecret=pi_test_example";
    expect(safeTestCheckoutUrl(url)).toBe(url);
    expect(safeTestCheckoutUrl(url.replace("om_pk_test_", "omn_pk_test_"))).not.toBeNull();
    expect(safeTestCheckoutUrl(url.replace("om_pk_test_", "omn_pk_test_").replace("pi_test_", "omn_csk_test_"))).not.toBeNull();
    for (const invalid of ["bad", "javascript:alert(1)", url.replace("om.checkout.paymob.com", "attacker.example"), url.replace("om_pk_test_", "om_pk_live_"), url.replace("pi_test_", "pi_live_"), `${url}#fragment`]) expect(safeTestCheckoutUrl(invalid)).toBeNull();
  });
});

function viewProps(over: Partial<ViewProps> = {}): ViewProps {
  const model = buildReviewModel(SLOTS, "monthly");
  return {
    ar: true,
    model,
    slots: SLOTS,
    phase: "ready",
    consent: false,
    locked: false,
    failureCode: null,
    reference: null,
    canRetry: false,
    termsHref: "/terms",
    ids: { title: "t", consent: "c", status: "s" },
    onConsent: vi.fn(),
    onConfirm: vi.fn(),
    onRetry: vi.fn(),
    onEdit: vi.fn(),
    onBack: vi.fn(),
    ...over,
  };
}
const html = (p: ViewProps) => renderToStaticMarkup(createElement(SetupOrderReviewView, p));
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

function okResult(): Extract<SetupPlanConfirmResult, { ok: true }> {
  return {
    ok: true,
    settlement: "UNPAID",
    serviceReady: false,
    action: "insert",
    clientOpId: "op",
    order: { specialReference: "REF-123" } as never,
  };
}

describe("review model totals come from the catalog", () => {
  it("monthly and yearly totals equal the summed commercialAmount", () => {
    for (const term of ["monthly", "yearly"] as const) {
      const m = buildReviewModel(SLOTS, term);
      const expected = SLOTS.reduce((s, x) => s + commercialAmount(commercialPlan(x.persona!, x.package!), term), 0);
      expect(m.totalBaisa).toBe(expected);
      expect(m.complete).toBe(true);
    }
    const monthly = buildReviewModel(SLOTS, "monthly").totalBaisa;
    expect(buildReviewModel(SLOTS, "yearly").totalBaisa).toBe((monthly * 12 * (100 - annualDiscountPercent)) / 100);
  });
  it("handles 1, 2 and many branches and incomplete choices", () => {
    expect(buildReviewModel(SLOTS.slice(0, 1), "monthly").rows).toHaveLength(1);
    expect(buildReviewModel(SLOTS.slice(0, 2), "yearly").rows).toHaveLength(2);
    const many = Array.from({ length: 12 }, (_, i) => slot(`B${i}`, "C", "level_1", "basic"));
    const m = buildReviewModel(many, "monthly");
    expect(m.rows).toHaveLength(12);
    expect(m.totalBaisa).toBe(12 * commercialPlan("level_1", "basic").monthlyBaisa);
    const bad = buildReviewModel([...SLOTS, slot("X", "Y", null, null)], "monthly");
    expect(bad.complete).toBe(false);
    expect(bad.incomplete).toEqual([3]);
    expect(buildReviewModel(SLOTS, null).complete).toBe(false);
    expect(buildReviewModel([], "monthly").complete).toBe(false);
  });
  it("formats labels", () => {
    expect(formatOmr(45000)).toBe("45");
    expect(formatOmr(1500)).toBe("1.5");
    expect(seatsLabel(2, true)).toBe("مقعدان للموظفين");
    expect(seatsLabel(4, true)).toBe("4 مقاعد للموظفين");
    expect(channelsLabel(1, true)).toBe("قناة واحدة");
    expect(channelsLabel(2, true)).toBe("قناتان");
    expect(branchCountLabel(2, true)).toBe("فرعان");
    expect(branchCountLabel(5, true)).toBe("5 فروع");
    expect(branchCountLabel(1, false)).toBe("1 branch");
  });
});

describe("static markup", () => {
  it("renders Arabic RTL page with catalog values per branch and monthly total", () => {
    const out = html(viewProps());
    const plain = text(out);
    expect(out).toContain('dir="rtl"');
    expect(out).toContain('lang="ar"');
    for (const s of ["راجع تفاصيل اشتراكك", "راجع اختياراتك قبل الانتقال للدفع.", "تفاصيل الاشتراك", "ملخص الطلب", "الإجمالي الشهري", "لم يتم الدفع", "أوافق على", "شروط الاشتراك", "المتابعة للدفع", "العودة للباقات", "الدفع الإلكتروني غير متاح حالياً", "اختياراتك محلية ولم يبدأ الدفع. يمكنك إدخالها مجددًا إذا أُغلق المتصفح.", "نورا • القياسية", "لينا • المميزة", "دانا • القياسية", "مراجعة الطلب"]) {
      expect(plain).toContain(s);
    }
    for (const x of SLOTS) {
      const plan = commercialPlan(x.persona!, x.package!);
      expect(plain).toContain(`${formatOmr(commercialAmount(plan, "monthly"))} ر.ع شهرياً`);
      expect(plain).toContain(`${new Intl.NumberFormat("en-US").format(plan.replies)} رد شهرياً`);
    }
    expect(out).not.toMatch(/\?{3,}/);
    expect(plain).toContain("3 فروع");
    expect(plain).toContain("شهرية");
  });
  it("yearly shows the yearly total from the catalog and replies stay monthly", () => {
    const model = buildReviewModel(SLOTS, "yearly");
    const out = html(viewProps({ model }));
    const plain = text(out);
    expect(plain).toContain("الإجمالي السنوي");
    expect(plain).toContain("سنوية");
    expect(plain).toContain(`${formatOmr(model.totalBaisa)} ر.ع`);
    expect(plain).toContain("رد شهرياً");
    expect(plain).toContain("ر.ع سنوياً");
  });
  it("English variant is LTR", () => {
    const out = html(viewProps({ ar: false }));
    expect(out).toContain('dir="ltr"');
    expect(out).toContain("Review your subscription");
    expect(text(out)).toContain("Noura • Standard");
    expect(text(out)).toContain("Continue to payment");
  });
  it("initial markup is the static poster only (motion mounts after visibility), no payment fields", () => {
    const out = html(viewProps());
    expect(out).not.toMatch(/<video|\.gif|\.mp4|e25570a9/);
    expect(out).toContain("/media/setup/noura-studio-poster.png");
    expect(out).not.toMatch(/cvv|paymob|expiry|card-?number|name="card|autocomplete="cc/i);
    expect(collect(SetupOrderReviewView(viewProps())).filter((e) => e.type === "input").map((e) => e.props.type)).toEqual(["checkbox"]);
  });
  it("branch data never lands in attributes other than local labels", () => {
    const out = html(viewProps());
    expect(out).not.toMatch(/href="[^"]*Branch/);
    expect(out).not.toMatch(/data-[a-z-]+="[^"]*(Branch|Muscat)/);
  });
});

describe("terms link", () => {
  it("links only to the provided href and opens in a new tab", () => {
    const out = html(viewProps({ termsHref: "/terms" }));
    expect(out).toContain('href="/terms"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(html(viewProps({ termsHref: "/custom-terms" }))).toContain('href="/custom-terms"');
  });
  it("null href renders plain text, no link", () => {
    const out = html(viewProps({ termsHref: null }));
    expect(out).not.toContain("data-role=\"terms-link\"");
    expect(out).toContain("شروط الاشتراك");
    expect(out).not.toMatch(/<a /);
  });
  it("the wrapper defaults to the existing /terms route", () => {
    const out = renderToStaticMarkup(createElement(SetupOrderReview, wrapperProps()));
    expect(out).toContain('href="/terms"');
  });
});

describe("view interaction", () => {
  it("consent is unchecked and confirm is disabled until checked", () => {
    const off = viewProps();
    expect(byAttr(SetupOrderReviewView(off), "data-role", "consent")[0].props.checked).toBe(false);
    expect(byAttr(SetupOrderReviewView(off), "data-action", "confirm")[0].props.disabled).toBe(true);
    const on = viewProps({ consent: true });
    expect(byAttr(SetupOrderReviewView(on), "data-action", "confirm")[0].props.disabled).toBe(false);
    (byAttr(SetupOrderReviewView(off), "data-role", "consent")[0].props.onChange as (e: unknown) => void)({ target: { checked: true } });
    expect(off.onConsent).toHaveBeenCalledWith(true);
  });
  it("confirm stays disabled while confirming or when selection is incomplete", () => {
    const busy = SetupOrderReviewView(viewProps({ phase: "confirming", consent: true, locked: true }));
    const btn = byAttr(busy, "data-action", "confirm")[0];
    expect(btn.props.disabled).toBe(true);
    expect(btn.props["aria-busy"]).toBe(true);
    const incomplete = viewProps({ model: buildReviewModel([...SLOTS, slot("X", "Y", null, null)], "monthly"), consent: true });
    expect(byAttr(SetupOrderReviewView(incomplete), "data-action", "confirm")[0].props.disabled).toBe(true);
  });
  it("edit and back callbacks carry the right index and keep data", () => {
    const p = viewProps();
    const tree = SetupOrderReviewView(p);
    const edits = byAttr(tree, "data-action", "edit");
    expect(edits).toHaveLength(3);
    (edits[1].props.onClick as () => void)();
    (edits[2].props.onClick as () => void)();
    expect(p.onEdit).toHaveBeenNthCalledWith(1, 1);
    expect(p.onEdit).toHaveBeenNthCalledWith(2, 2);
    (byAttr(tree, "data-action", "back")[0].props.onClick as () => void)();
    expect(p.onBack).toHaveBeenCalledTimes(1);
    expect(SLOTS.map((s) => s.label.name)).toEqual(["Branch A", "Branch B", "Branch C"]);
  });
  it("UNKNOWN: no confirm button, retry only via the reconciliation callback", () => {
    const p = viewProps({ phase: "unknown", consent: true, locked: true, canRetry: true });
    const tree = SetupOrderReviewView(p);
    expect(byAttr(tree, "data-action", "confirm")).toHaveLength(0);
    expect(html(p)).toContain("قد يكون الطلب قد أُنشئ بالفعل");
    expect(text(html(p))).not.toContain("المتابعة للدفع");
    const retry = byAttr(tree, "data-action", "retry");
    expect(retry).toHaveLength(1);
    (retry[0].props.onClick as () => void)();
    expect(p.onRetry).toHaveBeenCalledTimes(1);
    expect(byAttr(SetupOrderReviewView(viewProps({ phase: "unknown", locked: true, canRetry: false })), "data-action", "retry")).toHaveLength(0);
  });
  it("created state shows server reference and unpaid, no confirm", () => {
    const p = viewProps({ phase: "created", reference: "REF-123", locked: true });
    const out = html(p);
    expect(out).toContain("REF-123");
    expect(text(out)).toContain("لم يتم الدفع");
    expect(text(out)).toContain("الخدمة غير مفعّلة");
    expect(byAttr(SetupOrderReviewView(p), "data-action", "confirm")).toHaveLength(0);
  });
  it("error and session states use code-mapped copy without raw codes, in an aria-live region", () => {
    const err = html(viewProps({ phase: "failed", failureCode: "OFFER_TAMPER" }));
    expect(err).toContain('aria-live="polite"');
    expect(text(err)).toContain(FAILURE_COPY.selection.ar);
    expect(err).not.toContain("OFFER_TAMPER");
    expect(classifyFailure("ACTOR_NOT_CURRENT")).toBe("session");
    expect(classifyFailure("STALE_CAPTURE")).toBe("session");
    expect(classifyFailure("SOMETHING_NEW")).toBe("generic");
    expect(text(html(viewProps({ phase: "switched", locked: true })))).toContain("تغيّر الحساب");
    for (const ar of [true, false]) {
      const copy = text(html(viewProps({ ar, phase: "switched", locked: true }))) + FAILURE_COPY.session.ar + FAILURE_COPY.session.en;
      expect(copy).not.toMatch(/nothing was sent|لم يُرسل|ولم يُرسل/i);
    }
  });
});

describe("confirm runner", () => {
  it("ignores a second run while pending and calls confirm once", async () => {
    const runner = createConfirmRunner<number>();
    let release!: (n: number) => void;
    const call = vi.fn(() => new Promise<number>((r) => (release = r)));
    const first = runner.run(call, "k", () => "k", () => -1);
    const second = await runner.run(call, "k", () => "k", () => -1);
    expect(second).toEqual({ kind: "ignored" });
    release(7);
    expect(await first).toEqual({ kind: "done", result: 7 });
    expect(call).toHaveBeenCalledTimes(1);
    expect(runner.isBusy()).toBe(false);
  });
  it("drops results after the actor token changed", async () => {
    const runner = createConfirmRunner<number>();
    let current = actorKey(ACTOR);
    const out = await runner.run(async () => { current = actorKey({ accountId: "acc-2", captureToken: "tok-1" }); return 1; }, actorKey(ACTOR), () => current, () => -1);
    expect(out).toEqual({ kind: "stale" });
  });
  it("maps a rejected call to the provided unknown result", async () => {
    const runner = createConfirmRunner<string>();
    const out = await runner.run(async () => { throw new Error("x"); }, "k", () => "k", () => "UNKNOWN");
    expect(out).toEqual({ kind: "done", result: "UNKNOWN" });
  });
});

function wrapperProps(over: Partial<SetupOrderReviewProps> = {}): SetupOrderReviewProps {
  return {
    ar: true,
    slots: SLOTS,
    term: "monthly",
    write: idle,
    actor: ACTOR,
    confirmReview: vi.fn(async () => okResult()),
    onEditBranch: vi.fn(),
    onBackToPlans: vi.fn(),
    ...over,
  };
}

describe("wrapper", () => {
  it("does not call confirm on mount; consent starts false; confirm disabled", () => {
    const props = wrapperProps();
    const out = renderToStaticMarkup(createElement(SetupOrderReview, props));
    expect(props.confirmReview).not.toHaveBeenCalled();
    expect(out).not.toMatch(/checked=""/);
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*data-action="confirm"|<button[^>]*data-action="confirm"[^>]*disabled=""/);
  });
  it("renders journey write states: inflight, unknown, unpaid, denied", () => {
    const sel = { term: "monthly", slots: [] } as never;
    const base = { clientOpId: "op", selection: sel };
    const inflight = renderToStaticMarkup(createElement(SetupOrderReview, wrapperProps({ write: { kind: "inflight", ...base }, consentAccepted: true })));
    expect(inflight).toContain('aria-busy="true"');
    expect(inflight).toContain("جارٍ التحقق من توفر الدفع");
    const unknown = renderToStaticMarkup(createElement(SetupOrderReview, wrapperProps({ write: { kind: "unknown", code: "UNKNOWN", ...base }, retrySameOperation: vi.fn() })));
    expect(unknown).toContain("قد يكون الطلب قد أُنشئ بالفعل");
    expect(unknown).toContain('data-action="retry"');
    expect(unknown).not.toContain('data-action="confirm"');
    const unpaid = renderToStaticMarkup(createElement(SetupOrderReview, wrapperProps({ write: { kind: "unpaid", ...base, order: { specialReference: "REF-9" } as never, action: "insert", settlement: "UNPAID", serviceReady: false } })));
    expect(unpaid).toContain("REF-9");
    const denied = renderToStaticMarkup(createElement(SetupOrderReview, wrapperProps({ write: { kind: "denied", code: "UNAVAILABLE", ...base } })));
    expect(denied).toContain(FAILURE_COPY.unavailable.ar);
    expect(denied).not.toContain("UNAVAILABLE");
  });
  it("no motion in the stylesheet except reduced-motion guard", async () => {
    const css = await import("node:fs").then((fs) => fs.readFileSync(new URL("./setup-order-review.module.css", import.meta.url), "utf8"));
    expect(css).toContain("prefers-reduced-motion:reduce");
    expect(css).not.toMatch(/@keyframes/);
    expect(css).not.toMatch(/(^|[^-])(left|right)\s*:/);
  });
});
it("uses verified full-body alpha portraits for Dana and Lina while preserving Noura identity", () => {
  const out = html(viewProps());
  expect(out).toContain('/media/setup/dana-team-alpha-poster.png');
  expect(out).toContain('/media/setup/lina-team-alpha-poster.png');
  expect(out).toContain('/media/setup/noura-studio-poster.png');
  expect(out).not.toContain('/media/setup/dana-team-poster.png');
  expect(out).not.toContain('/media/setup/lina-team-poster.png');
});
it("describes deferred payment preflight without claiming an order is being created", () => {
  const out = html(viewProps({ ar: false, phase: "confirming", consent: true }));
  expect(text(out)).toContain("Checking payment availability");
  expect(text(out)).not.toContain("Creating the order");
});
