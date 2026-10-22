import { describe, expect, it, vi } from "vitest";
import type { AdminOperationsData } from "@/lib/tenancy/operations-types";
import { AdminOperationsCenter } from "./admin-operations-center";

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

function renderOperationsCenter(props: Parameters<typeof AdminOperationsCenter>[0]) {
  const driver: Driver = { slots: [], cursor: 0, effects: [], mounted: true };
  mocked.driver = driver;
  const tree = AdminOperationsCenter(props);
  mocked.driver = null;
  driver.effects.splice(0).forEach((fn) => fn());
  return tree;
}

describe("Stage E — Module 08: AdminOperationsCenter", () => {
  const sampleData: AdminOperationsData = {
    kpis: {
      totalEvents: 1420,
      activeIncidents: 1,
      webhookSuccessRate: "99.8%",
      avgServerLatency: "38ms",
      servicesHealth: "healthy",
    },
    services: [
      {
        id: "postgres",
        name: "Supabase PostgreSQL Database",
        status: "OPERATIONAL",
        latencyMs: 14,
        details: "Connection pool active, read-write healthy",
      },
      {
        id: "gotrue",
        name: "GoTrue Auth & Platform Sessions",
        status: "OPERATIONAL",
        latencyMs: 22,
        details: "Session token verification healthy",
      },
      {
        id: "meta-webhook",
        name: "Meta Cloud & Graph API Webhooks",
        status: "OPERATIONAL",
        latencyMs: 45,
        details: "WhatsApp & Instagram signature verification verified",
      },
      {
        id: "paymob-pipe",
        name: "Paymob Payment Notifications",
        status: "OPERATIONAL",
        latencyMs: 31,
        details: "Test webhook listener bound with HMAC verification",
      },
      {
        id: "ai-router",
        name: "Multi-Model AI Engine",
        status: "OPERATIONAL",
        latencyMs: 420,
        details: "Gemini 3.8 Flash, GPT-6 Luna, GPT-6.1 Sol active",
      },
    ],
    webhookPipes: [
      {
        channel: "WhatsApp Cloud API",
        status: "active",
        eventsCount: 890,
        successRate: "99.9%",
        lastActiveAt: "2026-10-22T08:15:00Z",
      },
      {
        channel: "Instagram Graph API",
        status: "active",
        eventsCount: 320,
        successRate: "99.7%",
        lastActiveAt: "2026-10-22T08:10:00Z",
      },
      {
        channel: "Paymob Webhook",
        status: "active",
        eventsCount: 210,
        successRate: "100%",
        lastActiveAt: "2026-10-22T07:45:00Z",
      },
    ],
    recentEvents: [
      {
        id: "evt-001",
        traceId: "trc-abc12345",
        requestId: "req-987654",
        companyId: "cmp-001",
        service: "webhook_meta",
        severity: "warning",
        errorCode: "WEBHOOK_RATE_LIMIT_WARNING",
        message: "Meta incoming message batch approaching concurrency soft limit",
        createdAt: "2026-10-22T08:20:00Z",
      },
      {
        id: "evt-002",
        traceId: "trc-def67890",
        requestId: "req-543210",
        companyId: "cmp-002",
        service: "ai_engine",
        severity: "error",
        errorCode: "PROVIDER_HTTP_429",
        message: "Provider quota exceeded, falling back to secondary model",
        createdAt: "2026-10-22T08:05:00Z",
      },
    ],
  };

  it("renders Module 08 header with platform owner badge", () => {
    const tree = renderOperationsCenter({ data: sampleData });
    const renderedText = text(tree);

    expect(renderedText).toContain("Module 08");
    expect(renderedText).toContain("velorahelperai@gmail.com");
  });

  it("renders 4 KPI summary cards with active incidents, webhook rate, and server latency", () => {
    const tree = renderOperationsCenter({ data: sampleData });
    const renderedText = text(tree);

    // Active incidents
    expect(renderedText).toContain("1");
    // Webhook success rate
    expect(renderedText).toContain("99.8%");
    // Avg server latency
    expect(renderedText).toContain("38ms");
  });

  it("renders all core platform services with OPERATIONAL badges", () => {
    const tree = renderOperationsCenter({ data: sampleData });
    const renderedText = text(tree);

    expect(renderedText).toContain("Supabase PostgreSQL Database");
    expect(renderedText).toContain("GoTrue Auth & Platform Sessions");
    expect(renderedText).toContain("Meta Cloud & Graph API Webhooks");
    expect(renderedText).toContain("Paymob Payment Notifications");
    expect(renderedText).toContain("Multi-Model AI Engine");
  });

  it("renders correlation logs table with trace_id, request_id, and stable error codes", () => {
    const tree = renderOperationsCenter({ data: sampleData });
    const renderedText = text(tree);

    expect(renderedText).toContain("trc-abc12345");
    expect(renderedText).toContain("req-987654");
    expect(renderedText).toContain("WEBHOOK_RATE_LIMIT_WARNING");
    expect(renderedText).toContain("trc-def67890");
    expect(renderedText).toContain("PROVIDER_HTTP_429");
  });

  it("renders UNKNOWN badge when real webhook data is not available", () => {
    const unknownData: AdminOperationsData = {
      ...sampleData,
      kpis: {
        ...sampleData.kpis,
        totalEvents: "UNKNOWN",
        webhookSuccessRate: "UNKNOWN",
      },
      webhookPipes: sampleData.webhookPipes.map((p) => ({
        ...p,
        eventsCount: 0,
        successRate: "UNKNOWN",
        status: "unknown",
      })),
      recentEvents: [],
    };

    const tree = renderOperationsCenter({ data: unknownData });
    const renderedText = text(tree);

    expect(renderedText).toContain("غير متوفر");
    expect(renderedText).toContain("لا توجد أحداث تشغيلية مسجلة حاليًا");
  });
});
