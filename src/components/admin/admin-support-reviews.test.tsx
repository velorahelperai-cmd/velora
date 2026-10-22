import { describe, expect, it, vi } from "vitest";
import type { AdminSupportOverviewData } from "@/lib/tenancy/support-types";
import { AdminSupportReviews } from "./admin-support-reviews";

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (value && typeof value === "object" && "props" in value) {
    const node = value as { props: Record<string, unknown> };
    return text(node.props.children);
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function renderSupportReviews(props: Parameters<typeof AdminSupportReviews>[0]) {
  const driver: Driver = { slots: [], cursor: 0, effects: [], mounted: true };
  mocked.driver = driver;
  const tree = AdminSupportReviews(props);
  mocked.driver = null;
  driver.effects.splice(0).forEach((fn) => fn());
  return tree;
}

describe("Stage E — Module 09: AdminSupportReviews", () => {
  const sampleData: AdminSupportOverviewData = {
    kpis: {
      pendingReviewsCount: 2,
      supportSlaHours: 4,
      reviewGateStatus: "ACTIVE",
      officialSupportChannel: "WhatsApp & Email",
    },
    pendingReviews: [
      {
        id: "cmp-001",
        display_name: "Nizwa Roastery",
        business_type: "Coffee & Food",
        status: "setup",
        country: "OM",
        city: "Nizwa",
        contact_phone: "+96898765432",
        contact_email: "roaster@example.com",
        created_by: "usr-001",
        owner_email: "roaster@example.com",
        owner_name: "Ahmed Al Kindi",
        member_count: 3,
        created_at: "2026-10-22T07:00:00Z",
        updated_at: "2026-10-22T07:30:00Z",
        review_requested_at: "2026-10-22T07:30:00Z",
      },
    ],
    supportChannels: [
      {
        id: "wa-support",
        channel: "WhatsApp Official Support",
        target: "+968 (Official WhatsApp Ingress)",
        status: "OPERATIONAL",
        description: "Direct customer escalations & support code lookups",
      },
      {
        id: "email-support",
        channel: "Support Desk Email",
        target: "support@velora.ai",
        status: "OPERATIONAL",
        description: "Tier-2 business onboarding inquiries and review responses",
      },
    ],
  };

  it("renders Module 09 header and platform owner badge", () => {
    const tree = renderSupportReviews({ data: sampleData });
    const renderedText = text(tree);

    expect(renderedText).toContain("Module 09");
    expect(renderedText).toContain("velorahelperai@gmail.com");
  });

  it("renders 4 KPI summary cards with pending count and SLA", () => {
    const tree = renderSupportReviews({ data: sampleData });
    const renderedText = text(tree);

    expect(renderedText).toContain("2");
    expect(renderedText).toContain("< 4h");
    expect(renderedText).toContain("WhatsApp & Email");
  });

  it("renders pending reviews queue with company name, owner email, and contact phone", () => {
    const tree = renderSupportReviews({ data: sampleData });
    const renderedText = text(tree);

    expect(renderedText).toContain("Nizwa Roastery");
    expect(renderedText).toContain("roaster@example.com");
    expect(renderedText).toContain("+96898765432");
  });

  it("renders customer support code lookup search input", () => {
    const tree = renderSupportReviews({ data: sampleData });
    const renderedText = text(tree);

    expect(renderedText).toContain("Support Code Lookup");
  });

  it("renders empty state when pending reviews count is 0", () => {
    const emptyData: AdminSupportOverviewData = {
      ...sampleData,
      kpis: { ...sampleData.kpis, pendingReviewsCount: 0 },
      pendingReviews: [],
    };
    const tree = renderSupportReviews({ data: emptyData });
    const renderedText = text(tree);

    expect(renderedText).toContain("لا توجد طلبات مراجعة معلقة حاليًا");
  });
});
