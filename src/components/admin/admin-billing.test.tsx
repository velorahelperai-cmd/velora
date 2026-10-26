import { describe, expect, it, vi } from "vitest";
import type { AdminBillingPage } from "@/lib/billing/admin/model";
import { AdminBillingLedger } from "./billing-ledger";

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

function renderBillingLedger(props: Parameters<typeof AdminBillingLedger>[0]) {
  const driver: Driver = { slots: [], cursor: 0, effects: [], mounted: true };
  mocked.driver = driver;
  const tree = AdminBillingLedger(props);
  mocked.driver = null;
  driver.effects.splice(0).forEach((fn) => fn());
  return tree;
}

describe("Stage D — Module 06: AdminBillingLedger", () => {
  const samplePage: AdminBillingPage = {
    status: "ready",
    total: 3,
    hasMore: true,
    nextCursor: "cursor_abc123",
    snapshot: "2026-10-22T08:00:00Z",
    rows: [
      {
        id: "ord-001",
        companyId: "cmp-001",
        companyName: "مطعم المذاق العماني",
        createdAt: "2026-10-22T07:00:00Z",
        amountBaisa: 45000, // 45.000 OMR
        currency: "OMR",
        environment: "test",
        checkoutDeadline: null,
        checkoutExpired: false,
        financial: {
          companyId: "cmp-001",
          orderId: "ord-001",
          state: "proven",
          collectionProven: true,
          environment: "test",
          collectedAt: "2026-10-22T07:05:00Z",
          paidThrough: "2026-11-22T07:05:00Z",
        },
      },
      {
        id: "ord-002",
        companyId: "cmp-002",
        companyName: "مقهى السحاب",
        createdAt: "2026-10-22T06:30:00Z",
        amountBaisa: 65000, // 65.000 OMR
        currency: "OMR",
        environment: "test",
        checkoutDeadline: null,
        checkoutExpired: false,
        financial: {
          companyId: "cmp-002",
          orderId: "ord-002",
          state: "pending",
          collectionProven: false,
          environment: "test",
          collectedAt: null,
          paidThrough: null,
        },
      },
      {
        id: "ord-003",
        companyId: "cmp-003",
        companyName: "صالون الأناقة",
        createdAt: "2026-10-22T05:00:00Z",
        amountBaisa: 90000, // 90.000 OMR
        currency: "OMR",
        environment: "live",
        checkoutDeadline: null,
        checkoutExpired: false,
        financial: {
          companyId: "cmp-003",
          orderId: "ord-003",
          state: "failed",
          collectionProven: false,
          environment: "live",
          collectedAt: null,
          paidThrough: null,
        },
      },
    ],
  };

  it("renders 4 KPI summary cards with total orders, revenue, and restricted Test gateway", () => {
    const tree = renderBillingLedger({ result: samplePage, query: {} });
    const renderedText = text(tree);

    // Total orders
    expect(renderedText).toContain("3");
    // Confirmed revenue = 45.000 OMR (only proven order ord-001)
    expect(renderedText).toContain("45.000");
    // Paymob test status
    expect(renderedText).toContain("Thawani UAT");
    expect(renderedText).not.toContain("Paymob");
  });

  it("renders transactions ledger table with company links and formatted amounts", () => {
    const tree = renderBillingLedger({ result: samplePage, query: {} });
    const renderedText = text(tree);

    expect(renderedText).toContain("مطعم المذاق العماني");
    expect(renderedText).toContain("مقهى السحاب");
    expect(renderedText).toContain("صالون الأناقة");
    expect(renderedText).toContain("ord-001");
    expect(renderedText).toContain("ord-002");
    expect(renderedText).toContain("ord-003");
  });

  it("renders pagination next page link when hasMore is true", () => {
    const tree = renderBillingLedger({ result: samplePage, query: {} });
    const renderedText = text(tree);

    expect(renderedText).toContain("الصفحة التالية");
  });

  it("renders empty state notice when result status is empty", () => {
    const tree = renderBillingLedger({
      result: { status: "empty", total: 0, hasMore: false, nextCursor: null, snapshot: "2026-10-22T08:00:00Z", rows: [] },
      query: {},
    });
    const renderedText = text(tree);

    expect(renderedText).toContain("لا توجد طلبات");
  });

  it("renders access denied alert when result status is forbidden", () => {
    const tree = renderBillingLedger({
      result: { status: "forbidden", total: null, hasMore: null, nextCursor: null, rows: null },
      query: {},
    });
    const renderedText = text(tree);

    expect(renderedText).toContain("مالك المنصة");
  });
});
