import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { commercialAmount, commercialPlan } from "@/components/app/subscription-commercial-catalog";
import { createSetupPlanJourney, type SetupPlanJourney } from "@/components/app/setup-plan-journey";
import type { SubscriptionPersona } from "@/components/app/subscription-offers-view";
import { SetupTeamPlans, type SetupTeamPlansProps } from "./setup-team-plans";

type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
type InspectedElement = { type: unknown; props: Record<string, unknown> };
const state = vi.hoisted(() => ({
  slots: [] as Slot[],
  cursor: 0,
  effects: [] as Array<() => void>,
  frames: [] as Array<() => void>,
  reduced: false,
  visibility: "visible",
  intersecting: true,
  play: "resolve" as "resolve" | "reject" | "pending",
  pendingPlays: [] as Array<{ resolve: () => void; reject: (error: Error) => void }>,
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const slot = () => state.slots[state.cursor++] ?? (state.slots[state.cursor - 1] = {});
  return {
    ...actual,
    useState(initial: unknown) {
      const s = slot();
      if (!("value" in s)) s.value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [
        s.value,
        (v: unknown) => {
          s.value = typeof v === "function" ? (v as (p: unknown) => unknown)(s.value) : v;
        },
      ];
    },
    useRef(initial: unknown) {
      const s = slot();
      return s.value ?? (s.value = { current: initial });
    },
    useId() {
      const s = slot();
      if (!("value" in s)) s.value = ":r0:";
      return s.value as string;
    },
    useEffect(fn: () => void | (() => void), deps: unknown[]) {
      const s = slot();
      if (!s.deps || deps.some((v, i) => !Object.is(v, s.deps![i]))) {
        state.effects.push(() => {
          s.cleanup?.();
          s.cleanup = fn() || undefined;
        });
        s.deps = deps;
      }
    },
  };
});

vi.mock("./setup-team-plans.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

function flushEffects() {
  state.effects.splice(0).forEach((fn) => fn());
}

function flushFrames() {
  const batch = state.frames.splice(0);
  batch.forEach((fn) => fn());
}

function expandNode(node: unknown): unknown {
  if (node == null || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return node;
  if (Array.isArray(node)) return node.map(expandNode);
  if (typeof node !== "object") return node;
  const el = node as { type?: unknown; props?: Record<string, unknown> | null };
  if (typeof el.type === "function") {
    return expandNode((el.type as (props: Record<string, unknown>) => unknown)(el.props ?? {}));
  }
  if (!el.props) return el;
  const ref = el.props.ref as { current?: unknown } | undefined;
  if (ref && typeof ref === "object" && "current" in ref) {
    ref.current ??=
      el.type === "video"
        ? {
            muted: false,
            defaultMuted: false,
            attrs: {} as Record<string, string>,
            pause() {},
            load() {},
            removeAttribute(this: { attrs: Record<string, string> }, name: string) {
              delete this.attrs[name];
            },
            setAttribute(this: { attrs: Record<string, string> }, name: string, value: string) {
              this.attrs[name] = value;
            },
            play() {
              if (state.play === "pending") return new Promise<void>((resolve, reject) => state.pendingPlays.push({ resolve, reject }));
              return state.play === "resolve" ? Promise.resolve() : Promise.reject(new Error("autoplay"));
            },
          }
        : { nodeName: "div" };
  }
  if (!("children" in el.props)) return el;
  return { ...el, props: { ...el.props, children: expandNode(el.props.children) } };
}

function walk(node: unknown, visit: (el: InspectedElement) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (el.props) visit(el as InspectedElement);
  const kids = el.props?.children;
  if (Array.isArray(kids)) kids.forEach((child) => walk(child, visit));
  else if (kids) walk(kids, visit);
}

function findByAttr(tree: unknown, attr: string, value: unknown): InspectedElement | null {
  let found: InspectedElement | null = null;
  walk(tree, (el) => {
    if (el.props[attr] === value) found = el;
  });
  return found;
}

function texts(tree: unknown) {
  return JSON.stringify(tree);
}

const preparation = {
  name: "متجر الندى",
  type: "retail",
  country: "OM",
  city: "مسقط",
  phone: "+96892123456",
  branches: [
    { name: "الرئيسي", city: "مسقط" },
    { name: "صور", city: "صور" },
  ],
};

function journey() {
  const created = createSetupPlanJourney({
    actor: { accountId: "fixture", captureToken: "capture-a", isCurrent: () => true },
    preparation,
  });
  const opened = created.openPlans();
  if (!opened.ok) throw new Error(opened.code);
  return created;
}

function propsFor(source: SetupPlanJourney, calls: { select: number; term: number; back: number; next: number }): SetupTeamPlansProps {
  return {
    ar: true,
    state: source.snapshot(),
    onSelect: (index, choice) => {
      calls.select += 1;
      return source.setSlot(index, choice);
    },
    onTerm: (term) => {
      calls.term += 1;
      return source.setTerm(term);
    },
    onBack: () => {
      calls.back += 1;
      return source.backToPreparation();
    },
    onContinue: () => {
      calls.next += 1;
      return source.localReview();
    },
    readPlan: source.readPlan,
    presentAddons: source.presentAddons,
    motionEnabled: true,
  };
}

function renderPlans(props: SetupTeamPlansProps) {
  state.cursor = 0;
  const tree = expandNode(createElement(SetupTeamPlans, props)) as InspectedElement;
  // Match React's cleanup when conditional leaf components unmount.
  for (const removed of state.slots.splice(state.cursor)) removed.cleanup?.();
  flushEffects();
  return tree;
}

beforeEach(() => {
  state.slots = [];
  state.effects = [];
  state.frames = [];
  state.reduced = false;
  state.visibility = "visible";
  state.intersecting = true;
  state.play = "resolve";
  state.pendingPlays = [];
  vi.stubGlobal("window", {
    matchMedia: () => ({
      matches: state.reduced,
      addEventListener() {},
      removeEventListener() {},
    }),
    requestAnimationFrame: (fn: () => void) => {
      state.frames.push(fn);
      return state.frames.length;
    },
    cancelAnimationFrame() {},
  });
  vi.stubGlobal("document", {
    get visibilityState() {
      return state.visibility;
    },
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private readonly cb: (entries: Array<{ isIntersecting: boolean }>) => void;
      constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
        this.cb = cb;
      }
      observe() {
        this.cb([{ isIntersecting: state.intersecting }]);
      }
      disconnect() {}
    },
  );
});

afterEach(() => {
  for (const slot of state.slots) slot.cleanup?.();
  vi.unstubAllGlobals();
});

it("keeps persona browsing as preview and starts every branch, term, and consent unselected", () => {
  const source = journey();
  const calls = { select: 0, term: 0, back: 0, next: 0 };
  let tree = renderPlans(propsFor(source, calls));
  expect(tree.props.dir).toBe("rtl");
  expect(tree.props["data-confirm-wired"]).toBe("false");
  expect(findByAttr(tree, "data-plans-region", "personas")).toBeTruthy();
  expect(findByAttr(tree, "data-plans-region", "example")).toBeTruthy();
  expect(findByAttr(tree, "data-plans-region", "branches")).toBeTruthy();
  expect(findByAttr(tree, "data-plans-region", "plans")).toBeTruthy();
  expect(texts(tree)).toContain("مثال توضيحي");
  expect(texts(tree)).not.toContain("مثال حقيقي");
  expect(texts(tree)).not.toContain("110");
  expect(findByAttr(tree, "data-term", "monthly")?.props["aria-pressed"]).toBe(false);
  expect(findByAttr(tree, "data-term", "yearly")?.props["aria-pressed"]).toBe(false);
  expect(texts(tree)).toContain("لم يُختر بعد");
  (findByAttr(tree, "data-persona", "level_2")?.props.onClick as (() => void) | undefined)?.();
  tree = renderPlans(propsFor(source, calls));
  expect(calls.select).toBe(0);
  expect(findByAttr(tree, "data-persona", "level_2")?.props["aria-pressed"]).toBe(true);
  expect(findByAttr(tree, "data-preview", "true")?.props["data-persona"]).toBe("level_2");
  expect(source.snapshot().slots.every((slot) => slot.persona === null && slot.package === null)).toBe(true);
  expect(source.snapshot().consentAccepted).toBe(false);
  expect(source.snapshot().write.kind).toBe("idle");
});

it("selects an explicit tier per branch, keeps the other branch, and totals only after a term", () => {
  const source = journey();
  const calls = { select: 0, term: 0, back: 0, next: 0 };
  let tree = renderPlans(propsFor(source, calls));
  const premium = tierButton(tree, "premium");
  (premium?.props.onClick as (() => void) | undefined)?.();
  tree = renderPlans(propsFor(source, calls));
  expect(calls.select).toBe(1);
  expect(texts(tree)).toContain("نورا · المميزة");
  expect(texts(tree)).toContain("صور");
  expect(texts(tree)).toContain("لم يُختر بعد");
  (findByAttr(tree, "data-branch-index", 1)?.props.onClick as (() => void) | undefined)?.();
  tree = renderPlans(propsFor(source, calls));
  expect(calls.select).toBe(1);
  expect(findByAttr(tree, "data-branch-index", 1)?.props["aria-pressed"]).toBe(true);
  (findByAttr(tree, "data-persona", "level_3")?.props.onClick as (() => void) | undefined)?.();
  tree = renderPlans(propsFor(source, calls));
  (tierButton(tree, "basic")?.props.onClick as (() => void) | undefined)?.();
  tree = renderPlans(propsFor(source, calls));
  expect(source.snapshot().slots[0]).toMatchObject({ persona: "level_1", package: "premium" });
  expect(source.snapshot().slots[1]).toMatchObject({ persona: "level_3", package: "basic" });
  expect(findByAttr(tree, "data-selection-total", "")).toBeTruthy();
  (findByAttr(tree, "data-term", "yearly")?.props.onClick as (() => void) | undefined)?.();
  tree = renderPlans(propsFor(source, calls));
  const yearly = commercialAmount(commercialPlan("level_1", "premium"), "yearly") + commercialAmount(commercialPlan("level_3", "basic"), "yearly");
  expect(findByAttr(tree, "data-selection-total", String(yearly))).toBeTruthy();
  expect(texts(tree)).toContain("رد شهريًا");
  expect(texts(tree)).not.toContain("110");
  (findByAttr(tree, "data-plans-back", "true")?.props.onClick as (() => void) | undefined)?.();
  expect(calls.back).toBe(1);
  expect(source.snapshot().step).toBe("preparation");
  expect(source.snapshot().slots[0]?.package).toBe("premium");
});

it("shows every catalog plan, monthly allowance, and future call add-on without a purchase", () => {
  const source = journey();
  const calls = { select: 0, term: 0, back: 0, next: 0 };
  const personas: SubscriptionPersona[] = ["level_1", "level_2", "level_3"];
  let tree = renderPlans(propsFor(source, calls));
  for (const persona of personas) {
    (findByAttr(tree, "data-persona", persona)?.props.onClick as (() => void) | undefined)?.();
    tree = renderPlans(propsFor(source, calls));
    const blob = texts(tree);
    for (const pack of ["basic", "premium"] as const) {
      const plan = commercialPlan(persona, pack);
      expect(blob).toContain(String(commercialAmount(plan, "monthly") / 1000));
      expect(blob).toContain(String(commercialAmount(plan, "yearly") / 1000));
      for (const feature of plan.features) expect(blob).toContain(`"data-feature":"${feature.id}"`);
    }
  }
  (findByAttr(tree, "data-persona", "level_2")?.props.onClick as (() => void) | undefined)?.();
  tree = renderPlans(propsFor(source, calls));
  const callsAddon = findByAttr(tree, "data-addon", "calls");
  expect(callsAddon?.props["data-addon-sale"]).toBe("FUTURE_NOT_READY_FOR_SALE");
  expect(callsAddon?.props["data-addon-included"]).toBe("false");
  expect(texts(callsAddon)).toContain("غير جاهزة للبيع");
  const website = findByAttr(tree, "data-addon", "website");
  expect(website?.props["data-addon-sale"]).toBe("OPTIONAL_SEPARATE");
  expect(website?.props["data-addon-included"]).toBe("false");
  expect(texts(tree)).toContain("لا سعر لها هنا ولا إجراء شراء");
  expect(texts(tree)).toContain("عرض جميع المميزات");
  expect(findByAttr(tree, "role", "tablist")).toBeTruthy();
  expect(calls.select).toBe(0);
  const toggle = findByAttr(tree, "data-features-toggle", "basic");
  let insideTierButton = false;
  walk(tierButton(tree, "basic"), (el) => {
    if (el.props["data-features-toggle"]) insideTierButton = true;
  });
  expect(insideTierButton).toBe(false);
  (toggle?.props.onClick as ((event: { stopPropagation: () => void }) => void) | undefined)?.({ stopPropagation() {} });
  expect(calls.select).toBe(0);
  expect(source.snapshot().slots.every((slot) => slot.persona === null)).toBe(true);
});

it("shows a chosen branch's persona and tier again, while an unchosen branch stays a preview", () => {
  const source = journey();
  const calls = { select: 0, term: 0, back: 0, next: 0 };
  let tree = renderPlans(propsFor(source, calls));
  (tierButton(tree, "premium")?.props.onClick as (() => void) | undefined)?.();
  tree = renderPlans(propsFor(source, calls));
  (findByAttr(tree, "data-branch-index", 1)?.props.onClick as (() => void) | undefined)?.();
  tree = renderPlans(propsFor(source, calls));
  expect(calls.select).toBe(1);
  expect(tierButton(tree, "basic")?.props["aria-pressed"]).toBe(false);
  expect(tierButton(tree, "premium")?.props["aria-pressed"]).toBe(false);
  (findByAttr(tree, "data-persona", "level_2")?.props.onClick as (() => void) | undefined)?.();
  tree = renderPlans(propsFor(source, calls));
  expect(calls.select).toBe(1);
  expect(findByAttr(tree, "data-preview", "true")?.props["data-persona"]).toBe("level_2");
  expect(source.snapshot().slots[1]?.persona).toBeNull();
  (tierButton(tree, "basic")?.props.onClick as (() => void) | undefined)?.();
  tree = renderPlans(propsFor(source, calls));
  (findByAttr(tree, "data-branch-index", 0)?.props.onClick as (() => void) | undefined)?.();
  tree = renderPlans(propsFor(source, calls));
  expect(calls.select).toBe(2);
  expect(findByAttr(tree, "data-preview", "true")?.props["data-persona"]).toBe("level_1");
  expect(tierButton(tree, "premium")?.props["aria-pressed"]).toBe(true);
  expect(texts(tree)).toContain("ماذا تنجز نورا");
  (findByAttr(tree, "data-persona", "level_3")?.props.onClick as (() => void) | undefined)?.();
  tree = renderPlans(propsFor(source, calls));
  expect(calls.select).toBe(2);
  expect(tierButton(tree, "premium")?.props["aria-pressed"]).toBe(false);
  expect(source.snapshot().slots[0]).toMatchObject({ persona: "level_1", package: "premium" });
  expect(source.snapshot().slots[1]).toMatchObject({ persona: "level_2", package: "basic" });
  (findByAttr(tree, "data-features-toggle", "basic")?.props.onClick as ((event: { stopPropagation: () => void }) => void) | undefined)?.({
    stopPropagation() {},
  });
  expect(calls.select).toBe(2);
});

it("continues only through local review and reports a blocked seam without an order", () => {
  const source = journey();
  const calls = { select: 0, term: 0, back: 0, next: 0 };
  let tree = renderPlans(propsFor(source, calls));
  (findByAttr(tree, "data-plans-continue", "true")?.props.onClick as (() => void) | undefined)?.();
  tree = renderPlans(propsFor(source, calls));
  expect(calls.next).toBe(1);
  expect(texts(tree)).toContain("لم يُنشأ أمر");
  expect(source.snapshot().write.kind).toBe("idle");
  expect(source.snapshot().step).toBe("plans");
  (tierButton(tree, "basic")?.props.onClick as (() => void) | undefined)?.();
  (findByAttr(tree, "data-branch-index", 1)?.props.onClick as (() => void) | undefined)?.();
  tree = renderPlans(propsFor(source, calls));
  (findByAttr(tree, "data-persona", "level_2")?.props.onClick as (() => void) | undefined)?.();
  tree = renderPlans(propsFor(source, calls));
  (tierButton(tree, "premium")?.props.onClick as (() => void) | undefined)?.();
  (findByAttr(tree, "data-term", "monthly")?.props.onClick as (() => void) | undefined)?.();
  tree = renderPlans(propsFor(source, calls));
  (findByAttr(tree, "data-plans-continue", "true")?.props.onClick as (() => void) | undefined)?.();
  tree = renderPlans(propsFor(source, calls));
  expect(source.snapshot().step).toBe("localReview");
  expect(source.snapshot().preview?.repliesPerMonth).toBe(
    commercialPlan("level_1", "basic").replies + commercialPlan("level_2", "premium").replies,
  );
  expect(findByAttr(tree, "data-local-seam", "ready")).toBeTruthy();
  expect(texts(tree)).toContain("الربط المالي غير مفعّل");
  expect(source.snapshot().write.kind).toBe("idle");
  const ltr = renderPlans({ ...propsFor(source, calls), ar: false });
  expect(ltr.props.dir).toBe("ltr");
});

it("uses the original focused motion file and falls back to static posters", async () => {
  const source = journey();
  const calls = { select: 0, term: 0, back: 0, next: 0 };
  let tree = renderPlans({ ...propsFor(source, calls), motionEnabled: false });
  flushFrames();
  flushFrames();
  tree = renderPlans({ ...propsFor(source, calls), motionEnabled: false });
  expect(findByAttr(tree, "data-team-video", "motion")).toBeNull();
  expect(texts(tree)).toContain("/media/setup/noura-studio-poster.png");
  expect(texts(tree)).not.toContain(".gif");

  resetLeaf();
  state.reduced = true;
  tree = renderPlans(propsFor(source, calls));
  flushFrames();
  flushFrames();
  tree = renderPlans(propsFor(source, calls));
  expect(findByAttr(tree, "data-team-video", "motion")).toBeNull();
  expect(texts(tree)).toContain("/media/setup/noura-studio-poster.png");

  resetLeaf();
  state.reduced = false;
  state.visibility = "hidden";
  tree = renderPlans(propsFor(source, calls));
  flushFrames();
  flushFrames();
  tree = renderPlans(propsFor(source, calls));
  expect(findByAttr(tree, "data-team-video", "motion")).toBeNull();

  resetLeaf();
  state.visibility = "visible";
  state.intersecting = false;
  tree = renderPlans(propsFor(source, calls));
  flushFrames();
  flushFrames();
  tree = renderPlans(propsFor(source, calls));
  expect(findByAttr(tree, "data-team-video", "motion")).toBeNull();

  resetLeaf();
  state.intersecting = true;
  tree = renderPlans(propsFor(source, calls));
  flushFrames();
  flushFrames();
  tree = renderPlans(propsFor(source, calls));
  flushEffects();
  await Promise.resolve();
  tree = renderPlans(propsFor(source, calls));
  expect(findByAttr(tree, "data-team-video", "motion")).toBeTruthy();
  expect(posterCount(tree)).toBe(2);
  expect(texts(tree)).toContain("/media/setup/lina-team-alpha-poster.png");
  expect(texts(tree)).toContain("/media/setup/dana-team-alpha-poster.png");
  const withSrc = state.slots
    .map((slot) => (slot.value as { current?: { attrs?: Record<string, string> } } | undefined)?.current?.attrs?.src)
    .find(Boolean);
  expect(withSrc).toBe("/media/setup/noura-studio.mp4");

  resetLeaf();
  state.play = "reject";
  tree = renderPlans(propsFor(source, calls));
  flushFrames();
  flushFrames();
  tree = renderPlans(propsFor(source, calls));
  flushEffects();
  await Promise.resolve();
  await Promise.resolve(); // play().then().catch() settles after the rejection propagates.
  tree = renderPlans(propsFor(source, calls));
  expect(posterCount(tree)).toBe(3);
  const blocked = findByAttr(tree, "data-team-video", "motion");
  expect(blocked?.props.style).toMatchObject({ opacity: 0 });
});

it("unloads a pending video and ignores its late rejection after motion restarts", async () => {
  const source = journey();
  const calls = { select: 0, term: 0, back: 0, next: 0 };
  state.play = "pending";
  renderPlans(propsFor(source, calls));
  flushFrames(); flushFrames();
  let tree = renderPlans(propsFor(source, calls));
  expect(posterCount(tree)).toBe(3);
  expect(state.pendingPlays).toHaveLength(1);
  const oldNode = state.slots.map(slot => (slot.value as { current?: { attrs?: Record<string, string> } } | undefined)?.current).find(node => node?.attrs?.src);
  tree = renderPlans({ ...propsFor(source, calls), motionEnabled: false });
  expect(findByAttr(tree, "data-team-video", "motion")).toBeNull();
  expect(oldNode?.attrs?.src).toBeUndefined();
  tree = renderPlans(propsFor(source, calls));
  expect(state.pendingPlays).toHaveLength(2);
  expect(posterCount(tree)).toBe(3);
  state.pendingPlays[0]!.reject(new Error("late autoplay denial"));
  await Promise.resolve(); await Promise.resolve();
  tree = renderPlans(propsFor(source, calls));
  expect(posterCount(tree)).toBe(3);
  expect(findByAttr(tree, "data-team-video", "motion")?.props.style).toBeUndefined();
  state.pendingPlays[1]!.resolve();
  await Promise.resolve(); await Promise.resolve();
  tree = renderPlans(propsFor(source, calls));
  expect(posterCount(tree)).toBe(2);
});

it("returns an edited review branch to its existing persona and tier without changing choices", () => {
  const source = journey();
  source.setSlot(1, { persona: "level_2", package: "premium" });
  const calls = { select: 0, term: 0, back: 0, next: 0 };
  const tree = renderPlans({ ...propsFor(source, calls), initialBranchIndex: 1 });
  expect(findByAttr(tree, "data-branch-index", 1)?.props["aria-pressed"]).toBe(true);
  expect(findByAttr(tree, "data-persona", "level_2")?.props["aria-pressed"]).toBe(true);
  expect(tierButton(tree, "premium")?.props["aria-pressed"]).toBe(true);
  expect(calls.select).toBe(0);
});

it("does not wire financial confirmation in the plans leaf", () => {
  const sourceText = readFileSync(new URL("./setup-team-plans.tsx", import.meta.url), "utf8");
  expect(sourceText).not.toContain("confirmReview");
  expect(sourceText).not.toContain("createAccountBoundOrderAction");
  expect(sourceText).not.toContain("settleAccount");
  expect(sourceText).not.toContain("مثال حقيقي");
  expect(sourceText).not.toContain("${styles.stage} ${styles.media}");
  const css = readFileSync(new URL("./setup-team-plans.module.css", import.meta.url), "utf8");
  expect(css).toContain('"personas panel"');
  expect(css).toContain('"branches plans"');
  expect(css).toContain(".scenarioButtons button[aria-selected=\"true\"]");
  expect(css).not.toContain(".scenario button");
});

function tierButton(tree: unknown, pack: string): InspectedElement | null {
  const host = findByAttr(tree, "data-tier", pack);
  if (!host) return null;
  let button: InspectedElement | null = null;
  walk(host, (el) => {
    if (el.type === "button" && !button) button = el;
  });
  return button;
}

function posterCount(tree: unknown) {
  let count = 0;
  walk(tree, (el) => {
    if (el.props["data-team-poster"] === "static") count += 1;
  });
  return count;
}

it("keeps each branch choice on that slot after the list order changes", () => {
  const source = journey();
  source.setSlot(0, { persona: "level_1", package: "premium" });
  source.setSlot(1, { persona: "level_3", package: "basic" });
  const snap = source.snapshot();
  const reversed = {
    ...snap,
    slots: [...snap.slots].reverse().map((slot) => ({
      ...slot,
      label: { ...slot.label, localId: `row-${slot.label.name}` },
    })),
  };
  const calls = { select: 0, term: 0, back: 0, next: 0 };
  const tree = renderPlans({ ...propsFor(source, calls), state: reversed });
  const first = findByAttr(tree, "data-branch-index", 0);
  const second = findByAttr(tree, "data-branch-index", 1);
  expect(first?.props["data-branch-local-id"]).toBe("row-صور");
  expect(texts(first)).toContain("دانا");
  expect(texts(first)).toContain("القياسية");
  expect(second?.props["data-branch-local-id"]).toBe("row-الرئيسي");
  expect(texts(second)).toContain("نورا");
  expect(texts(second)).toContain("المميزة");
  expect(texts(findByAttr(tree, "data-scenario-mark", "standard"))).toContain("القياسية");
  expect(texts(tree)).not.toContain("إضافة Premium");
  expect(texts(tree)).toContain("إضافة المميزة");
  const english = renderPlans({ ...propsFor(source, calls), ar: false });
  expect(texts(findByAttr(english, "data-plans-continue", "true"))).toContain("→");
  expect(texts(findByAttr(tree, "data-plans-continue", "true"))).toContain("←");
});

function resetLeaf() {
  state.slots = [];
  state.effects = [];
  state.frames = [];
}

it("keeps legacy missing or duplicate local IDs compatible without duplicate sibling keys", () => {
  for (const localId of [undefined, "duplicate", ""]) {
    resetLeaf();
    const draft = { ...preparation, branches: preparation.branches.map(row => ({ ...row, localId })) };
    const source = createSetupPlanJourney({ actor: { accountId: "fixture", captureToken: "capture-a", isCurrent: () => true }, preparation: draft });
    source.openPlans();
    source.setSlot(0, { persona: "level_1", package: "premium" });
    source.setSlot(1, { persona: "level_3", package: "basic" });
    source.backToPreparation();
    source.replacePreparation({ ...draft, branches: [...draft.branches].reverse() });
    source.openPlans();
    expect(source.snapshot().slots.map(slot => slot.persona)).toEqual(["level_3", "level_1"]);
    const tree = renderPlans(propsFor(source, { select: 0, term: 0, back: 0, next: 0 }));
    for (const region of ["branches", "summary"]) {
      const keys: unknown[] = [];
      walk(findByAttr(tree, "data-plans-region", region), el => {
        if (el.props[region === "branches" ? "data-branch-index" : "data-summary-branch"] !== undefined) keys.push((el as InspectedElement & { key?: unknown }).key);
      });
      expect(keys).toHaveLength(2);
      expect(new Set(keys).size).toBe(2);
    }
    const mobile = findByAttr(tree, "data-mobile-branch-select", "true");
    const keys: unknown[] = [];
    walk(mobile, el => { if (el.type === "option") keys.push((el as InspectedElement & { key?: unknown }).key); });
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  }
});

it("labels selection totals by the actual term and keeps one portrait per selected branch", () => {
  const source = journey();
  source.setSlot(0, { persona: "level_1", package: "basic" });
  source.setSlot(1, { persona: "level_2", package: "premium" });
  source.setTerm("yearly");
  const calls = { select: 0, term: 0, back: 0, next: 0 };
  let tree = renderPlans({ ...propsFor(source, calls), ar: false });
  const summary = findByAttr(tree, "data-plans-region", "summary");
  expect(texts(summary)).toContain("Yearly total");
  expect(texts(summary)).not.toContain("Monthly total");
  const portraits: InspectedElement[] = [];
  walk(summary, el => { if (el.props["data-selected-persona"]) portraits.push(el); });
  expect(portraits.map(el => el.props["data-selected-persona"])).toEqual(["level_1", "level_2"]);
  expect(texts(summary)).toContain(String((commercialAmount(commercialPlan("level_1", "basic"), "yearly") + commercialAmount(commercialPlan("level_2", "premium"), "yearly")) / 1000));
  expect(texts(summary)).toContain("Review order");
  source.setTerm("monthly");
  tree = renderPlans({ ...propsFor(source, calls), ar: false });
  expect(texts(findByAttr(tree, "data-plans-region", "summary"))).toContain("Monthly total");
  expect(calls.select).toBe(0);
  expect(source.snapshot().write.kind).toBe("idle");
});
it("highlights each persona's own Standard duties rather than only shared FAQs", () => {
  const source = journey();
  const calls = { select: 0, term: 0, back: 0, next: 0 };
  let tree = renderPlans({ ...propsFor(source, calls), ar: false });
  for (const [persona, feature] of [["level_2", "recommendations"], ["level_3", "orders"]] as const) {
    (findByAttr(tree, "data-persona", persona)?.props.onClick as () => void)();
    tree = renderPlans({ ...propsFor(source, calls), ar: false });
    const highlights = findByAttr(findByAttr(tree, "data-tier", "basic"), "className", "keyFeatures");
    const expected = commercialPlan(persona, "basic").features.find(item => item.id === feature)!;
    expect(texts(highlights)).toContain(expected.label.en);
  }
  expect(calls.select).toBe(0);
});
