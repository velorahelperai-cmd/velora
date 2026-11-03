"use client";

import { useDemo } from "@/lib/demo-state";
import type { PlatformSettingsOverviewData } from "@/lib/tenancy/settings-types";
import styles from "./admin-platform-settings.module.css";
import { IconFileText, IconListChecks, IconSettings } from "./admin-icons";

export interface AdminPlatformSettingsProps {
  data: PlatformSettingsOverviewData;
}

export function AdminPlatformSettings({ data }: AdminPlatformSettingsProps) {
  const { locale } = useDemo();
  const ar = locale === "ar";
  const { policies, automations } = data;
  const t = (arabic: string, english: string) => ar ? arabic : english;
  const referencePolicies = [
    [t("بريد التواصل المرجعي", "Reference contact email"), policies.officialContactEmail],
    [t("فترة السماح المرجعية", "Reference grace period"), `${policies.renewalGraceDays} ${t("أيام", "days")}`],
    [t("عتبة تنبيه الميزانية المرجعية", "Reference budget alert threshold"), `${policies.aiBudgetAlertThresholdPercent}%`],
    [t("نافذة التذكير المرجعية", "Reference reminder window"), `${policies.onboardingReviewReminderHours} ${t("ساعة", "hours")}`],
    [t("سقف تدفق Webhooks المرجعي", "Reference webhook rate"), `${policies.webhookRateLimitPerSec} ${t("طلب / ثانية", "requests / second")}`],
    [t("الاحتفاظ بسجل التدقيق", "Audit retention"), t("غير مهيأ", "Unconfigured")],
  ];
  const statusLabel = (status: string) => {
    switch (status) {
      case "active": return t("نشط وفق البيانات المعروضة", "Active in displayed data");
      case "idle": return t("خامل", "Idle");
      case "error": return t("خطأ", "Error");
      default: return t("غير متحقق", "Unverified");
    }
  };

  return (
    <div className={styles.page} dir={ar ? "rtl" : "ltr"}>
      <header className={styles.heading}>
        <div>
          <h1>{t("أتمتة وإعدادات النظام", "System settings and automations")}</h1>
          <p>{t("راجع القيم المرجعية وقائمة المهام المتاحة للمراجعة.", "Review reference values and the listed background jobs.")}</p>
        </div>
      </header>

      <div data-notice="warn" role="status">
        <strong>{t("الإعدادات غير مهيأة", "Settings are unconfigured")}</strong>
        <p>{t("القيم أدناه مرجعية وليست إعدادات محفوظة. لم يتأكد تشغيل المهام أو حالة الدفع والحماية من هذه الصفحة.", "The values below are reference defaults, not saved settings. This page does not verify worker execution, payment status, or system protection.")}</p>
      </div>

      <div className={styles.columns}>
        <section className={styles.panel} aria-labelledby="platform-policies-title">
          <div className={styles.panelHeading}>
            <div>
              <div className={styles.titleRow}><span className={styles.panelIcon}><IconFileText aria-hidden="true" /></span><h2 id="platform-policies-title">{t("القيم المرجعية", "Reference values")}</h2></div>
              <p>{t("للعرض فقط؛ لا تمثل سياسات محفوظة.", "Read only; these are not persisted policies.")}</p>
            </div>
          </div>
          <dl className={styles.policyList}>
            {referencePolicies.map(([label, value]) => <div key={label}><dt>{label}</dt><dd><bdi>{value}</bdi></dd></div>)}
          </dl>
        </section>

        <section className={styles.panel} aria-labelledby="platform-status-title">
          <div className={styles.panelHeading}>
            <div>
              <div className={styles.titleRow}><span className={styles.panelIcon}><IconSettings aria-hidden="true" /></span><h2 id="platform-status-title">{t("حالة التشغيل", "Operational status")}</h2></div>
              <p>{t("تحتاج هذه الحالات إلى مصدر تحقق مستقل.", "These states need an independent source of verification.")}</p>
            </div>
          </div>
          <dl className={styles.policyList}>
            <div><dt>{t("تشغيل المهام", "Worker execution")}</dt><dd>{t("غير متحقق", "Unverified")}</dd></div>
            <div><dt>{t("الدفع المباشر", "Live payments")}</dt><dd>{t("غير متحقق", "Unverified")}</dd></div>
            <div><dt>{t("حماية النظام", "System protection")}</dt><dd>{t("غير متحقق", "Unverified")}</dd></div>
          </dl>
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="platform-workers-title">
        <div className={styles.panelHeading}>
          <div>
            <div className={styles.titleRow}><span className={styles.panelIcon}><IconListChecks aria-hidden="true" /></span><h2 id="platform-workers-title">{t("قائمة المهام المرجعية", "Reference job list")}</h2></div>
            <p>{t("القائمة وصفية؛ الجدول وآخر تنفيذ وحالة التشغيل تحتاج إلى تحقق.", "This inventory is descriptive; schedules, last execution and runtime status require verification.")}</p>
          </div>
          <span className={styles.count}>{automations.length} {t("مهام في القائمة", "listed jobs")}</span>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr>
              <th scope="col">{t("المهمة", "Job")}</th>
              <th scope="col">{t("الجدول", "Schedule")}</th>
              <th scope="col">{t("الحالة", "Status")}</th>
              <th scope="col">{t("آخر تنفيذ", "Last execution")}</th>
              <th scope="col">{t("الوصف", "Description")}</th>
            </tr></thead>
            <tbody>{automations.map((item) => <tr key={item.id}>
              <td><strong>{ar ? item.nameAr : item.nameEn}</strong><small dir="ltr">{item.id}</small></td>
              <td><bdi>{item.cronSchedule === "UNVERIFIED" ? t("غير متحقق", "Unverified") : item.cronSchedule}</bdi></td>
              <td><span className={styles.status}>{statusLabel(item.status)}</span></td>
              <td>{item.lastExecutionAt ? <time dateTime={item.lastExecutionAt}>{new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Muscat" }).format(new Date(item.lastExecutionAt))}</time> : "—"}</td>
              <td>{ar ? item.descriptionAr : item.descriptionEn}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
