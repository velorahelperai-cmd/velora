import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
type Driver = { slots: Slot[]; cursor: number; effects: Array<() => void>; mounted: boolean };
const mocked = vi.hoisted(() => ({
  driver: null as Driver | null,
  currentPathname: "/admin",
  currentLocale: "ar",
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const slot = () => {
    const d = mocked.driver!;
    return { d, s: d.slots[d.cursor++] ?? (d.slots[d.cursor - 1] = {}) };
  };
  const changed = (a: unknown[] | undefined, b: unknown[]) =>
    !a || a.length !== b.length || b.some((v, i) => !Object.is(a[i], v));
  return {
    ...actual,
    useState(initial: unknown) {
      const { d, s } = slot();
      if (!("value" in s))
        s.value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [
        s.value,
        (value: unknown) => {
          if (!d.mounted) return;
          s.value = typeof value === "function" ? (value as (v: unknown) => unknown)(s.value) : value;
        },
      ];
    },
    useRef(value: unknown) {
      const { s } = slot();
      if (!s.value) s.value = { current: value };
      return s.value;
    },
    useMemo(fn: () => unknown, deps: unknown[]) {
      const { s } = slot();
      if (changed(s.deps, deps)) {
        s.value = fn();
        s.deps = deps;
      }
      return s.value;
    },
    useEffect(fn: () => void | (() => void), deps: unknown[]) {
      const { d, s } = slot();
      if (changed(s.deps, deps)) {
        d.effects.push(() => {
          s.cleanup?.();
          s.cleanup = fn() || undefined;
        });
        s.deps = deps;
      }
    },
  };
});

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: () => mocked.currentPathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// Mock demo-state for Arabic locale
vi.mock("@/lib/demo-state", () => ({
  useDemo: () => ({ locale: mocked.currentLocale }),
}));

// Mock account-chrome session
vi.mock("@/components/app/account-chrome", () => ({
  useOptionalAccountSession: () => ({
    status: "ready",
    identity: {
      platformIdentity: { role: "owner", status: "active", unavailable: false },
    },
  }),
  AccountMenu: () => <div data-testid="account-menu">AccountMenu</div>,
}));

vi.stubGlobal("requestAnimationFrame", (fn: () => void) => {
  fn();
  return 1;
});
vi.stubGlobal("cancelAnimationFrame", vi.fn());

import { AdminShell } from "./admin-shell";

type Node = { props: Record<string, unknown> };
function nodes(v: unknown): Node[] {
  if (Array.isArray(v)) return v.flatMap(nodes);
  if (!v || typeof v !== "object" || !("props" in v)) return [];
  const n = v as Node;
  return [n, ...nodes(n.props.children)];
}

function links(tree: ReactNode): { href: string; text: string }[] {
  return nodes(tree)
    .filter((n) => typeof n.props.href === "string")
    .map((n) => ({
      href: String(n.props.href),
      text: String(n.props.children ?? ""),
    }));
}

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (value && typeof value === "object" && "props" in value) {
    const node = value as { props: Record<string, unknown> };
    return text(node.props.children);
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function renderShell(pathname = "/admin", locale = "ar") {
  mocked.currentPathname = pathname;
  mocked.currentLocale = locale;
  const driver: Driver = { slots: [], cursor: 0, effects: [], mounted: true };
  mocked.driver = driver;
  const tree = AdminShell({ children: <div>Page Body</div> });
  mocked.driver = null;
  driver.effects.splice(0).forEach((fn) => fn());
  return tree;
}

describe("Admin — Navigation & Shell Structure", () => {
  it("renders all 5 primary navigation groups in the sidebar", () => {
    const tree = renderShell("/admin", "ar");
    const fullText = text(tree);

    // Must show all 5 groups in Arabic
    expect(fullText).toContain("الرئيسية والتشغيل");
    expect(fullText).toContain("العملاء والخدمات");
    expect(fullText).toContain("الاشتراكات والمالية");
    expect(fullText).toContain("الدعم والحوكمة");
    expect(fullText).toContain("إعدادات المنصة");
  });

  it("contains direct routes for all 14 V2 functional modules", () => {
    const tree = renderShell("/admin", "ar");
    const allLinks = links(tree).map((l) => l.href);

    // Group A: Main & Operations
    expect(allLinks).toContain("/admin");
    expect(allLinks).toContain("/admin/operations");
    expect(allLinks).toContain("/admin/health");

    // Group B: Customers & Services
    expect(allLinks).toContain("/admin/companies");
    expect(allLinks).toContain("/admin/accounts");
    expect(allLinks).toContain("/admin/channels");
    expect(allLinks).toContain("/admin/ai");

    // Group C: Billing & Finance
    expect(allLinks).toContain("/admin/billing");
    expect(allLinks).toContain("/admin/catalog");
    expect(allLinks).toContain("/admin/analytics");

    // Group D: Support & Governance
    expect(allLinks).toContain("/admin/support");
    expect(allLinks).toContain("/admin/access");
    expect(allLinks).toContain("/admin/audit");

    // Group E: Platform Settings
    expect(allLinks).toContain("/admin/settings");
    expect(allLinks).toContain("/admin/identity-recovery");
  });

  it("calculates breadcrumbs correctly across newly introduced V2 routes", () => {
    const testCases: [string, string][] = [
      ["/admin/operations", "مركز العمليات والأعطال"],
      ["/admin/health", "جاهزية وصحة المنصة"],
      ["/admin/channels", "مركز القنوات والربط"],
      ["/admin/accounts", "الحسابات والمستخدمين"],
      ["/admin/support", "تذاكر الدعم والمراجعات"],
      ["/admin/audit", "سجل التدقيق والامتثال"],
      ["/admin/analytics", "التحليلات والتقارير"],
      ["/admin/settings", "إعدادات المنصة والأتمتة"],
    ];

    for (const [route, expectedLabel] of testCases) {
      const tree = renderShell(route, "ar");
      const fullText = text(tree);
      expect(fullText).toContain(expectedLabel);
    }
  });
});
