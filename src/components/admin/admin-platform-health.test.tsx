import { describe, expect, it, vi } from "vitest";
import type { PlatformHealthOverviewData } from "@/lib/tenancy/health-types";
import { AdminPlatformHealth } from "./admin-platform-health";

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
  return {
    ...actual,
    useRef: (initial: unknown) => ({ current: initial }),
    useTransition: () => [false, (action: () => void) => action()],
    useState(initial: unknown) {
      if (!mocked.driver) {
        return [initial, () => {}];
      }
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
  };
});

vi.mock("@/lib/tenancy/health-actions", () => ({adminGetPlatformHealthOverview: vi.fn()}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
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

function renderPlatformHealth(props: Parameters<typeof AdminPlatformHealth>[0]) {
  const driver: Driver = { slots: [], cursor: 0, effects: [], mounted: true };
  mocked.driver = driver;
  const tree = AdminPlatformHealth(props);
  mocked.driver = null;
  return tree;
}

describe("Stage F — Module 14: AdminPlatformHealth Component", () => {
  const sampleData: PlatformHealthOverviewData = {
    kpis: {
      overallStatus: "HEALTHY",
      dbLatencyMs: 24,
      authStatus: "HEALTHY",
      paymentGatewayMode: "TEST_MODE_GUARDED",
      aiRouterStatus: "READY_GUARDED",
    },
    probes: [
      {
        id: "postgres_db",
        nameAr: "قاعدة بيانات Supabase (PostgreSQL)",
        nameEn: "Supabase PostgreSQL Database",
        category: "database",
        status: "HEALTHY",
        latencyMs: 24,
        detailsAr: "متصلة وجاهزة · زمن الاستجابة: 24ms",
        detailsEn: "Online and healthy · Latency: 24ms",
        lastCheckedAt: "2026-10-22T08:00:00.000Z",
      },
      {
        id: "paymob_gateway",
        nameAr: "بوابة الدفع (Paymob Sandbox)",
        nameEn: "Paymob Payment Gateway",
        category: "integrations",
        status: "GUARDED",
        latencyMs: null,
        detailsAr: "وضع الاختبار محمى ومفعل (Test Mode)",
        detailsEn: "Guarded Test Mode active",
        lastCheckedAt: "2026-10-22T08:00:00.000Z",
      },
    ],
    invariants: [
      {
        id: "inv_append_only_audit",
        labelAr: "سجل تدقيق غير قابل للتعديل (Append-Only Audit)",
        labelEn: "Immutable Append-Only Audit Logging",
        status: "PASS",
        evidence: "Database triggers reject UPDATE, DELETE, and TRUNCATE",
      },
      {
        id: "inv_payment_sandbox",
        labelAr: "حماية بوابة الدفع ومنع الخصم الفعلي (Payment Guard)",
        labelEn: "Live Payment Zero-Execution Guard",
        status: "PASS",
        evidence: "Paymob LIVE mode disabled; strictly locked to guarded sandbox tokens",
      },
    ],
    evaluatedAt: "2026-10-22T08:00:00.000Z",
  };

  it("renders Arabic labels, 4 KPIs, and official owner badge correctly", () => {
    mocked.currentLocale = "ar";
    const rendered = renderPlatformHealth({ data: sampleData });
    const output = text(rendered);

    expect(output).toContain("جاهزية وصحة المنصة");
    expect(output).toContain("velorahelperai@gmail.com");
    expect(output).toContain("جاهز ومستقر");
    expect(output).toContain("24");
    expect(output).toContain("بيئة فحص معزولة");
    expect(output).toContain("قاعدة بيانات Supabase (PostgreSQL)");
    expect(output).toContain("سجل تدقيق غير قابل للتعديل");
    expect(output).toContain("PASS");
  });

  it("renders English localization correctly with subsystem probes", () => {
    mocked.currentLocale = "en";
    const rendered = renderPlatformHealth({ data: sampleData });
    const output = text(rendered);

    expect(output).toContain("Platform Health & Readiness");
    expect(output).toContain("velorahelperai@gmail.com");
    expect(output).toContain("HEALTHY");
    expect(output).toContain("TEST_MODE_GUARDED");
    expect(output).toContain("Supabase PostgreSQL Database");
    expect(output).toContain("Immutable Append-Only Audit Logging");
  });

  it("displays guarded sandbox status for payments and never live mode", () => {
    mocked.currentLocale = "ar";
    const rendered = renderPlatformHealth({ data: sampleData });
    const output = text(rendered);

    expect(output).toContain("بيئة فحص معزولة");
    expect(output).toContain("منع الخصومات الحقيقية مفعل بشكل قاطع");
  });
});
