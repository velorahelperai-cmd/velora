import { describe, expect, it, vi } from "vitest";
import type { PlatformAccessOverviewData } from "@/lib/tenancy/access-types";
import { AdminPlatformAccess } from "./admin-platform-access";

type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
type Driver = { slots: Slot[]; cursor: number; effects: Array<() => void>; mounted: boolean };
const mocked = vi.hoisted(() => ({
  driver: null as Driver | null,
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
    useTransition() {
      return [false, (fn: () => void) => fn()];
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/demo-state", () => ({
  useDemo: () => ({ locale: mocked.currentLocale }),
}));

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (value && typeof value === "object" && "props" in value) {
    const node = value as { props: Record<string, unknown> };
    return text(node.props.children);
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function renderPlatformAccess(props: Parameters<typeof AdminPlatformAccess>[0]) {
  const driver: Driver = { slots: [], cursor: 0, effects: [], mounted: true };
  mocked.driver = driver;
  const tree = AdminPlatformAccess(props);
  mocked.driver = null;
  driver.effects.splice(0).forEach((fn) => fn());
  return tree;
}

describe("Stage E — Module 10: AdminPlatformAccess Component", () => {
  const sampleData: PlatformAccessOverviewData = {
    kpis: {
      totalAdminsCount: 3,
      activeAdminsCount: 3,
      escalationProtection: "LOCKED",
      sessionRevocationPolicy: "IMMEDIATE",
    },
    owner: {
      userId: "owner-123",
      email: "velorahelperai@gmail.com",
      fullName: "Platform Owner",
      verified: true,
    },
    delegatedAdmins: [
      {
        userId: "usr-supp-01",
        email: "salim.support@velora.internal",
        fullName: "Salim Al Mandhari",
        supportCode: "VEL-SUPP-001",
        role: "support",
        status: "active",
        grantedAt: "2026-10-15T08:00:00Z",
        grantedBy: "owner-123",
        note: "Customer support supervisor",
        allowedCapabilities: ["platform.search_accounts", "support.tickets.manage"],
      },
      {
        userId: "usr-fin-02",
        email: "fatima.finance@velora.internal",
        fullName: "Fatima Al Habsi",
        supportCode: "VEL-FIN-002",
        role: "finance",
        status: "disabled",
        grantedAt: "2026-10-16T09:00:00Z",
        grantedBy: "owner-123",
        note: "Financial reconciliations",
        allowedCapabilities: ["billing.ledger.read"],
      },
    ],
    roleCatalog: [
      {
        role: "owner",
        nameAr: "مالك المنصة (Super Admin)",
        nameEn: "Platform Owner",
        descriptionAr: "صلاحيات سيادية كاملة لإدارة المنصة.",
        descriptionEn: "Complete sovereign authority.",
        badgeStyle: "bg-purple-100 text-purple-800 border-purple-200",
        capabilities: ["platform.manage_admins"],
      },
      {
        role: "support",
        nameAr: "مشرف دعم ومراجعات",
        nameEn: "Support Admin",
        descriptionAr: "إدارة تذاكر الدعم والبحث.",
        descriptionEn: "Support ticket management.",
        badgeStyle: "bg-blue-100 text-blue-800 border-blue-200",
        capabilities: ["support.tickets.manage"],
      },
    ],
  };

  it("renders header, owner badge, and 4 KPI cards correctly", () => {
    const tree = renderPlatformAccess({ data: sampleData });
    const content = text(tree);

    // Module info & Owner badge
    expect(content).toContain("Module 10 · Access Control & Platform Teams");
    expect(content).toContain("velorahelperai@gmail.com");

    // KPIs
    expect(content).toContain("3");
    expect(content).toContain("مقفل برمجياً (LOCKED)");
    expect(content).toContain("فوري (IMMEDIATE AT DB)");
  });

  it("renders delegated admins directory with roles, statuses, and action buttons", () => {
    const tree = renderPlatformAccess({ data: sampleData });
    const content = text(tree);

    expect(content).toContain("Salim Al Mandhari");
    expect(content).toContain("salim.support@velora.internal");
    expect(content).toContain("مشرف دعم ومراجعات");
    expect(content).toContain("Fatima Al Habsi");
    expect(content).toContain("fatima.finance@velora.internal");
    expect(content).toContain("معلق (Suspended)");
    expect(content).toContain("تعديل");
    expect(content).toContain("إلغاء التفويض");
  });

  it("displays empty state when no delegated staff is configured", () => {
    const emptyData: PlatformAccessOverviewData = {
      ...sampleData,
      delegatedAdmins: [],
    };
    const tree = renderPlatformAccess({ data: emptyData });
    const content = text(tree);

    expect(content).toContain("لا يوجد مشرفون مفوضون حالياً");
  });
});
