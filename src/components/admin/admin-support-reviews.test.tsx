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
      openTicketsCount: 1,
      inProgressTicketsCount: 0,
      resolvedTicketsCount: 0,
      supportSlaHours: "UNCONFIGURED",
      reviewGateStatus: "ACTIVE",
      officialSupportChannel: "WhatsApp & Email",
      officialSupportEmail: "velorahelperai@gmail.com",
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
    tickets: [
      {
        id: "tck-001",
        ticketNumber: "TICK-908123",
        companyId: "cmp-001",
        companyName: "Nizwa Roastery",
        branchId: "main",
        creatorUserId: "usr-001",
        assignedToUserId: null,
        title: "Connection timeout on WhatsApp webhook",
        description: "Customer reports missing automated greetings",
        status: "open",
        priority: "urgent",
        category: "channel",
        createdAt: "2026-10-22T08:00:00Z",
        updatedAt: "2026-10-22T08:00:00Z",
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
        id: "platform-owner",
        channel: "Platform Escalation Email",
        target: "velorahelperai@gmail.com",
        status: "OPERATIONAL",
        description: "Platform owner verified escalation and dispute resolution",
      },
      {
        id: "email-desk",
        channel: "Dedicated Support Desk",
        target: "UNCONFIGURED",
        status: "UNCONFIGURED",
        description: "Custom external ticketing desk unconfigured in platform settings",
      },
    ],
  };

  it("shows unavailable tickets honestly without losing onboarding review data", () => {
    const data: AdminSupportOverviewData = { ...sampleData, tickets: [], ticketsAvailability: "unavailable", ticketsError: "SUPPORT_READ_UNAVAILABLE", pagination: undefined,
      kpis: { ...sampleData.kpis, openTicketsCount: "UNKNOWN", inProgressTicketsCount: "UNKNOWN", resolvedTicketsCount: "UNKNOWN" } };
    const rendered = text(renderSupportReviews({ data }));
    expect(rendered).toContain("SUPPORT_READ_UNAVAILABLE");
    expect(rendered).toContain("UNKNOWN");
    expect(rendered).not.toContain("No support tickets match");
    expect(data.pendingReviews).toEqual(sampleData.pendingReviews);
  });

  it("renders Module 09 header and verified platform owner email", () => {
    const tree = renderSupportReviews({ data: sampleData });
    const renderedText = text(tree);

    expect(renderedText).toContain("Module 09");
    expect(renderedText).toContain("velorahelperai@gmail.com");
    // Ensure support@velora.ai is NOT present
    expect(renderedText).not.toContain("support@velora.ai");
  });

  it("renders 4 KPI summary cards with open tickets and UNCONFIGURED SLA", () => {
    const tree = renderSupportReviews({ data: sampleData });
    const renderedText = text(tree);

    expect(renderedText).toContain("1");
    // SLA must be UNCONFIGURED
    expect(renderedText).toContain("UNCONFIGURED");
    expect(renderedText).not.toContain("< 4h");
  });

  it("renders support tickets table with ticket number, priority, and company name", () => {
    const tree = renderSupportReviews({ data: sampleData });
    const renderedText = text(tree);

    expect(renderedText).toContain("TICK-908123");
    expect(renderedText).toContain("Connection timeout on WhatsApp webhook");
    expect(renderedText).toContain("Nizwa Roastery");
    expect(renderedText).toContain("channel");
  });

  it("renders customer support code lookup search input", () => {
    const tree = renderSupportReviews({ data: sampleData });
    const renderedText = text(tree);

    expect(renderedText).toContain("Support Code Lookup");
  });

  it("renders official support channels with dedicated desk marked UNCONFIGURED", () => {
    const tree = renderSupportReviews({ data: sampleData });
    const renderedText = text(tree);

    expect(renderedText).toContain("WhatsApp Official Support");
    expect(renderedText).toContain("Dedicated Support Desk");
    expect(renderedText).toContain("UNCONFIGURED");
  });
});
