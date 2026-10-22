"use client";

import Link from "next/link";
import { useDemo } from "@/lib/demo-state";
import type { readAdminBillingOrder } from "@/lib/billing/admin/actions";
import { formatOmrBaisa } from "@/components/app/subscription-offers-view";
import { financialLabels } from "./billing-ledger";
import {
  IconBuilding,
  IconChevronLeft,
  IconChevronRight,
  IconLayers,
  IconPulse,
  IconSparkles,
} from "./admin-icons";

export interface AdminBillingOrderViewProps {
  result: Awaited<ReturnType<typeof readAdminBillingOrder>>;
  back: string;
  refresh: string;
}

export function AdminBillingOrderView({ result, back, refresh }: AdminBillingOrderViewProps) {
  const { locale } = useDemo();
  const ar = locale === "ar";

  const label = (v: boolean | "unavailable" | null | undefined) =>
    v === true
      ? ar
        ? "مؤكد / نشط"
        : "Confirmed / Active"
      : v === false
      ? ar
        ? "غير مؤكد / متوقف"
        : "Not Confirmed"
      : ar
      ? "غير متوفر"
      : "Unavailable";

  const formatDate = (v: string | null | undefined) =>
    v && Number.isFinite(Date.parse(v))
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "UTC",
        }).format(new Date(v))
      : "—";

  if (result.status !== "ready" || !result.data) {
    return (
      <div className="space-y-6" dir={ar ? "rtl" : "ltr"}>
        <div className="flex items-center gap-3">
          <Link
            href={back}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--service-accent)] hover:underline"
          >
            {ar ? <IconChevronRight className="h-4 w-4" /> : <IconChevronLeft className="h-4 w-4" />}
            <span>{ar ? "العودة لسجل الفواتير" : "Back to Orders"}</span>
          </Link>
        </div>

        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-sm font-bold text-red-800 shadow-sm"
        >
          {result.status === "forbidden"
            ? ar
              ? "سجلات الدفع متاحة لمالك المنصة فقط."
              : "Access denied. Platform owner only."
            : result.status === "not_found"
            ? ar
              ? "طلب الاشتراك غير موجود في قاعدة البيانات."
              : "Order not found."
            : ar
            ? "تعذر تحميل تفاصيل الطلب. حدّث للمحاولة."
            : "Order unavailable."}
        </div>
      </div>
    );
  }

  const { order, current, serviceStates, email, timeline } = result.data;
  const active = current?.status === "ready" ? current : null;

  const emailLabels: Record<string, string> = {
    queued: ar ? "البريد في قائمة الانتظار" : "Email queued",
    claimed: ar ? "طلب الإرسال قيد المعالجة" : "Send claimed",
    accepted: ar ? "قبِل مزوّد البريد الطلب" : "Provider accepted",
    rejected: ar ? "رفض مزوّد البريد الطلب" : "Provider rejected",
    reconciliation_required: ar ? "يحتاج مراجعة ومطابقة" : "Reconciliation required",
    blocked: ar ? "أُوقف الإرسال احترازيًا" : "Send blocked",
    not_queued: ar ? "لا يوجد بريد مسجل لهذا الطلب" : "No email queued",
    unavailable: ar ? "تعذّر التحقق من حالة البريد" : "Email status unavailable",
  };

  const statusMeta = financialLabels[ar ? "ar" : "en"][order.financial.state] ?? {
    label: order.financial.state,
    tone: "neutral" as const,
  };

  return (
    <div className="space-y-6" dir={ar ? "rtl" : "ltr"}>
      {/* Navigation & Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--service-line)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href={back}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--service-accent)] hover:underline"
            >
              {ar ? <IconChevronRight className="h-4 w-4" /> : <IconChevronLeft className="h-4 w-4" />}
              <span>{ar ? "سجل الاشتراكات" : "Orders Ledger"}</span>
            </Link>
            <span className="text-xs text-[var(--service-muted)]">/</span>
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "تفاصيل طلب الاشتراك" : "Order Details"}
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-black text-[var(--service-ink)] tracking-tight">
            {ar ? "تفاصيل طلب الاشتراك" : "Subscription Order Details"}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-xs text-[var(--service-muted)]">{order.id}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                statusMeta.tone === "success"
                  ? "bg-emerald-100 text-emerald-800"
                  : statusMeta.tone === "warn"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-red-100 text-red-800"
              }`}
            >
              {statusMeta.label}
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/admin/companies/${order.companyId}`}
            className="flex items-center gap-1.5 rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--service-ink)] shadow-sm hover:bg-[var(--service-subtle)] transition"
          >
            <IconBuilding className="h-3.5 w-3.5 text-[var(--service-accent)]" />
            <span>{ar ? "ملف الشركة" : "View Company"}</span>
          </Link>

          <Link
            href={refresh}
            className="flex items-center gap-1.5 rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--service-ink)] shadow-sm hover:bg-[var(--service-subtle)] transition"
          >
            <IconPulse className="h-3.5 w-3.5 text-[var(--service-accent)]" />
            <span>{ar ? "تحديث" : "Refresh"}</span>
          </Link>
        </div>
      </div>

      {/* Main Order Financial Facts Card */}
      <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-6 shadow-sm">
        <h2 className="text-base font-bold text-[var(--service-ink)]">
          {ar ? "البيانات المالية الأساسية للطلب" : "Order Financial Details"}
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6 text-xs">
          <div className="rounded-xl bg-[var(--service-canvas)] p-3 border border-[var(--service-line)]">
            <div className="text-[10px] font-bold text-[var(--service-muted)]">
              {ar ? "المبلغ المحفوظ" : "Locked Amount"}
            </div>
            <div className="mt-1 font-mono text-base font-black text-[var(--service-accent)]">
              {order.amountBaisa !== null && order.currency === "OMR"
                ? formatOmrBaisa(order.amountBaisa, locale)
                : "—"}
            </div>
          </div>

          <div className="rounded-xl bg-[var(--service-canvas)] p-3 border border-[var(--service-line)]">
            <div className="text-[10px] font-bold text-[var(--service-muted)]">
              {ar ? "حالة الدفع" : "Payment State"}
            </div>
            <div className="mt-1 font-bold text-[var(--service-ink)]">{statusMeta.label}</div>
          </div>

          <div className="rounded-xl bg-[var(--service-canvas)] p-3 border border-[var(--service-line)]">
            <div className="text-[10px] font-bold text-[var(--service-muted)]">
              {ar ? "بيئة التنفيذ" : "Environment"}
            </div>
            <div className="mt-1 font-bold text-[var(--service-ink)]">
              {order.environment ?? (ar ? "غير معروف" : "Unknown")}
            </div>
          </div>

          <div className="rounded-xl bg-[var(--service-canvas)] p-3 border border-[var(--service-line)]">
            <div className="text-[10px] font-bold text-[var(--service-muted)]">
              {ar ? "تاريخ التحصيل المؤهل" : "Qualified Collection"}
            </div>
            <div className="mt-1 font-mono text-[11px] text-[var(--service-ink)]">
              {formatDate(order.financial.collectedAt)}
            </div>
          </div>

          <div className="rounded-xl bg-[var(--service-canvas)] p-3 border border-[var(--service-line)]">
            <div className="text-[10px] font-bold text-[var(--service-muted)]">
              {ar ? "صالح حتى تاريخ" : "Paid Through"}
            </div>
            <div className="mt-1 font-mono text-[11px] text-[var(--service-ink)]">
              {formatDate(order.financial.paidThrough)}
            </div>
          </div>

          <div className="rounded-xl bg-[var(--service-canvas)] p-3 border border-[var(--service-line)]">
            <div className="text-[10px] font-bold text-[var(--service-muted)]">
              {ar ? "مهلة الدفع" : "Checkout Deadline"}
            </div>
            <div className="mt-1 font-mono text-[11px] text-[var(--service-ink)]">
              {formatDate(order.checkoutDeadline)}
            </div>
          </div>
        </div>
      </div>

      {/* Grid: Eligibility & Service Grants */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Company Billing Eligibility */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--service-line)] pb-3">
            <h2 className="text-base font-bold text-[var(--service-ink)]">
              {ar ? "أهلية الشركة التشغيلية الحالية" : "Current Company Eligibility"}
            </h2>
            <IconSparkles className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
            <div className="rounded-xl bg-[var(--service-canvas)] p-3 border border-[var(--service-line)]">
              <span className="text-[10px] font-bold text-[var(--service-muted)]">
                {ar ? "الأهلية الحالية:" : "Current Eligibility:"}
              </span>
              <div className="mt-1 font-bold text-[var(--service-ink)]">
                {label(active?.operationalEligible)}
              </div>
            </div>

            <div className="rounded-xl bg-[var(--service-canvas)] p-3 border border-[var(--service-line)]">
              <span className="text-[10px] font-bold text-[var(--service-muted)]">
                {ar ? "الرسائل المقبولة:" : "Accepted Messages:"}
              </span>
              <div className="mt-1 font-mono font-bold text-[var(--service-ink)]">
                {active?.sent?.toLocaleString(locale) ?? "—"}
              </div>
            </div>

            <div className="rounded-xl bg-[var(--service-canvas)] p-3 border border-[var(--service-line)]">
              <span className="text-[10px] font-bold text-[var(--service-muted)]">
                {ar ? "السعة المحجوزة:" : "Held Capacity:"}
              </span>
              <div className="mt-1 font-mono font-bold text-[var(--service-ink)]">
                {active?.held?.toLocaleString(locale) ?? "—"}
              </div>
            </div>

            <div className="rounded-xl bg-[var(--service-canvas)] p-3 border border-[var(--service-line)]">
              <span className="text-[10px] font-bold text-[var(--service-muted)]">
                {ar ? "السعة المتبقية:" : "Remaining Allowance:"}
              </span>
              <div className="mt-1 font-mono font-bold text-[var(--service-success)]">
                {active?.remaining?.toLocaleString(locale) ?? "—"}
              </div>
            </div>
          </div>
        </div>

        {/* Service Grants Activation */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--service-line)] pb-3">
            <h2 className="text-base font-bold text-[var(--service-ink)]">
              {ar ? "تفعيل منح الخدمة (Service Grants)" : "Service Grants Activation"}
            </h2>
            <IconLayers className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-4 space-y-2 text-xs">
            {serviceStates === null ? (
              <p className="text-[var(--service-muted)]">{label(null)}</p>
            ) : serviceStates.length ? (
              serviceStates.map((x, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-xl bg-[var(--service-canvas)] p-3 border border-[var(--service-line)]"
                >
                  <span className="font-bold text-[var(--service-ink)]">
                    {x.service} / {x.tier}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      x.activated ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                    }`}
                  >
                    {label(x.activated)}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-[var(--service-muted)]">
                {ar ? "لا توجد منحة خدمة حالية." : "No current service grant."}
              </p>
            )}
          </div>

          <div className="mt-4 border-t border-[var(--service-line)] pt-3 text-xs">
            <span className="text-[10px] font-bold text-[var(--service-muted)]">
              {ar ? "بريد تأكيد الاشتراك:" : "Confirmation Email:"}
            </span>
            <div className="mt-1 font-semibold text-[var(--service-ink)]">
              {emailLabels[email?.state ?? "unavailable"]}
            </div>
            {email?.acceptedAt && (
              <div className="mt-0.5 font-mono text-[11px] text-[var(--service-muted)]">
                {ar ? "وقت القبول: " : "Accepted at: "} {formatDate(email.acceptedAt)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Subscription Lifecycle & Integrity Policy Card */}
      <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-6 shadow-sm">
        <h2 className="text-base font-bold text-[var(--service-ink)]">
          {ar ? "حوكمة دورة الاشتراك والنزاهة المالية" : "Subscription Lifecycle & Financial Integrity Governance"}
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3 text-xs">
          <div className="rounded-xl bg-[var(--service-canvas)] p-4 border border-[var(--service-line)] space-y-1.5">
            <div className="font-bold text-[var(--service-ink)]">
              {ar ? "دورة الاشتراك والبدء التقويمي" : "Calendar Subscription & Activation"}
            </div>
            <p className="text-[11px] text-[var(--service-muted)] leading-relaxed">
              {ar
                ? "المدة شهر أو سنة تقويمية بحسابات نهاية الشهر والسنوات الكبيسة. الدفع أولاً (Payment-first) مع نافذة تفعيل ٧ أيام؛ وتبدأ الدورة عند جاهزية أول قناة مدفوعة مؤهلة والمساعد."
                : "Term follows calendar months/years with leap-year and month-end clamping. Payment-first policy with a 7-day activation window; initial term begins on readiness of the first qualified paid channel and assistant."}
            </p>
          </div>

          <div className="rounded-xl bg-[var(--service-canvas)] p-4 border border-[var(--service-line)] space-y-1.5">
            <div className="font-bold text-[var(--service-ink)]">
              {ar ? "سماح التجديد واستبقاء الإعدادات" : "3-Day Grace & Settings Retention"}
            </div>
            <p className="text-[11px] text-[var(--service-muted)] leading-relaxed">
              {ar
                ? "فترة السماح عند تعثر التجديد ٣ أيام فقط. لا تُفصل القنوات أو تُحذف إعدادات العميل تلقائيًا؛ تظل الإعدادات محفوظة لإعادة التفعيل بعد سداد الدورة والتحقق من الربط."
                : "Grace period on renewal failure is strictly 3 days. Channels and customer configurations are never deleted automatically; settings are preserved for re-activation upon new cycle payment and connection validation."}
            </p>
          </div>

          <div className="rounded-xl bg-[var(--service-canvas)] p-4 border border-[var(--service-line)] space-y-1.5">
            <div className="font-bold text-[var(--service-ink)]">
              {ar ? "أرصدة الردود والتعويضات" : "Reply Credits & Compensations"}
            </div>
            <p className="text-[11px] text-[var(--service-muted)] leading-relaxed">
              {ar
                ? "إدارة الأرصدة مقسمة عبر ٣ أوعية مستقلة: الحصة الشهرية الأساسية (Base Cap)، وشحن الرصيد (Topup)، والتعويضات الإدارية المعتمدة (Compensation) لحفظ حقوق المشتركين."
                : "Reply credits are tracked across three discrete pools: Base monthly quota, Topup credits, and administrative Compensations to safeguard subscriber entitlements."}
            </p>
          </div>

          <div className="rounded-xl bg-[var(--service-canvas)] p-4 border border-[var(--service-line)] space-y-1.5">
            <div className="font-bold text-[var(--service-ink)]">
              {ar ? "منع التكرار وتسوية المعلقات" : "Anti-Double-Charging & Settlement"}
            </div>
            <p className="text-[11px] text-[var(--service-muted)] leading-relaxed">
              {ar
                ? "حماية مطلقة من تكرار التحصيل عبر قيد إيصال دفع وحيد لكل طلب. المعاملات غير المؤكدة أو المستردة تُصنف تلقائيًا كمراجعة مطلوبة (Requires Review) دون اقتطاع مزدوج."
                : "Strict anti-double-charging enforced via one-receipt-per-order schema invariants. Ambiguous or refunded events are placed under mandatory review without double debit."}
            </p>
          </div>
        </div>
      </div>

      {/* Order Timeline Events */}
      <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-6 shadow-sm">
        <h2 className="text-base font-bold text-[var(--service-ink)]">
          {ar ? "سجل أحداث الطلب (Order Timeline)" : "Order Timeline"}
        </h2>
        {timeline.length ? (
          <div className="mt-4 space-y-3">
            {[...timeline]
              .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""))
              .map((x) => (
                <div
                  key={`${x.kind}-${x.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--service-canvas)] p-3 border border-[var(--service-line)] text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-[var(--service-accent-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--service-accent)] uppercase">
                      {x.kind}
                    </span>
                    <span className="font-semibold text-[var(--service-ink)]">{x.state}</span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[11px] text-[var(--service-muted)]">
                    <time>{formatDate(x.at)}</time>
                    <span className="text-[10px]">{x.id}</span>
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <p className="mt-4 text-xs text-[var(--service-muted)]">
            {ar ? "لا توجد أحداث مطابقة محفوظة." : "No matching stored events."}
          </p>
        )}
      </div>
    </div>
  );
}
