"use client";

import { useDemo } from "@/lib/demo-state";
import type { PlatformSettingsOverviewData } from "@/lib/tenancy/settings-types";
import {
  IconCheckCircle,
  IconCreditCard,
  IconPulse,
  IconSettings,
  IconShield,
} from "./admin-icons";

export interface AdminPlatformSettingsProps {
  data: PlatformSettingsOverviewData;
}

export function AdminPlatformSettings({ data }: AdminPlatformSettingsProps) {
  const { locale } = useDemo();
  const ar = locale === "ar";

  const { kpis, policies, automations } = data;

  return (
    <div className="space-y-6" dir={ar ? "rtl" : "ltr"}>
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--service-line)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-[var(--service-accent)]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--service-accent)]">
              Module 13 · System Automations & Configuration
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-black text-[var(--service-ink)] tracking-tight">
            {ar ? "أتمتة وإعدادات النظام (Platform Settings & Automations)" : "System Settings & Automations"}
          </h1>
          <p className="mt-1 text-sm text-[var(--service-muted)]">
            {ar
              ? "تخزين السياسات غير مهيأ؛ القيم المعروضة مرجعية وليست إعدادات محفوظة. تشغيل المهام غير متحقق."
              : "Policy storage is unconfigured; displayed values are reference defaults, not persisted settings. Worker execution is unverified."}
          </p>
        </div>

        {/* Owner & Operations Badge */}
        <div className="flex items-center gap-2 rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] px-3 py-1.5 shadow-sm">
          <IconShield className="h-4 w-4 text-[var(--service-success)]" />
          <span className="text-xs font-bold text-[var(--service-ink)]">{policies.officialContactEmail}</span>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
            {ar ? "مالك المنصة" : "Platform Owner"}
          </span>
        </div>
      </div>

      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* KPI 1: Total Automations */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "المهام المجدولة (Workers)" : "Background Automations"}
            </span>
            <IconSettings className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--service-ink)]">
              {kpis.totalAutomationsCount}
            </span>
            <span className="text-xs font-bold text-[var(--service-muted)]">
              {ar ? "مهام دورية" : "workers"}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "معالجة خلفية غير متزامنة" : "Asynchronous queue processing"}
          </div>
        </div>

        {/* KPI 2: Active Workers */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "المعالجات النشطة" : "Active Workers"}
            </span>
            <IconPulse className="h-4 w-4 text-[var(--service-success)]" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--service-ink)]">
              {kpis.activeAutomationsCount}
            </span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
              {ar ? "قيد التشغيل" : "Operational"}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "تعمل وفق جداول Cron المحددة" : "Healthy scheduled cadence"}
          </div>
        </div>

        {/* KPI 3: Live Payments Guard */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "بوابة الدفع المباشر" : "Live Payment Gateway"}
            </span>
            <IconCreditCard className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-3">
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-800">
              {ar ? "محمية ومعطلة (GUARDED)" : "GUARDED (DISABLED)"}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "منع الخصومات الحقيقية أثناء الفحص" : "Zero live charge execution safety"}
          </div>
        </div>

        {/* KPI 4: System Integrity */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "حماية وسلامة النظام" : "System Integrity"}
            </span>
            <IconCheckCircle className="h-4 w-4 text-[var(--service-success)]" />
          </div>
          <div className="mt-3">
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
              {ar ? "مطبقة بالكامل (ENFORCED)" : "ENFORCED"}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "قواعد عزل الفروع والحوكمة مفعلة" : "Strict tenant & branch isolation"}
          </div>
        </div>
      </div>

      {/* Authoritative Platform Policies Grid */}
      <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-base font-bold text-[var(--service-ink)]">
            {ar ? "السياسات التشغيلية المعتمدة للمنصة (Platform Policies)" : "Authoritative Platform Policies"}
          </h2>
          <p className="mt-0.5 text-xs text-[var(--service-muted)]">
            {ar
              ? "الضوابط الصارمة المطبقة في قاعدة البيانات والأنظمة الخلفية بدون تعديل يدوي غير معتمد."
              : "Rigid system invariants enforced across backend actions and database constraints."}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
          {/* Policy 1: Official Contact */}
          <div className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-4 space-y-1">
            <div className="font-bold text-[var(--service-ink)]">
              {ar ? "البريد الرسمي للمنصة" : "Official Contact Email"}
            </div>
            <div className="font-mono text-xs font-bold text-[var(--service-accent)]">
              {policies.officialContactEmail}
            </div>
            <p className="text-[11px] text-[var(--service-muted)] pt-1">
              {ar ? "البريد الوحيد المعتمد للمراسلات الرسمية والإشعارات الإدارية." : "Authoritative email for system notices."}
            </p>
          </div>

          {/* Policy 2: Renewal Grace Period */}
          <div className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-4 space-y-1">
            <div className="font-bold text-[var(--service-ink)]">
              {ar ? "فترة السماح بعد فشل التجديد" : "Renewal Grace Period"}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-base font-black text-[var(--service-ink)]">
                {policies.renewalGraceDays} {ar ? "أيام فقط" : "Days Strict"}
              </span>
              <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                {ar ? "سياسة إلزامية" : "Authoritative"}
              </span>
            </div>
            <p className="text-[11px] text-[var(--service-muted)] pt-1">
              {ar ? "لا يتم فصل قنوات العميل تلقائياً عند انتهاء الفترة بل يُعلق الرد الذكي فقط." : "Channels are preserved upon expiration; only AI replies stop."}
            </p>
          </div>

          {/* Policy 3: AI Budget Alert */}
          <div className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-4 space-y-1">
            <div className="font-bold text-[var(--service-ink)]">
              {ar ? "عتبة تنبيه ميزانية الذكاء" : "AI Budget Warning Threshold"}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-base font-black text-[var(--service-ink)]">
                {policies.aiBudgetAlertThresholdPercent}%
              </span>
              <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-800 border border-blue-200">
                {ar ? "عتبة تشغيلية استباقية" : "Operational Threshold"}
              </span>
            </div>
            <p className="text-[11px] text-[var(--service-muted)] pt-1">
              {ar ? "تنبيه استباقي للمالك عند بلوغ 80% من الميزانية، وتوقف آمن عند 100% (قابلة للتعديل)." : "Proactive warning at 80%, fail-closed stop at 100% (Configurable)."}
            </p>
          </div>

          {/* Policy 4: Onboarding Reminder */}
          <div className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-4 space-y-1">
            <div className="font-bold text-[var(--service-ink)]">
              {ar ? "نافذة مراجعة المنشآت الجديدة" : "Onboarding Review Window"}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-base font-black text-[var(--service-ink)]">
                {policies.onboardingReviewReminderHours} {ar ? "ساعة" : "Hours"}
              </span>
              <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] font-bold text-stone-700 border border-stone-200">
                {ar ? "هدف إداري (بدون SLA تجاري)" : "No Commercial SLA Committed"}
              </span>
            </div>
            <p className="text-[11px] text-[var(--service-muted)] pt-1">
              {ar ? "تنبيه إداري داخلي لمراجعة وتأكيد بيانات المنشأة دون أي التزام SLA تعاقدي غير معتمد." : "Internal administrative queue reminder; no unapproved commercial SLA commitment."}
            </p>
          </div>

          {/* Policy 5: Webhook Rate Limit */}
          <div className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-4 space-y-1">
            <div className="font-bold text-[var(--service-ink)]">
              {ar ? "سقف تدفق الـ Webhooks" : "Webhook Rate Limiter"}
            </div>
            <div className="text-base font-black text-[var(--service-ink)]">
              {policies.webhookRateLimitPerSec} {ar ? "طلب / ثانية" : "req/sec"}
            </div>
            <p className="text-[11px] text-[var(--service-muted)] pt-1">
              {ar ? "حماية مضادة لهجمات حجب الخدمة وازدحام قنوات واتساب وإنستجرام." : "Anti-DDoS and message throttling safeguard."}
            </p>
          </div>

          {/* Policy 6: Audit Retention */}
          <div className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-4 space-y-1">
            <div className="font-bold text-[var(--service-ink)]">
              {ar ? "سياسة الاحتفاظ بسجل التدقيق" : "Audit Retention Policy"}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-base font-black text-[var(--service-ink)] font-mono">
                {policies.auditRetentionPolicy}
              </span>
              <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] font-bold text-stone-700">
                {ar ? "غير معتمد" : "Unconfigured"}
              </span>
            </div>
            <p className="text-[11px] text-[var(--service-muted)] pt-1">
              {ar ? "تظل السجلات محفوظة بصيغة Append-only دون تطبيق مدة حذف آلي دون اعتماد." : "Append-only logs preserved; no auto-deletion without approval."}
            </p>
          </div>
        </div>
      </div>

      {/* Scheduled Workers Table */}
      <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-base font-bold text-[var(--service-ink)]">
            {ar ? "سجل وجداول المعالجات الدورية (Scheduled Workers & Queues)" : "Scheduled Workers & Queues"}
          </h2>
          <p className="mt-0.5 text-xs text-[var(--service-muted)]">
            {ar
              ? "قائمة مهام مرجعية؛ لا تتوفر أدلة تشغيل أو جداول فعلية لهذه القائمة."
              : "Reference worker inventory; execution evidence and actual schedules are unavailable."}
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)]">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-[var(--service-line)] text-[11px] font-bold text-[var(--service-muted)]">
              <tr>
                <th className="p-3.5">{ar ? "اسم المعالج" : "Worker Name"}</th>
                <th className="p-3.5">{ar ? "جدول التشغيل (Cron)" : "Schedule"}</th>
                <th className="p-3.5">{ar ? "الحالة" : "Status"}</th>
                <th className="p-3.5">{ar ? "آخر تنفيذ تم رصده" : "Last Execution"}</th>
                <th className="p-3.5">{ar ? "الوظيفة والمسؤولية" : "Description"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--service-line)] text-[var(--service-ink)]">
              {automations.map((item) => (
                <tr key={item.id} className="hover:bg-[var(--service-subtle)] transition">
                  <td className="p-3.5 font-bold text-[var(--service-ink)]">
                    {ar ? item.nameAr : item.nameEn}
                    <div className="text-[10px] font-mono text-[var(--service-muted)] font-normal">{item.id}</div>
                  </td>
                  <td className="p-3.5 font-mono text-[11px] text-[var(--service-accent)]">
                    {item.cronSchedule}
                  </td>
                  <td className="p-3.5">
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                      {ar ? "نشط" : "Active"}
                    </span>
                  </td>
                  <td className="p-3.5 font-mono text-[11px] text-[var(--service-muted)]">
                    {item.lastExecutionAt ? (
                      <time dateTime={item.lastExecutionAt}>
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: "short",
                          timeStyle: "short",
                          timeZone: "Asia/Muscat",
                        }).format(new Date(item.lastExecutionAt))}
                      </time>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3.5 text-xs text-[var(--service-muted)] max-w-sm">
                    {ar ? item.descriptionAr : item.descriptionEn}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
