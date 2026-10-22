"use server";

import { requirePlatformOwner } from "@/lib/tenancy/access";
import { requirePlatformRole } from "@/lib/tenancy/access-guards";
import type {
  AutomationJobStatus,
  PlatformConfigPolicies,
  PlatformSettingsOverviewData,
  UpdatePlatformPoliciesInput,
} from "./settings-types";

export type SettingsResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: "UNAUTHENTICATED" | "FORBIDDEN" | "UNAVAILABLE" | "INVALID_INPUT"; message?: string };

const KNOWN_AUTOMATIONS: AutomationJobStatus[] = [
  {
    id: "billing_renewal_sweep",
    nameAr: "معالج تجديد الاشتراكات الدورية",
    nameEn: "Billing Subscription Renewal Worker",
    cronSchedule: "UNVERIFIED",
    lastExecutionAt: null,
    status: "unconfigured",
    descriptionAr: "فحص الفواتير المستحقة، تطبيق فترة السماح (3 أيام)، وتأكيد تجديد أو تعليق التراخيص.",
    descriptionEn: "Evaluates subscription cycles, enforces strict 3-day grace period, and settles renewals.",
  },
  {
    id: "session_sweep_worker",
    nameAr: "معالج تنظيف الجلسات المنتهية",
    nameEn: "Session Guard & Expiration Sweeper",
    cronSchedule: "UNVERIFIED",
    lastExecutionAt: null,
    status: "unconfigured",
    descriptionAr: "إبطال جلسات المستخدمين المنتهية أو المعلقة وتنظيف جداول activity_session.",
    descriptionEn: "Invalidates expired GoTrue sessions and prunes idle broker state.",
  },
  {
    id: "storage_cleanup_job",
    nameAr: "معالج تنظيف ملفات الـ Setup المؤقتة",
    nameEn: "Storage Intent & Quarantine Cleanup",
    cronSchedule: "UNVERIFIED",
    lastExecutionAt: null,
    status: "unconfigured",
    descriptionAr: "تنظيف نوايا الرفع غير المكتملة وحذف الملفات المعلقة بعد انتهاء مدة الاستبقاء.",
    descriptionEn: "Sweeps stale draft upload intents and permanently removes unconfirmed storage objects.",
  },
  {
    id: "ai_ledger_reconciliation",
    nameAr: "معالج تسوية استهلاك نماذج الذكاء",
    nameEn: "AI Router Token Reconciliation Worker",
    cronSchedule: "UNVERIFIED",
    lastExecutionAt: null,
    status: "unconfigured",
    descriptionAr: "مطابقة التوكنات المسجلة مع ميزانية المنصة المعتمدة لمنع تجاوز الحدود المالية.",
    descriptionEn: "Audits consumed Gemini and GPT tokens against allocated enterprise platform budget.",
  },
];

export async function adminGetPlatformSettingsOverview(): Promise<
  SettingsResult<PlatformSettingsOverviewData>
> {
  const roleCheck = await requirePlatformRole(["owner", "operations"]);
  if (!roleCheck.ok) {
    if (roleCheck.code === "UNVERIFIED" || roleCheck.code === "UNAUTHENTICATED") {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    if (roleCheck.code === "UNAVAILABLE") return { ok: false, code: "UNAVAILABLE" };
    return { ok: false, code: "FORBIDDEN", message: roleCheck.message };
  }

  try {
    const policies: PlatformConfigPolicies = {
      officialContactEmail: "velorahelperai@gmail.com",
      renewalGraceDays: 3, // strictly 3 days as instructed
      aiBudgetAlertThresholdPercent: 80,
      onboardingReviewReminderHours: 48,
      livePaymentGuarded: true,
      webhookRateLimitPerSec: 100,
      auditRetentionPolicy: "UNCONFIGURED",
    };

    const activeCount = KNOWN_AUTOMATIONS.filter((a) => a.status === "active").length;

    const data: PlatformSettingsOverviewData = {
      kpis: {
        totalAutomationsCount: KNOWN_AUTOMATIONS.length,
        activeAutomationsCount: activeCount,
        livePaymentsStatus: "GUARDED_DISABLED",
        systemIntegrity: "ENFORCED",
      },
      policies,
      automations: KNOWN_AUTOMATIONS,
    };

    return { ok: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load platform settings";
    return { ok: false, code: "UNAVAILABLE", message };
  }
}

export async function adminUpdatePlatformPolicies(
  input: UpdatePlatformPoliciesInput
): Promise<SettingsResult<{ updated: boolean }>> {
  const admin = await requirePlatformOwner();
  if (!admin.ok) {
    return { ok: false, code: admin.code === "UNAVAILABLE" ? "UNAVAILABLE" : "FORBIDDEN" };
  }

  if (
    input.aiBudgetAlertThresholdPercent !== undefined &&
    (input.aiBudgetAlertThresholdPercent < 50 || input.aiBudgetAlertThresholdPercent > 95)
  ) {
    return { ok: false, code: "INVALID_INPUT", message: "AI budget threshold must be between 50% and 95%" };
  }

  // No approved persistent settings contract exists. An audit event is not a save.
  return { ok: false, code: "UNAVAILABLE", message: "PLATFORM_POLICY_STORAGE_UNCONFIGURED" };
}
