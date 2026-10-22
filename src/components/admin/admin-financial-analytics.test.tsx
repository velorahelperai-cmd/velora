import { describe, expect, it, vi } from "vitest";
import type { FinancialAnalyticsData } from "@/lib/tenancy/analytics-types";
import { AdminFinancialAnalytics } from "./admin-financial-analytics";

const mocked = vi.hoisted(() => ({
  currentLocale: "ar",
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

describe("Stage G — Module 12: AdminFinancialAnalytics Component", () => {
  const sampleData: FinancialAnalyticsData = {
    kpis: {
      grossRealizedBaisa: 135000,
      grossRealizedOmr: "135.000 OMR",
      activeSubscribedTenants: 2,
      arpuOmr: "67.500 OMR",
      paymentSuccessRatePercent: 100,
      gatewayMode: "TEST_MODE_GUARDED",
    },
    planDistribution: [
      {
        planId: "level_1_basic",
        planNameAr: "نورا - الدعم الأساسي (Support Basic)",
        planNameEn: "Noura - Support Basic",
        activeTenantsCount: 1,
        monthlyPriceBaisa: 45000,
        monthlyRevenueBaisa: 45000,
        sharePercent: 50,
      },
      {
        planId: "level_1_premium",
        planNameAr: "نورا - الدعم المتقدم (Support Premium)",
        planNameEn: "Noura - Support Premium",
        activeTenantsCount: 1,
        monthlyPriceBaisa: 90000,
        monthlyRevenueBaisa: 90000,
        sharePercent: 50,
      },
    ],
    monthlyHistory: [
      {
        monthKey: "2026-10",
        monthLabelAr: "أكتوبر 2026",
        monthLabelEn: "Oct 2026",
        confirmedGrossBaisa: 135000,
        ordersCount: 2,
      },
    ],
    aiMarginAnalysis: {
      realizedSubscriptionOmr: "135.000 OMR",
      realizedAiConsumptionOmr: "14.250 OMR",
      marginRatioPercent: 89,
      status: "HEALTHY",
    },
  };

  it("renders header and 4 KPI summary cards accurately", () => {
    const tree = AdminFinancialAnalytics({ data: sampleData });
    const content = text(tree);

    expect(content).toContain("Module 12 · Advanced Analytics & Reporting");
    expect(content).toContain("Finance & Owner Only");
    expect(content).toContain("135.000 OMR");
    expect(content).toContain("2");
    expect(content).toContain("67.500 OMR");
    expect(content).toContain("100%");
  });

  it("renders Direct AI Token Cost Coverage section and Authoritative Plan Distribution", () => {
    const tree = AdminFinancialAnalytics({ data: sampleData });
    const content = text(tree);

    expect(content).toContain("مؤشر تغطية تكلفة الذكاء الاصطناعي المباشرة");
    expect(content).toContain("89%");
    expect(content).toContain("14.250 OMR");
    expect(content).toContain("نورا - الدعم الأساسي (Support Basic)");
    expect(content).toContain("نورا - الدعم المتقدم (Support Premium)");
    expect(content).toContain("أكتوبر 2026");
  });

  it("renders empty state when monthly history is empty", () => {
    const emptyData: FinancialAnalyticsData = {
      ...sampleData,
      monthlyHistory: [],
    };
    const tree = AdminFinancialAnalytics({ data: emptyData });
    const content = text(tree);

    expect(content).toContain("لا توجد حركات تحصيل شهرية مسجلة بعد");
  });
});
