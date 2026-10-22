import { describe, expect, it, vi } from "vitest";
import type { AdminAuditOverviewData } from "@/lib/tenancy/audit-types";
import { AdminAuditCompliance } from "./admin-audit-compliance";

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

function renderAuditCompliance(props: Parameters<typeof AdminAuditCompliance>[0]) {
  const driver: Driver = { slots: [], cursor: 0, effects: [], mounted: true };
  mocked.driver = driver;
  const tree = AdminAuditCompliance(props);
  mocked.driver = null;
  driver.effects.splice(0).forEach((fn) => fn());
  return tree;
}

describe("Stage E — Module 11: AdminAuditCompliance Component", () => {
  const sampleData: AdminAuditOverviewData = {
    kpis: {
      totalLogsCount: 42,
      recent24hCount: 7,
      immutabilityGate: "APPEND_ONLY",
      retentionPolicy: "UNCONFIGURED",
    },
    logs: [
      {
        id: "log-sec-1",
        actorUserId: "usr-platform-owner",
        actorEmail: "velorahelperai@gmail.com",
        companyId: "cmp-001",
        companyName: "Salalah Frankincense",
        action: "security.role_grant",
        category: "security",
        beforeData: { role: "member" },
        afterData: { role: "admin" },
        createdAt: "2026-10-22T08:00:00Z",
      },
      {
        id: "log-sup-2",
        actorUserId: "usr-platform-owner",
        actorEmail: "velorahelperai@gmail.com",
        companyId: "cmp-002",
        companyName: "Muscat Tech Hub",
        action: "support_ticket.status_change",
        category: "support",
        beforeData: { status: "open" },
        afterData: { status: "resolved" },
        createdAt: "2026-10-22T08:30:00Z",
      },
    ],
    availableActions: ["security.role_grant", "support_ticket.status_change"],
    pagination: {
      totalCount: 42,
      limit: 50,
      offset: 0,
      hasMore: false,
    },
  };

  it("renders header, owner badge, and 4 KPI cards correctly", () => {
    const tree = renderAuditCompliance({ data: sampleData });
    const content = text(tree);

    // Module info & Owner badge
    expect(content).toContain("Module 11 · Governance & Immutable Audit Logs");
    expect(content).toContain("velorahelperai@gmail.com");

    // KPIs
    expect(content).toContain("42");
    expect(content).toContain("7");
    expect(content).toContain("APPEND-ONLY LOCKED");
    expect(content).toContain("UNCONFIGURED");
  });

  it("renders audit trail rows with actions, categories, companies, and inspect buttons", () => {
    const tree = renderAuditCompliance({ data: sampleData });
    const content = text(tree);

    expect(content).toContain("security.role_grant");
    expect(content).toContain("Salalah Frankincense");
    expect(content).toContain("support_ticket.status_change");
    expect(content).toContain("Muscat Tech Hub");
    expect(content).toContain("فحص التغييرات");
  });

  it("displays empty state when logs list is empty", () => {
    const emptyData: AdminAuditOverviewData = {
      ...sampleData,
      logs: [],
    };
    const tree = renderAuditCompliance({ data: emptyData });
    const content = text(tree);

    expect(content).toContain("لا توجد سجلات تدقيق مسجلة");
  });
});
