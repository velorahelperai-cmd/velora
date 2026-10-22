export interface AutomationJobStatus {
  id: string;
  nameAr: string;
  nameEn: string;
  cronSchedule: string;
  lastExecutionAt: string | null;
  status: "active" | "idle" | "error" | "unconfigured";
  descriptionAr: string;
  descriptionEn: string;
}

export interface PlatformConfigPolicies {
  officialContactEmail: string;
  renewalGraceDays: number;
  aiBudgetAlertThresholdPercent: number;
  onboardingReviewReminderHours: number;
  livePaymentGuarded: boolean;
  webhookRateLimitPerSec: number;
  auditRetentionPolicy: "UNCONFIGURED";
}

export interface PlatformSettingsOverviewData {
  kpis: {
    totalAutomationsCount: number;
    activeAutomationsCount: number;
    livePaymentsStatus: "GUARDED_DISABLED";
    systemIntegrity: "ENFORCED";
  };
  policies: PlatformConfigPolicies;
  automations: AutomationJobStatus[];
}

export interface UpdatePlatformPoliciesInput {
  aiBudgetAlertThresholdPercent?: number;
  onboardingReviewReminderHours?: number;
  webhookRateLimitPerSec?: number;
}
