import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";
import type { SetupOrderReviewProps } from "./setup-order-review";

type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
type InspectedElement = { type: unknown; props: Record<string, unknown> };
const state = vi.hoisted(() => ({
  slots: [] as Slot[],
  cursor: 0,
  effects: [] as Array<() => void>,
  isCurrent: true,
  ready: true,
  boundary: "boundary-a",
  frames: [] as Array<() => void>,
  review: null as SetupOrderReviewProps | null,
  createCalls: [] as unknown[],
  createReply: null as Promise<unknown> | null,
  componentKey: null as string | null,
}));

vi.mock("@/lib/billing/es02/account-order-actions", () => ({
  beginAccountPaymentAction: (input: unknown) => {
    state.createCalls.push(input);
    return state.createReply ?? Promise.resolve({ ok: false, code: "UNKNOWN" });
  },
}));

vi.mock("./setup-order-review", () => ({
  SetupOrderReview: (props: SetupOrderReviewProps) => {
    state.review = props;
    return createElement("section", { "data-review-binding": "true" });
  },
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const slot = () => state.slots[state.cursor++] ?? (state.slots[state.cursor - 1] = {});
  const memo = (fn: () => unknown, deps: unknown[]) => {
    const s = slot();
    if (!s.deps || deps.some((v, i) => !Object.is(v, s.deps![i]))) {
      s.value = fn();
      s.deps = deps;
    }
    return s.value;
  };
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
    useMemo: memo,
    useCallback: (fn: () => unknown, deps: unknown[]) => memo(() => fn, deps),
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

vi.mock("next/link", () => ({
  default: function MockLink(props: { href: string; className?: string; children?: ReactNode }) {
    return createElement("a", { href: props.href, className: props.className }, props.children);
  },
}));
vi.mock("./account-chrome", () => ({
  AccountMenu: () => null,
  useOptionalAccountSession: () => ({
    status: "ready",
    identity: { userId: "11111111-2222-4333-8444-555555555555" },
    isCurrentUser: () => state.isCurrent,
    liveSnapshot: () => ({
      status: state.isCurrent ? "ready" : "expired",
      userId: state.isCurrent ? "11111111-2222-4333-8444-555555555555" : null,
      boundaryFingerprint: state.boundary || null,
      ready: state.ready && state.isCurrent,
    }),
  }),
}));
vi.mock("./ui", () => ({ LangSwitch: () => null }));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: "ar" }) }));
vi.mock("./business-name-suggestions", () => ({
  BusinessNameSuggestions: function MockName(props: { id: string; value: string; onChange: (v: string) => void }) {
    return createElement("input", {
      id: props.id,
      value: props.value,
      "data-field": "name",
      onChange: (e: { target: { value: string } }) => props.onChange(e.target.value),
    });
  },
}));
vi.mock("./business-type-combobox", () => ({
  BusinessTypeCombobox: function MockType(props: { id: string; value: string; onChange: (v: string) => void }) {
    return createElement("input", {
      id: props.id,
      value: props.value,
      "data-field": "type",
      onChange: (e: { target: { value: string } }) => props.onChange(e.target.value),
    });
  },
}));
vi.mock("./country-combobox", () => ({
  CountryCombobox: function MockCountry(props: { id: string; value: string; onChange: (v: string) => void }) {
    return createElement("input", {
      id: props.id,
      value: props.value,
      "data-field": "country",
      onChange: (e: { target: { value: string } }) => props.onChange(e.target.value),
    });
  },
}));
vi.mock("./business-phone-field", () => ({
  BusinessPhoneField: function MockPhone(props: {
    id: string;
    value: string;
    onChange: (v: string) => void;
    label: string;
  }) {
    return createElement("input", {
      id: props.id,
      value: props.value,
      "data-field": "phone",
      "aria-label": props.label,
      onChange: (e: { target: { value: string } }) => props.onChange(e.target.value),
    });
  },
}));
vi.mock("./setup-studio-noura", () => ({
  SetupStudioNoura: function MockNoura(props: { motionEnabled: boolean }) {
    return createElement("div", { "data-setup-noura": "stub", "data-motion": String(props.motionEnabled) });
  },
}));
vi.mock("./setup-entry.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));
vi.mock("./prepayment-preparation.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));
vi.mock("./setup-studio.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));
vi.mock("./setup-team-plans.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

import { PrepaymentPreparation, PreparationForm } from "./prepayment-preparation";

function flushEffects() {
  state.effects.splice(0).forEach((fn) => fn());
}

/**
 * Execute nested function components in tree order so hooks continue on the same
 * stable slot cursor for this render. Intrinsics/mocks expand to host elements.
 */
function expandNode(node: unknown): unknown {
  if (node == null || typeof node === "boolean" || typeof node === "string" || typeof node === "number") {
    return node;
  }
  if (Array.isArray(node)) return node.map(expandNode);
  if (typeof node !== "object") return node;
  const el = node as { type?: unknown; key?: string | null; props?: Record<string, unknown> | null };
  if (typeof el.type === "function") {
    // Model React's keyed mount boundary: old effects and hook state belong to
    // the prior instance, including its callbacks and pending journey.
    if (el.key != null) {
      const key = `${el.type.name}:${el.key}`;
      if (state.componentKey !== null && state.componentKey !== key) {
        for (const slot of state.slots) slot.cleanup?.();
        state.slots = [];
        state.effects = [];
        state.cursor = 0;
      }
      state.componentKey = key;
    }
    const rendered = (el.type as (props: Record<string, unknown>) => unknown)(el.props ?? {});
    return expandNode(rendered);
  }
  if (!el.props) return el;
  if (!("children" in el.props)) return el;
  return {
    ...el,
    props: {
      ...el.props,
      children: expandNode(el.props.children),
    },
  };
}

function walk(node: unknown, visit: (el: InspectedElement) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((k) => walk(k, visit));
    return;
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (el.props) visit(el as InspectedElement);
  const kids = el.props?.children;
  if (Array.isArray(kids)) kids.forEach((k) => walk(k, visit));
  else if (kids) walk(kids, visit);
}

function collectButtons(tree: unknown): Array<{ props: Record<string, unknown>; text: string }> {
  const buttons: Array<{ props: Record<string, unknown>; text: string }> = [];
  walk(tree, (el) => {
    if (el.type !== "button") return;
    buttons.push({ props: el.props, text: JSON.stringify(el.props.children ?? "") });
  });
  return buttons;
}

function findByAttr(tree: unknown, attr: string, value: string): InspectedElement | null {
  const matches: InspectedElement[] = [];
  walk(tree, (el) => {
    if (el.props[attr] === value) matches.push(el);
  });
  return matches.length > 0 ? matches[matches.length - 1]! : null;
}

function renderStudio(): InspectedElement {
  state.cursor = 0;
  const root = PrepaymentPreparation({ userId: "11111111-2222-4333-8444-555555555555", variant: "studio" });
  const tree = expandNode(root) as InspectedElement;
  flushEffects();
  return tree;
}

function openStudioIdentity(tree: InspectedElement): InspectedElement {
  let current = tree;
  for (let i = 0; i < 3 && !findByAttr(current, "data-field", "name"); i += 1) {
    const activity = findByAttr(current, "data-setup-substep-button", "activity");
    if (!activity) break;
    (activity.props.onClick as () => void)();
    current = renderStudio();
  }
  if (findByAttr(current, "data-field", "name")) return current;
  let identity: InspectedElement | null = null;
  walk(current, (el) => {
    if (el.type === "button" && String(el.props["aria-controls"] ?? "").endsWith("-identity-panel")) identity = el;
  });
  const button = identity as InspectedElement | null;
  (button?.props.onClick as (() => void) | undefined)?.();
  return renderStudio();
}

beforeEach(() => {
  state.review = null;
  state.componentKey = null;
  state.createCalls = [];
  state.createReply = null;
  state.slots = [];
  state.effects = [];
  state.frames = [];
  state.isCurrent = true;
  state.ready = true;
  state.boundary = "boundary-a";
  vi.stubGlobal("window", {
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    requestAnimationFrame: (fn: () => void) => {
      state.frames.push(fn);
      return 1;
    },
    cancelAnimationFrame: () => {},
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  });
});

afterEach(() => {
  for (const slot of state.slots) slot.cleanup?.();
  vi.unstubAllGlobals();
});

it("renders a blank local form and no payment or server-submit action", () => {
  const html = renderToStaticMarkup(createElement(PrepaymentPreparation, { userId: "11111111-2222-4333-8444-555555555555" }));
  expect(html).toContain("data-service-theme");
  expect(html).toContain("مراجعة البيانات محليًا");
  expect(html).toContain("اسم الفرع");
  expect(html).not.toContain("<form");
  expect(html).not.toContain('type="submit"');
  expect(html).not.toContain("action=");
  expect(html).not.toContain('name="password"');
  expect(html).not.toContain("Continue to financial order");
  expect(html).not.toContain("المتابعة للأمر المالي");
  expect(html).not.toContain('data-setup-studio="true"');
});

it("studio variant mounts blank in-memory defaults without reference mock values", () => {
  const tree = renderStudio();
  expect(tree.props["data-setup-studio"]).toBe("true");
  const name = findByAttr(tree, "data-field", "name");
  expect(name?.props.value).toBe("");
  const summary = findByAttr(tree, "data-setup-summary", "true");
  const summaryText = JSON.stringify(summary?.props.children ?? "");
  expect(summaryText).not.toContain("نشاط تجريبي");
  expect(summaryText).not.toContain("متجر بالتجزئة");
});

it("a lost actor discards the draft even if the same boundary later returns", () => {
  let tree = openStudioIdentity(renderStudio());
  const name = findByAttr(tree, "data-field", "name");
  (name?.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "Prior actor draft" } });
  expect(findByAttr(openStudioIdentity(renderStudio()), "data-field", "name")?.props.value).toBe("Prior actor draft");
  state.isCurrent = false;
  renderStudio();
  state.isCurrent = true;
  tree = openStudioIdentity(renderStudio());
  expect(findByAttr(tree, "data-field", "name")?.props.value).toBe("");
  expect(state.createCalls).toHaveLength(0);
});

it("collapsed Add branch opens a new local branch and preserves the existing row", () => {
  let tree = renderStudio();
  const add = findByAttr(tree, "data-setup-add-branch", "true");
  expect(add).toBeTruthy();
  (add?.props.onClick as (() => void) | undefined)?.();
  tree = renderStudio();
  let fieldsets = 0;
  walk(tree, (el) => { if (el.type === "fieldset") fieldsets += 1; });
  expect(fieldsets).toBe(2);
  expect(collectButtons(tree).some(b => b.props["aria-pressed"] === true)).toBe(true);
  expect(state.createCalls).toHaveLength(0);
});

it("studio branch mode add/remove keeps at least one branch via state callbacks", () => {
  let tree = renderStudio();
  const openBranches = collectButtons(tree).find((b) => b.text.includes("فروعك"));
  expect(openBranches).toBeTruthy();
  (openBranches?.props.onClick as (() => void) | undefined)?.();
  tree = renderStudio();
  const multi = collectButtons(tree).find((b) => b.text.includes("عدة فروع") && "aria-pressed" in b.props);
  expect(multi).toBeTruthy();
  (multi?.props.onClick as (() => void) | undefined)?.();
  tree = renderStudio();
  const add = collectButtons(tree).find((b) => b.text.includes("إضافة فرع"));
  expect(add).toBeTruthy();
  (add?.props.onClick as (() => void) | undefined)?.();
  tree = renderStudio();
  let fieldsets = 0;
  walk(tree, (el) => {
    if (el.type === "fieldset") fieldsets += 1;
  });
  expect(fieldsets).toBeGreaterThanOrEqual(2);
  const remove = collectButtons(tree).find((b) => b.text.includes("إزالة الفرع") && b.props.disabled !== true);
  expect(remove).toBeTruthy();
  (remove?.props.onClick as (() => void) | undefined)?.();
  tree = renderStudio();
  const removes = collectButtons(tree).filter((b) => b.text.includes("إزالة الفرع"));
  expect(removes.some((b) => b.props.disabled === true)).toBe(true);
});

it("studio review action runs validation callback and keeps accordion aria-expanded honest", () => {
  let tree = renderStudio();
  const identity = collectButtons(tree).find((b) => String(b.props["aria-controls"] ?? "").endsWith("-identity-panel"));
  expect(identity?.props["aria-expanded"]).toBe(true);
  const review = findByAttr(tree, "data-setup-review-action", "true");
  (review?.props.onClick as (() => void) | undefined)?.();
  tree = renderStudio();
  expect(findByAttr(tree, "role", "alert")).toBeTruthy();
  expect(findByAttr(tree, "data-setup-review", "true")).toBeNull();
});

it("current-actor fence returns null preparation when isCurrent is false", () => {
  state.cursor = 0;
  const tree = PreparationForm({ ar: true, userId: "11111111-2222-4333-8444-555555555555", isCurrent: () => false });
  flushEffects();
  expect(tree).toBeNull();
});

it("live summary reflects in-memory name edits through onChange", () => {
  let tree = renderStudio();
  const name = findByAttr(tree, "data-field", "name");
  (name?.props.onChange as ((e: { target: { value: string } }) => void) | undefined)?.({
    target: { value: "اسم محلي" },
  });
  tree = renderStudio();
  const summary = findByAttr(tree, "data-setup-summary", "true");
  const blob = JSON.stringify(summary);
  expect(blob).toContain("اسم محلي");
  expect(blob).not.toContain("نشاط تجريبي");
});

it("has no visible motion toggle or local-data notice, while media follows automatic preferences", () => {
  const tree = renderStudio();
  expect(collectButtons(tree).some(b => b.text.includes("تفعيل الحركة"))).toBe(false);
  expect(JSON.stringify(tree)).not.toContain("بياناتك محلية حتى تأكيد الدفع");
  expect(findByAttr(tree, "data-setup-noura", "stub")?.props["data-motion"]).toBe("true");
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

function fireChange(el: InspectedElement | null, value: string) {
  (el?.props.onChange as ((e: { target: { value: string } }) => void) | undefined)?.({ target: { value } });
}

function inputById(tree: unknown, idSuffix: string): InspectedElement | null {
  let found: InspectedElement | null = null;
  walk(tree, (el) => {
    if (el.type === "input" && String(el.props.id ?? "").endsWith(idSuffix)) found = el;
  });
  return found;
}

function openStudioBranches(tree: InspectedElement): InspectedElement {
  let button: InspectedElement | null = null;
  walk(tree, el => {
    if (el.type === "button" && String(el.props["aria-controls"] ?? "").endsWith("-branches-panel")) button = el;
  });
  const target = button as InspectedElement | null;
  (target?.props.onClick as (() => void) | undefined)?.();
  return renderStudio();
}

it("first branch follows pristine business name/city including parent clearing", () => {
  let tree = openStudioIdentity(renderStudio());
  fireChange(findByAttr(tree, "data-field", "name"), "Default business");
  fireChange(inputById(tree, "-city"), "Muscat");
  tree = openStudioBranches(renderStudio());
  expect(inputById(tree, "-branch-0-name")?.props.value).toBe("Default business");
  expect(inputById(tree, "-branch-0-city")?.props.value).toBe("Muscat");
  tree = openStudioIdentity(tree);
  fireChange(findByAttr(tree, "data-field", "name"), "Changed business");
  fireChange(inputById(tree, "-city"), "");
  tree = openStudioBranches(renderStudio());
  expect(inputById(tree, "-branch-0-name")?.props.value).toBe("Changed business");
  expect(inputById(tree, "-branch-0-city")?.props.value).toBe("");
});

it("manual first-branch overrides including an intentional clear survive parent changes", () => {
  let tree = openStudioIdentity(renderStudio());
  fireChange(findByAttr(tree, "data-field", "name"), "Default business");
  fireChange(inputById(tree, "-city"), "Muscat");
  tree = openStudioBranches(renderStudio());
  fireChange(inputById(tree, "-branch-0-city"), "Manual city");
  fireChange(inputById(tree, "-branch-0-name"), "");
  tree = openStudioIdentity(renderStudio());
  fireChange(findByAttr(tree, "data-field", "name"), "New business");
  fireChange(inputById(tree, "-city"), "Nizwa");
  tree = openStudioBranches(renderStudio());
  expect(inputById(tree, "-branch-0-name")?.props.value).toBe("");
  expect(inputById(tree, "-branch-0-city")?.props.value).toBe("Manual city");
  expect(state.createCalls).toHaveLength(0);
});

it("a new capture starts fresh default provenance instead of retaining old manual overrides", () => {
  let tree = openStudioIdentity(renderStudio());
  fireChange(findByAttr(tree, "data-field", "name"), "Old business");
  fireChange(inputById(tree, "-city"), "Old city");
  tree = openStudioBranches(renderStudio());
  fireChange(inputById(tree, "-branch-0-name"), "Old manual branch");
  fireChange(inputById(tree, "-branch-0-city"), "Old manual city");
  state.boundary = "boundary-b";
  tree = openStudioIdentity(renderStudio());
  expect(findByAttr(tree, "data-field", "name")?.props.value).toBe("");
  fireChange(findByAttr(tree, "data-field", "name"), "New business");
  fireChange(inputById(tree, "-city"), "New city");
  tree = openStudioBranches(renderStudio());
  expect(inputById(tree, "-branch-0-name")?.props.value).toBe("New business");
  expect(inputById(tree, "-branch-0-city")?.props.value).toBe("New city");
  expect(state.createCalls).toHaveLength(0);
});

it("the automatic primary cannot be removed or transfer its role to an additional branch", () => {
  let tree = openStudioIdentity(renderStudio());
  fireChange(findByAttr(tree, "data-field", "name"), "Default business");
  fireChange(inputById(tree, "-city"), "Muscat");
  tree = renderStudio();
  (findByAttr(tree, "data-setup-add-branch", "true")?.props.onClick as () => void)();
  tree = renderStudio();
  expect(inputById(tree, "-branch-1-name")?.props.value).toBe("");
  expect(inputById(tree, "-branch-1-city")?.props.value).toBe("");
  fireChange(inputById(tree, "-branch-1-name"), "Independent branch");
  fireChange(inputById(tree, "-branch-1-city"), "Sur");
  tree = renderStudio();
  const fieldsets: InspectedElement[] = [];
  walk(tree, el => { if (el.type === "fieldset") fieldsets.push(el); });
  const removePrimary = collectButtons(fieldsets[0]).find(x => x.text.includes("إزالة الفرع"));
  expect(removePrimary?.props.disabled).toBe(true);
  (removePrimary?.props.onClick as () => void)();
  tree = openStudioIdentity(renderStudio());
  fireChange(findByAttr(tree, "data-field", "name"), "Changed parent");
  fireChange(inputById(tree, "-city"), "Sohar");
  tree = openStudioBranches(renderStudio());
  expect(inputById(tree, "-branch-0-name")?.props.value).toBe("Changed parent");
  expect(inputById(tree, "-branch-0-city")?.props.value).toBe("Sohar");
  expect(inputById(tree, "-branch-1-name")?.props.value).toBe("Independent branch");
  expect(inputById(tree, "-branch-1-city")?.props.value).toBe("Sur");
  expect(state.createCalls).toHaveLength(0);
});

it("recovers the screenshot's orphaned blank primary without retyping business identity", () => {
  let tree = openStudioIdentity(renderStudio());
  fireChange(findByAttr(tree, "data-field", "name"), "Current business");
  fireChange(inputById(tree, "-city"), "Muscat");
  const slot = state.slots.find(s => Array.isArray((s.value as { branches?: unknown })?.branches))!;
  const draft = slot.value as { name: string; city: string; branches: Array<{ localId?: string; name: string; city: string }> };
  const originalId = draft.branches[0].localId;
  slot.value = { ...draft, branches: [{ localId: "orphan-blank", name: "", city: "" }] };
  const flags = state.slots.find(s => typeof (s.value as { current?: { attached?: unknown } })?.current?.attached === "boolean")!;
  (flags.value as { current: { attached: boolean } }).current.attached = false;
  tree = renderStudio();
  expect(JSON.stringify(findByAttr(tree, "data-setup-summary", "true"))).toContain("Current business");
  expect(JSON.stringify(findByAttr(tree, "data-branch-preview", "true"))).toContain("Current business");
  expect(JSON.stringify(findByAttr(tree, "data-branch-preview", "true"))).toContain("Muscat");
  tree = openStudioBranches(tree);
  expect(inputById(tree, "-branch-0-name")?.props.value).toBe("Current business");
  expect(inputById(tree, "-branch-0-city")?.props.value).toBe("Muscat");
  expect(findByAttr(tree, "data-branch-local-id", originalId!)).toBeTruthy();
  expect(inputById(tree, "-branch-1-name")).toBeNull();
  tree = openStudioIdentity(tree);
  fireChange(findByAttr(tree, "data-field", "name"), "Retyped business");
  fireChange(inputById(tree, "-city"), "Sur");
  tree = openStudioBranches(renderStudio());
  expect(inputById(tree, "-branch-0-name")?.props.value).toBe("Retyped business");
  expect(inputById(tree, "-branch-0-city")?.props.value).toBe("Sur");
});

it("one/multiple mode switches preserve the primary and independent additional branch draft", () => {
  let tree = openStudioIdentity(renderStudio());
  fireChange(findByAttr(tree, "data-field", "name"), "Primary business");
  fireChange(inputById(tree, "-city"), "Muscat");
  (findByAttr(renderStudio(), "data-setup-add-branch", "true")?.props.onClick as () => void)();
  tree = renderStudio();
  fireChange(inputById(tree, "-branch-1-name"), "Separate branch");
  fireChange(inputById(tree, "-branch-1-city"), "Nizwa");
  (collectButtons(renderStudio()).find(b => b.text.includes("فرع واحد"))?.props.onClick as () => void)();
  tree = renderStudio();
  expect(inputById(tree, "-branch-0-name")?.props.value).toBe("Primary business");
  expect(inputById(tree, "-branch-1-name")).toBeNull();
  (collectButtons(tree).find(b => b.text.includes("عدة فروع"))?.props.onClick as () => void)();
  tree = renderStudio();
  expect(inputById(tree, "-branch-1-name")?.props.value).toBe("Separate branch");
  expect(inputById(tree, "-branch-1-city")?.props.value).toBe("Nizwa");
  expect(state.createCalls).toHaveLength(0);
});

it("recovering a missing primary never renames or discards a meaningful added branch", () => {
  let tree = openStudioIdentity(renderStudio());
  fireChange(findByAttr(tree, "data-field", "name"), "Primary identity");
  fireChange(inputById(tree, "-city"), "Muscat");
  const slot = state.slots.find(s => Array.isArray((s.value as { branches?: unknown })?.branches))!;
  slot.value = { ...(slot.value as object), branches: [{ localId: "retained-added", name: "Independent", city: "Sur", contactPhone: "+96892123456" }] };
  tree = openStudioBranches(renderStudio());
  expect(inputById(tree, "-branch-0-name")?.props.value).toBe("Primary identity");
  (collectButtons(tree).find(b => b.text.includes("عدة فروع"))?.props.onClick as () => void)();
  tree = renderStudio();
  expect(inputById(tree, "-branch-1-name")?.props.value).toBe("Independent");
  expect(inputById(tree, "-branch-1-city")?.props.value).toBe("Sur");
  expect(JSON.stringify(findByAttr(tree, "data-branch-local-id", "retained-added"))).toContain("+96892123456");
  expect(state.createCalls).toHaveLength(0);
});

/** Fill the studio form, re-render so submit closes over the values, then open plans. */
function openStudioPlans(): InspectedElement {
  let tree = openStudioIdentity(renderStudio());
  fireChange(findByAttr(tree, "data-field", "name"), "متجر الندى");
  (collectButtons(tree).find((b) => b.props["data-sector"] === "retail_ecommerce")?.props.onClick as (() => void) | undefined)?.();
  fireChange(findByAttr(tree, "data-field", "country"), "OM");
  fireChange(findByAttr(tree, "data-field", "phone"), "+96892123456");
  fireChange(inputById(tree, "-city"), "مسقط");
  tree = renderStudio();
  const branches = collectButtons(tree).find((b) => b.text.includes("فروعك"));
  (branches?.props.onClick as (() => void) | undefined)?.();
  tree = renderStudio();
  fireChange(inputById(tree, "-branch-0-name"), "الرئيسي");
  fireChange(inputById(tree, "-branch-0-city"), "صور");
  tree = renderStudio();
  (findByAttr(tree, "data-setup-review-action", "true")?.props.onClick as (() => void) | undefined)?.();
  tree = renderStudio();
  (findByAttr(tree, "data-channel", "instagram")?.props.onClick as (() => void) | undefined)?.();
  tree = renderStudio();
  (findByAttr(tree, "data-setup-destination", "goals")?.props.onClick as (() => void) | undefined)?.();
  tree = renderStudio();
  (findByAttr(tree, "data-goal", "support")?.props.onClick as (() => void) | undefined)?.();
  tree = renderStudio();
  (findByAttr(tree, "data-team-range", "1-3")?.props.onClick as (() => void) | undefined)?.();
  tree = renderStudio();
  (findByAttr(tree, "data-setup-destination", "plans")?.props.onClick as (() => void) | undefined)?.();
  return renderStudio();
}

it("studio submit opens local plans for the entered branch and does not create an order", () => {
  // A branch identity may contain the old price digits without displaying that price.
  const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue("555fcd77-1101-4930-adf1-5e4b8b1cace5");
  const tree = openStudioPlans();
  uuid.mockRestore();
  const plans = findByAttr(tree, "data-setup-team-plans", "true");
  expect(plans).toBeTruthy();
  expect(plans?.props["data-confirm-wired"]).toBe("false");
  const blob = JSON.stringify(plans);
  expect(blob).toContain("الرئيسي");
  expect(blob).toContain("صور");
  expect(blob).toContain("لم يُختر بعد");
  expect(blob).not.toContain("confirmReview");
  const visibleText = (node: unknown): string => {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(visibleText).join("");
    if (node && typeof node === "object" && "props" in node) {
      return visibleText((node as InspectedElement).props.children);
    }
    return "";
  };
  expect(visibleText(plans)).not.toContain("110");
  expect(findByAttr(tree, "data-setup-review", "true")).toBeNull();
  expect(findByAttr(tree, "data-setup-noura", "stub")).toBeNull();
  expect(findByAttr(tree, "data-setup-summary", "true")).toBeNull();
  const step = collectButtons(tree);
  expect(step).toBeTruthy();
  const orderStep = JSON.stringify(tree);
  expect(orderStep).toContain("مراجعة الطلب");
  expect(findByAttr(tree, "data-active-step", "2")).toBeTruthy();
});

it("studio back from plans keeps the same draft and branch without a second count entry", () => {
  let tree = openStudioPlans();
  const back = findByAttr(tree, "data-plans-back", "true");
  (back?.props.onClick as (() => void) | undefined)?.();
  tree = renderStudio();
  expect(findByAttr(tree, "data-setup-step", "goals")).toBeTruthy();
  tree = openStudioIdentity(tree);
  expect(findByAttr(tree, "data-setup-team-plans", "true")).toBeNull();
  expect(findByAttr(tree, "data-field", "name")?.props.value).toBe("متجر الندى");
  expect(findByAttr(tree, "data-setup-summary", "true")).toBeTruthy();
  (findByAttr(tree, "data-setup-review-action", "true")?.props.onClick as (() => void) | undefined)?.();
  tree = renderStudio();
  (findByAttr(tree, "data-setup-destination", "goals")?.props.onClick as (() => void) | undefined)?.();
  tree = renderStudio();
  (findByAttr(tree, "data-setup-destination", "plans")?.props.onClick as (() => void) | undefined)?.();
  tree = renderStudio();
  const again = JSON.stringify(findByAttr(tree, "data-setup-team-plans", "true"));
  expect(again).toContain("الرئيسي");
  expect(again).toContain("صور");
});

it("studio capture change leaves plans and clears the in-memory draft", () => {
  openStudioPlans();
  state.boundary = "boundary-b";
  renderStudio();
  const tree = openStudioIdentity(renderStudio());
  expect(findByAttr(tree, "data-setup-team-plans", "true")).toBeNull();
  expect(findByAttr(tree, "data-field", "name")?.props.value).toBe("");
  expect(findByAttr(tree, "data-setup-summary", "true")).toBeTruthy();
});

it("studio remount after release does not reuse the released journey", () => {
  let tree = openStudioPlans();
  expect(findByAttr(tree, "data-setup-team-plans", "true")).toBeTruthy();
  const staleChoice = tierButton(tree, "premium")?.props.onClick as (() => void) | undefined;
  for (const slot of state.slots) {
    slot.cleanup?.();
  }
  // A genuine unmount also discards hooks. Cleanup followed by retained slots
  // models an effect reconnect, not the remount named by this regression.
  state.slots = [];
  state.effects = [];
  state.componentKey = null;
  tree = openStudioIdentity(renderStudio());
  expect(findByAttr(tree, "data-setup-team-plans", "true")).toBeNull();
  expect(findByAttr(tree, "data-field", "name")?.props.value).toBe("");
  tree = openStudioPlans();
  staleChoice?.();
  tree = renderStudio();
  expect(findByAttr(tree, "data-setup-team-plans", "true")).toBeTruthy();
  expect(JSON.stringify(findByAttr(tree, "data-setup-team-plans", "true"))).toContain("لم يُختر بعد");
});

it("a plans callback from capture A does not mutate capture B", () => {
  const first = openStudioPlans();
  const stale = tierButton(first, "premium")?.props.onClick as (() => void) | undefined;
  expect(typeof stale).toBe("function");
  state.boundary = "boundary-b";
  renderStudio();
  const second = openStudioPlans();
  expect(JSON.stringify(second)).toContain("لم يُختر بعد");
  stale?.();
  const after = renderStudio();
  const plans = JSON.stringify(findByAttr(after, "data-setup-team-plans", "true"));
  expect(plans).toContain("لم يُختر بعد");
  expect(plans).not.toContain("نورا · المميزة");
  (tierButton(after, "basic")?.props.onClick as (() => void) | undefined)?.();
  const chosen = renderStudio();
  expect(JSON.stringify(chosen)).toContain("نورا · القياسية");
});

function openBoundReview() {
  let tree = openStudioPlans();
  (tierButton(tree, "basic")?.props.onClick as () => void)();
  tree = renderStudio();
  (findByAttr(tree, "data-term", "monthly")?.props.onClick as () => void)();
  tree = renderStudio();
  (findByAttr(tree, "data-plans-continue", "true")?.props.onClick as () => void)();
  tree = renderStudio();
  expect(findByAttr(tree, "data-review-binding", "true")).toBeTruthy();
  if (!state.review) throw new Error("Review not bound");
  return state.review;
}

it("binds consent and UNKNOWN retry to the same operation without sending business facts", async () => {
  let props = openBoundReview();
  expect(props.consentAccepted).toBe(false);
  expect(state.createCalls).toHaveLength(0);
  expect(await props.confirmReview(false)).toMatchObject({ ok: false, code: "CONSENT_REQUIRED" });
  props.onConsentChange?.(true);
  renderStudio();
  props = state.review!;
  expect(await props.confirmReview(true)).toMatchObject({ ok: false, code: "UNKNOWN" });
  renderStudio();
  props = state.review!;
  expect(props.write.kind).toBe("unknown");
  expect(props.editingLocked).toBe(true);
  await props.retrySameOperation?.();
  expect(state.createCalls).toHaveLength(2);
  expect(state.createCalls[1]).toEqual(state.createCalls[0]);
  expect(Object.keys(state.createCalls[0] as object).sort()).toEqual(["clientOpId", "consentAccepted", "expectedAccountId", "selection"]);
  const staleConfirm = props.confirmReview;
  state.boundary = "boundary-b";
  renderStudio();
  expect(await staleConfirm(true)).toMatchObject({ ok: false, code: "ACTOR_NOT_CURRENT" });
  expect(state.createCalls).toHaveLength(2);
});

it("drops a pending review completion when the capture changes", async () => {
  let resolve!: (result: unknown) => void;
  state.createReply = new Promise((done) => { resolve = done; });
  const props = openBoundReview();
  props.onConsentChange?.(true);
  renderStudio();
  const pending = state.review!.confirmReview(true);
  renderStudio();
  expect(state.review!.write.kind).toBe("inflight");
  state.boundary = "boundary-b";
  renderStudio();
  resolve({ ok: false, code: "UNKNOWN" });
  expect(await pending).toMatchObject({ ok: false, code: "STALE_CAPTURE" });
  const tree = openStudioIdentity(renderStudio());
  expect(findByAttr(tree, "data-review-binding", "true")).toBeNull();
  expect(findByAttr(tree, "data-field", "name")?.props.value).toBe("");
  expect(state.createCalls).toHaveLength(1);
});

it("studio plans stay closed without a ready nonempty boundary", () => {
  state.boundary = "";
  const missing = openStudioIdentity(openStudioPlans());
  expect(findByAttr(missing, "data-setup-team-plans", "true")).toBeNull();
  expect(findByAttr(missing, "data-field", "name")?.props.value).toBe("متجر الندى");

  state.slots = [];
  state.effects = [];
  state.boundary = "boundary-a";
  state.ready = false;
  const unready = openStudioIdentity(openStudioPlans());
  expect(findByAttr(unready, "data-setup-team-plans", "true")).toBeNull();
  expect(findByAttr(unready, "data-field", "name")?.props.value).toBe("متجر الندى");
});

it("studio sector chips store a broad category and leave a legacy detailed type untouched until chosen", () => {
  let tree = openStudioIdentity(renderStudio());
  expect(collectButtons(tree).filter((b) => b.props.role === "radio")).toHaveLength(13);
  expect(collectButtons(tree).some((b) => b.props["data-sector"] === "travel" && String(b.props.children).includes("السفر والسياحة"))).toBe(true);
  expect(collectButtons(tree).some((b) => b.props["aria-checked"] === true)).toBe(false);
  expect(JSON.stringify(tree)).not.toContain("data-field\":\"type\"");
  (collectButtons(tree).find((b) => b.props["data-sector"] === "food")?.props.onClick as () => void)();
  tree = renderStudio();
  const slot = state.slots.find((s) => Array.isArray((s.value as { branches?: unknown })?.branches))!;
  expect((slot.value as { type: string }).type).toBe("broad:food");
  expect((slot.value as { type: string }).type).not.toBe("restaurant");
  slot.value = { ...(slot.value as object), type: "restaurant" };
  tree = renderStudio();
  expect(collectButtons(tree).some((b) => b.props["aria-checked"] === true)).toBe(false);
  expect(findByAttr(tree, "data-preserved-type", "restaurant")).toBeTruthy();
  expect(JSON.stringify(findByAttr(tree, "data-preserved-type", "restaurant"))).toContain("مطعم");
  (collectButtons(tree).find((b) => b.props["data-sector"] === "food")?.props.onClick as () => void)();
  tree = renderStudio();
  expect((slot.value as { type: string }).type).toBe("broad:food");
});

it("optional website and no-site stay compatible with other answers and block a contradictory continue", () => {
  let tree = openStudioIdentity(renderStudio());
  const slot = state.slots.find((s) => Array.isArray((s.value as { branches?: unknown })?.branches))!;
  slot.value = {
    ...(slot.value as object),
    answers: {
      version: 1,
      allocation: "unallocated",
      goals: ["support"],
      website: null,
      crm: null,
      ai: null,
      channels: { whatsapp: false, instagram: false },
      whatsapp: null,
      team: null,
    },
  };
  fireChange(inputById(renderStudio(), "-website"), "https://example.com?ref=1");
  tree = renderStudio();
  expect((slot.value as { answers: { website: { value: string }; goals: string[] } }).answers.website.value).toBe("https://example.com/?ref=1");
  expect((slot.value as { answers: { goals: string[] } }).answers.goals).toEqual(["support"]);
  (collectButtons(tree).find((b) => b.props["data-setup-no-site"] === "true")?.props.onClick as () => void)();
  tree = renderStudio();
  expect(findByAttr(tree, "data-setup-website-error", "CONTRADICTION")).toBeTruthy();
  expect((slot.value as { answers: { website: { kind: string } } }).answers.website).toEqual({ kind: "url", value: "https://example.com/?ref=1" });
  fireChange(findByAttr(tree, "data-field", "name"), "متجر الندى");
  fireChange(findByAttr(tree, "data-field", "country"), "OM");
  fireChange(findByAttr(tree, "data-field", "phone"), "+96892123456");
  fireChange(inputById(tree, "-city"), "مسقط");
  (collectButtons(renderStudio()).find((b) => b.props["data-sector"] === "food")?.props.onClick as () => void)();
  tree = renderStudio();
  (findByAttr(tree, "data-setup-review-action", "true")?.props.onClick as () => void)();
  tree = renderStudio();
  expect(findByAttr(tree, "data-setup-team-plans", "true")).toBeNull();
  expect(findByAttr(tree, "data-setup-step", "channels")).toBeNull();
  const label = JSON.stringify(findByAttr(tree, "data-setup-review-action", "true")?.props.children);
  expect(label).toContain("قنواتك");
  expect(findByAttr(tree, "data-setup-destination", "channels")).toBeTruthy();
  expect(findByAttr(tree, "data-setup-substep-button", "channels")).toBeNull();
  expect(findByAttr(tree, "data-setup-substep-button", "goals")).toBeNull();
});

it("a cleared no-site choice keeps the plans destination and the rest of the visit", () => {
  let tree = openStudioPlans();
  const back = findByAttr(tree, "data-plans-back", "true");
  (back?.props.onClick as () => void)();
  tree = openStudioIdentity(renderStudio());
  (collectButtons(tree).find((b) => b.props["data-setup-no-site"] === "true")?.props.onClick as () => void)();
  tree = renderStudio();
  const slot = state.slots.find((s) => Array.isArray((s.value as { branches?: unknown })?.branches))!;
  expect((slot.value as { answers: { website: { kind: string } } | null }).answers?.website).toEqual({ kind: "none" });
  expect((slot.value as { type: string }).type).toBe("broad:retail_ecommerce");
  (findByAttr(tree, "data-setup-review-action", "true")?.props.onClick as () => void)();
  tree = renderStudio();
  (findByAttr(tree, "data-setup-destination", "goals")?.props.onClick as () => void)();
  tree = renderStudio();
  (findByAttr(tree, "data-setup-destination", "plans")?.props.onClick as () => void)();
  tree = renderStudio();
  expect(findByAttr(tree, "data-setup-team-plans", "true")).toBeTruthy();
  expect(findByAttr(tree, "data-setup-destination", "plans")).toBeNull();
  expect(findByAttr(tree, "data-active-step", "2")).toBeTruthy();
  expect(JSON.stringify(findByAttr(tree, "data-setup-team-plans", "true"))).toContain("لم يُختر بعد");
});

it("applies the website result that was computed before the preparation update", () => {
  const tree = openStudioIdentity(renderStudio());
  const change = inputById(tree, "-website")?.props.onChange as ((event: { target: { value: string } }) => void) | undefined;
  change?.({ target: { value: "notaurl" } });
  change?.({ target: { value: "https://example.com/a" } });
  const shown = renderStudio();
  expect(findByAttr(shown, "data-setup-website-error", "INVALID_URL")).toBeNull();
  const slot = state.slots.find((s) => Array.isArray((s.value as { branches?: unknown })?.branches))!;
  expect((slot.value as { answers: { website: { value: string } } }).answers.website.value).toBe("https://example.com/a");
  (collectButtons(shown).find((b) => b.props["data-setup-no-site"] === "true")?.props.onClick as () => void)();
  const after = renderStudio();
  expect(findByAttr(after, "data-setup-website-error", "CONTRADICTION")).toBeTruthy();
  expect((slot.value as { answers: { website: { value: string } } }).answers.website.value).toBe("https://example.com/a");
});

it("clears hidden whatsapp answers, keeps instagram, and leaves the plan unselected for a dana badge", () => {
  let tree = openStudioIdentity(renderStudio());
  fireChange(findByAttr(tree, "data-field", "name"), "متجر الندى");
  (collectButtons(tree).find((b) => b.props["data-sector"] === "travel")?.props.onClick as () => void)();
  fireChange(findByAttr(tree, "data-field", "country"), "OM");
  fireChange(findByAttr(tree, "data-field", "phone"), "+96892123456");
  fireChange(inputById(tree, "-city"), "مسقط");
  tree = renderStudio();
  (findByAttr(tree, "data-setup-review-action", "true")?.props.onClick as () => void)();
  tree = renderStudio();
  (findByAttr(tree, "data-channel", "instagram")?.props.onClick as () => void)();
  (findByAttr(renderStudio(), "data-channel", "whatsapp")?.props.onClick as () => void)();
  tree = renderStudio();
  (findByAttr(tree, "data-whatsapp-existing", "yes")?.props.onClick as () => void)();
  tree = renderStudio();
  let platform: InspectedElement | null = null;
  walk(tree, (el) => { if (el.type === "select") platform = el; });
  fireChange(platform, "Twilio");
  tree = renderStudio();
  (findByAttr(tree, "data-whatsapp-existing", "no")?.props.onClick as () => void)();
  tree = renderStudio();
  const slot = state.slots.find((s) => Array.isArray((s.value as { branches?: unknown })?.branches))!;
  const answers = (slot.value as { answers: { channels: { instagram: boolean }; whatsapp: { platform: string | null; existingUse: string } } }).answers;
  expect(answers.channels.instagram).toBe(true);
  expect(answers.whatsapp).toEqual({ existingUse: "no", platform: null, platformOther: null, verification: null, facebookBusinessAccount: null });
  const stale = findByAttr(tree, "data-channel", "whatsapp")?.props.onClick as () => void;
  state.isCurrent = false;
  stale();
  expect((slot.value as { answers: { channels: { whatsapp: boolean } } }).answers.channels.whatsapp).toBe(true);
  state.isCurrent = true;
  (findByAttr(renderStudio(), "data-setup-destination", "goals")?.props.onClick as () => void)();
  tree = renderStudio();
  (findByAttr(tree, "data-goal", "sales")?.props.onClick as () => void)();
  tree = renderStudio();
  (findByAttr(tree, "data-team-range", "11-25")?.props.onClick as () => void)();
  tree = renderStudio();
  expect(findByAttr(tree, "data-workforce-badge", "level_3")).toBeTruthy();
  expect(JSON.stringify(findByAttr(tree, "data-workforce-badge", "level_3"))).toContain("دانا");
  expect(JSON.stringify(tree)).not.toContain("نورة");
  (findByAttr(tree, "data-setup-destination", "plans")?.props.onClick as () => void)();
  tree = renderStudio();
  expect(JSON.stringify(findByAttr(tree, "data-setup-team-plans", "true"))).toContain("لم يُختر بعد");
  expect(state.createCalls).toHaveLength(0);
});
