import { describe, expect, it, vi } from "vitest";
import type { PlatformSettingsOverviewData } from "@/lib/tenancy/settings-types";
import { AdminPlatformSettings } from "./admin-platform-settings";

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

describe("Stage F — Module 13: AdminPlatformSettings Component", () => {
  const sampleData: PlatformSettingsOverviewData = {
    kpis: {
      totalAutomationsCount: 4,
      activeAutomationsCount: 4,
      livePaymentsStatus: "GUARDED_DISABLED",
      systemIntegrity: "ENFORCED",
    },
    policies: {
      officialContactEmail: "velorahelperai@gmail.com",
      renewalGraceDays: 3,
      aiBudgetAlertThresholdPercent: 80,
      onboardingReviewReminderHours: 48,
      livePaymentGuarded: true,
      webhookRateLimitPerSec: 100,
      auditRetentionPolicy: "UNCONFIGURED",
    },
    automations: [
      {
        id: "billing_renewal_sweep",
        nameAr: "معالج تجديد الاشتراكات الدورية",
        nameEn: "Billing Subscription Renewal Worker",
        cronSchedule: "0 0 * * * (Daily 00:00 UTC)",
        lastExecutionAt: "2026-10-22T06:00:00.000Z",
        status: "active",
        descriptionAr: "فحص الفواتير المستحقة وتطبيق فترة السماح 3 أيام",
        descriptionEn: "Evaluates subscription cycles and enforces 3-day grace",
      },
      {
        id: "session_sweep_worker",
        nameAr: "معالج تنظيف الجلسات المنتهية",
        nameEn: "Session Guard Worker",
        cronSchedule: "0 * * * *",
        lastExecutionAt: "2026-10-22T09:30:00.000Z",
        status: "active",
        descriptionAr: "تنظيف الجلسات المنتهية",
        descriptionEn: "Cleans expired sessions",
      },
    ],
  };

  it("renders Arabic labels, 4 KPIs, and official owner badge correctly", () => {
    mocked.currentLocale = "ar";
    const rendered = AdminPlatformSettings({ data: sampleData });
    const output = text(rendered);

    expect(output).toContain("أتمتة وإعدادات النظام");
    expect(output).toContain("velorahelperai@gmail.com");
    expect(output).toContain("3   أيام فقط");
    expect(output).toContain("UNCONFIGURED");
    expect(output).toContain("معالج تجديد الاشتراكات الدورية");
    expect(output).toContain("محمية ومعطلة (GUARDED)");
  });

  it("renders English localization correctly with authoritative policies", () => {
    mocked.currentLocale = "en";
    const rendered = AdminPlatformSettings({ data: sampleData });
    const output = text(rendered);

    expect(output).toContain("System Settings & Automations");
    expect(output).toContain("velorahelperai@gmail.com");
    expect(output).toContain("3   Days Strict");
    expect(output).toContain("UNCONFIGURED");
    expect(output).toContain("Billing Subscription Renewal Worker");
    expect(output).toContain("GUARDED (DISABLED)");
  });

  it("strictly reflects the 3-day grace period and never suggests 30 days", () => {
    mocked.currentLocale = "ar";
    const rendered = AdminPlatformSettings({ data: sampleData });
    const output = text(rendered);

    expect(output).toContain("3 أيام");
    expect(output).not.toContain("30 يوماً");
    expect(output).not.toContain("30 يوم");
  });
});
