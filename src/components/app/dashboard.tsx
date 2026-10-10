"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";
import { useDemo } from "@/lib/demo-state";
import { readDashboardBilling } from "@/lib/customer/dashboard-billing-actions";
import type { DashboardBillingLoad } from "@/lib/customer/dashboard-billing-model";
import { dashboardInboxMetrics, type DashboardInboxLoad } from "./onboarding-contracts";
import { fill } from "@/lib/app-copy";
import { getCustomerReadiness } from "@/lib/tenancy/actions";
import type {
  CustomerReadinessItem,
  CustomerReadinessItemId,
  CustomerReadinessSnapshot,
  ReadinessDetail,
  ReadinessTone,
} from "@/lib/tenancy/customer-readiness";
import { WorkspaceShell } from "@/components/app/workspace-shell";
import { Button, LinkButton, Notice, useAppCopy } from "@/components/app/ui";

function DashboardBillingCard({ companyId }: { companyId: string | null }) {
  const { locale } = useDemo();
  const ar = locale === "ar";
  const [billing, setBilling] = useState<DashboardBillingLoad | null>(null);
  const request = useRef(0);
  const text = ar
    ? {
        title: "الاشتراك والاستهلاك الشهري",
        body: "الرسائل الآلية المقبولة والسعة المحجوزة من سجلات النشاط الفعلية.",
        account: "إدارة الباقة والاشتراك",
        retry: "تحديث",
        unavailable: "تعذّر تحميل الاشتراك والاستهلاك. لا تتوفر أرقام مؤكدة الآن.",
        forbidden: "بيانات الاشتراك متاحة لمالك النشاط بعد اختيار مساحة العمل.",
        empty: "لا يوجد اشتراك مسجّل لهذا النشاط.",
        sent: "رسائل آلية مقبولة",
        held: "سعة محجوزة",
        remaining: "من السعة المتبقية",
        capMissing: "السعة القابلة للاستخدام غير متوفرة",
        period: "بداية شهر الاستخدام",
        status: "أهلية الاشتراك الحالية",
        paidThrough: "مدفوع حتى",
        loading: "جارٍ تحميل البيانات…",
      }
    : {
        title: "Subscription and Usage",
        body: "Accepted automated messages and reserved capacity from company records.",
        account: "Manage Subscription",
        retry: "Refresh",
        unavailable: "Subscription and usage could not be loaded. Confirmed figures are unavailable.",
        forbidden: "Subscription data requires the company owner and a selected workspace.",
        empty: "No subscription is recorded for this company.",
        sent: "accepted automated messages",
        held: "reserved capacity",
        remaining: "remaining allowance",
        capMissing: "Usable allowance unavailable",
        period: "Usage month starts",
        status: "Current subscription eligibility",
        paidThrough: "Paid through",
        loading: "Loading data…",
      };

  useEffect(() => {
    const generation = ++request.current;
    startTransition(async () => {
      try {
        const result = await readDashboardBilling({expectedCompanyId:companyId??undefined});
        if (generation === request.current) setBilling(result);
      } catch {
        if (generation === request.current) setBilling({ status: "unavailable" });
      }
    });
    return () => {
      request.current += 1;
    };
  }, [companyId]);

  function refresh() {
    const generation = ++request.current;
    setBilling(null);
    startTransition(async () => {
      try {
        const result = await readDashboardBilling({expectedCompanyId:companyId??undefined});
        if (generation === request.current) setBilling(result);
      } catch {
        if (generation === request.current) setBilling({ status: "unavailable" });
      }
    });
  }

  const snapshot = billing?.status === "ready" && billing.companyId === companyId ? billing : null;
  const factLabel=(value:boolean|"unavailable")=>value==="unavailable"?(ar?"غير متوفر":"Unavailable"):value?(ar?"مؤكد":"Confirmed"):(ar?"غير مؤكد":"Not confirmed");
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat(ar ? "ar-OM" : "en-GB", { timeZone: "UTC" }).format(new Date(date));

  return (
    <section
      className="mb-6 relative overflow-hidden rounded-3xl border border-[#38dc89]/30 bg-[var(--color-panel-deep)] p-5 shadow-sm sm:p-6"
      aria-label={text.title}
    >
      <div className="pointer-events-none absolute end-0 top-0 -me-8 -mt-8 h-48 w-48 rounded-full bg-[#38dc89]/10 blur-3xl" />
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#38dc89]/20 border border-[#38dc89]/30 text-base">
              ⚡
            </span>
            <h2 className="text-base font-bold text-[var(--color-on-dark)] sm:text-lg">{text.title}</h2>
          </div>
          <p className="mt-1.5 text-xs text-[var(--color-muted-on-dark)] sm:text-sm">{text.body}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" busy={billing === null} onClick={refresh}>
            {text.retry}
          </Button>
          <Link
            href="/app/settings?tab=plan"
            className="inline-flex min-h-10 items-center rounded-full border border-[#38dc89]/50 bg-[#38dc89]/15 px-4 text-xs font-semibold text-[var(--color-success-fg)] transition hover:bg-[#38dc89]/25 hover:shadow-[0_0_16px_rgba(56,220,137,0.3)]"
          >
            {text.account}
          </Link>
        </div>
      </div>
      {snapshot ? (
        <div className="relative mt-5">
          <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-[var(--color-muted-on-dark)]">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium ${snapshot.operationalEligible===true?"bg-[#38dc89]/15 border-[#38dc89]/30 text-[var(--color-success-fg)]":"border-white/20 text-[var(--color-muted-on-dark)]"}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {text.status}: {factLabel(snapshot.operationalEligible)}
            </span>
            <span>{ar?"سجل الدفع المؤهل":"Qualified payment history"}: {factLabel(snapshot.billingPaid)}</span>
            <span>{ar?"جاهزية القناة":"Channel readiness"}: {factLabel(snapshot.channelReady)}</span>
            {snapshot.paidThrough ? (
              <span>
                {text.paidThrough}: <strong>{formatDate(snapshot.paidThrough)}</strong>
              </span>
            ) : null}
          </div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
            <span className="text-[var(--color-on-dark)]">
              <strong>{snapshot.sent===null?"—":snapshot.sent.toLocaleString(locale)}</strong>
              {snapshot.cap !== null ? ` / ${snapshot.cap.toLocaleString(locale)}` : ""} {text.sent}
            </span>
            <span className="text-[var(--color-success-fg)] font-semibold">
              {snapshot.remaining === null ? text.capMissing : `${snapshot.remaining.toLocaleString(locale)} ${text.remaining}`}
            </span>
          </div>
          <p className="mb-3 text-xs text-[var(--color-muted-on-dark)]">{ar?"تأكيد الدفع لا يفعّل الذكاء الاصطناعي أو القناة؛ الإرسال يحتاج خدمة مفعّلة وتصريح قناة سارٍ.":"Payment confirmation does not activate AI or channels. Sending requires an active service and current channel authorization."}</p>
          {snapshot.usedPercent !== null ? (
            <div
              className="h-3 w-full overflow-hidden rounded-full bg-[var(--color-hover-wash)] p-0.5"
              role="progressbar"
              aria-label={text.title}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={snapshot.usedPercent}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#2ebd73] to-[#38dc89] shadow-[0_0_14px_rgba(56,220,137,0.6)] transition-all duration-700"
                style={{ width: `${Math.min(100, snapshot.usedPercent)}%` }}
              />
            </div>
          ) : null}
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-muted-on-dark)]">
            <span>
              {snapshot.held===null?"—":snapshot.held.toLocaleString(locale)} {text.held}
            </span>
            <span>
              {text.period}: {snapshot.monthStart?formatDate(snapshot.monthStart):"—"}
            </span>
          </div>
        </div>
      ) : (
        <p className="relative mt-4 text-sm text-[var(--color-muted-on-dark)]" role="status">
          {billing === null
            ? text.loading
            : billing.status === "forbidden"
              ? text.forbidden
              : billing.status === "empty" && billing.companyId === companyId
                ? text.empty
                : text.unavailable}
        </p>
      )}
    </section>
  );
}

function DashboardDecoupledPillars({
  readiness,
  locale,
}: {
  readiness: CustomerReadinessSnapshot | null;
  locale: "ar" | "en";
}) {
  const ar = locale === "ar";

  // State 1: Subscription Active (billing_settled / active)
  const subItem = readiness?.items.find((i) => i.id === "subscription");
  const isSubSettled = subItem?.tone === "complete";
  const subscriptionKnown = subItem?.detail === "subscription_active" || subItem?.detail === "subscription_inactive";

  // State 2: Company Setup Completed (Profile & Knowledge saved)
  const compItem = readiness?.items.find((i) => i.id === "company");
  const knowItem = readiness?.items.find((i) => i.id === "knowledge");
  const isSetupComplete =
    compItem?.tone === "complete" &&
    (knowItem?.tone === "complete" || knowItem?.detail === "knowledge_ready");

  // State 3: Meta WhatsApp Verified (wa_verified via Meta Cloud API — distinct from request_saved)
  const waItem = readiness?.items.find((i) => i.id === "whatsapp");
  const isWaVerified = waItem?.detail === "wa_verified" || waItem?.detail === "wa_verified_not_live";

  // State 4: Review Submitted / Pending / Approved
  const reviewItem = readiness?.items.find((i) => i.id === "review");
  const isReviewApproved = reviewItem?.detail === "review_approved";
  const isReviewPending = reviewItem?.detail === "review_pending";

  // State 5: Live Outbound AI Active (Never inferred!)
  // Strictly requires all technical and security criteria met AND not paused
  // No authoritative deployment/activity snapshot is provided by readiness or inbox rows.
  const liveRolloutKnownDisabled = readiness?.items.some(item => item.id === "whatsapp" && item.detail === "wa_verified_not_live") ?? false;

  const pillars = [
    {
      num: 1,
      title: ar ? "1. أهلية الاشتراك الحالية" : "1. Current Subscription Eligibility",
      badge: !subscriptionKnown
        ? (ar ? "حالة الاشتراك غير متوفرة" : "Subscription status unavailable")
        : isSubSettled
        ? (ar ? "أهلية مؤكدة" : "Eligibility Confirmed")
        : (ar ? "غير مؤهل حاليًا" : "Not Currently Eligible"),
      tone: isSubSettled ? "complete" : "pending",
      detail: ar
        ? "أهلية حالية مؤهلة؛ تشغيل الخدمة والقناة منفصل"
        : "Qualified current entitlement; service and channel activation are separate",
      href: "/app/settings?tab=plan",
      cta: ar ? "إدارة الباقة ↗" : "Manage ↗",
    },
    {
      num: 2,
      title: ar ? "2. إعداد النشاط والمعرفة" : "2. Company Setup & Knowledge",
      badge: isSetupComplete
        ? (ar ? "مكتمل ومعتمد" : "Complete & Ready")
        : (ar ? "قيد التجهيز" : "In Progress"),
      tone: isSetupComplete ? "complete" : "pending",
      detail: ar
        ? "الملف، ساعات العمل والمعلومات المعتمدة"
        : "Profile, hours, and approved knowledge",
      href: "/setup",
      cta: ar ? "استكمال الإعداد ↗" : "Configure ↗",
    },
    {
      num: 3,
      title: ar ? "3. توثيق واتساب ميتا" : "3. Meta WhatsApp Verification",
      badge: !waItem || waItem.detail === "load_failed"
        ? (ar ? "حالة الربط غير متوفرة" : "Connection status unavailable")
        : isWaVerified
        ? (ar ? "موثق رسميًا عبر Meta" : "Verified via Meta")
        : waItem?.detail === "wa_request_saved"
          ? (ar ? "طلب ربط مسجل (غير موثق)" : "Request Saved (Not Verified)")
          : (ar ? "غير متصل" : "Not Connected"),
      tone: isWaVerified ? "complete" : "blocked",
      detail: ar
        ? "كتابة الرقم طلب ربط فقط؛ التوثيق عبر Meta"
        : "Phone entry is a request, not verification",
      href: "/app/settings?tab=whatsapp",
      cta: ar ? "إعدادات الربط ↗" : "Settings ↗",
    },
    {
      num: 4,
      title: ar ? "4. طلب المراجعة الإدارية" : "4. Admin Review Request",
      badge: !reviewItem || reviewItem.detail === "load_failed" || reviewItem.detail === "review_owner_only"
        ? (ar ? "حالة المراجعة غير متوفرة" : "Review status unavailable")
        : isReviewApproved
        ? (ar ? "معتمد إداريًا" : "Approved")
        : isReviewPending
          ? (ar ? "قيد التدقيق" : "Pending Review")
          : reviewItem?.detail === "review_changes"
            ? (ar ? "طُلبت تعديلات" : "Changes Requested")
            : (ar ? "لم يُرسل بعد" : "Not Submitted"),
      tone: isReviewApproved ? "complete" : isReviewPending ? "pending" : "incomplete",
      detail: ar
        ? "اعتماد المراجعة لا يشغّل واتساب تلقائيًا"
        : "Approval does not auto-activate live replies",
      href: "/setup",
      cta: ar ? "عرض الطلب ↗" : "View ↗",
    },
    {
      num: 5,
      title: ar ? "5. الرد الآلي الحي لنورا" : "5. Live Outbound AI Active",
      badge: liveRolloutKnownDisabled
        ? (ar ? "التشغيل المباشر معطل" : "Live rollout disabled")
        : (ar ? "حالة التشغيل المباشر غير متاحة" : "Live status unavailable"),
      tone: liveRolloutKnownDisabled ? "blocked" : "not_configured",
      detail: ar
        ? "لا يُستنتج من الإعداد؛ يتطلب استيفاء كافة الشروط"
        : "Never inferred; requires all conditions met",
      href: "/app/conversations",
      cta: ar ? "الصندوق الموحد ↗" : "Inbox ↗",
    },
  ];

  return (
    <section
      className="mb-6 rounded-3xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] p-5 shadow-[0_8px_24px_rgba(16,27,22,0.06)] sm:p-6"
      aria-label={ar ? "حالات المنظومة الخمس المستقلة" : "5 Decoupled System Pillars"}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--color-border-soft)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#38dc89]/20 text-sm">
              🛡️
            </span>
            <h2 className="text-base font-bold text-[var(--color-on-dark)] sm:text-lg">
              {ar
                ? "حالات المنظومة الخمس المستقلة (5 Decoupled System Pillars)"
                : "5 Decoupled System Pillars"}
            </h2>
          </div>
          <p className="mt-1 text-xs text-[var(--color-muted-on-dark)]">
            {ar
              ? "فصل صريح بين الاشتراك، الإعداد، توثيق ميتا، المراجعة، والتفعيل الحي لمنع أي ادعاء مسبق للتشغيل."
              : "Strict decoupling of subscription, setup, Meta verification, review, and live AI activation."}
          </p>
        </div>
        <span className="rounded-full bg-[var(--color-hover-wash)] px-3 py-1 text-xs font-medium text-[var(--color-muted-on-dark)]">
          {ar ? "تحقق أمني مستقل" : "Independent Verification"}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {pillars.map((p) => {
          const isComplete = p.tone === "complete";
          const isPending = p.tone === "pending";
          return (
            <div
              key={p.num}
              className="flex flex-col justify-between rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] p-4 transition hover:border-[color:var(--color-line)]"
            >
              <div>
                <span className="text-[11px] font-bold text-[var(--color-success-fg)]">#{p.num}</span>
                <h3 className="mt-1 text-sm font-semibold text-[var(--color-on-dark)] leading-snug">{p.title}</h3>
                <span
                  className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                    isComplete
                      ? "bg-[#38dc89]/15 text-[#38dc89] border border-[#38dc89]/30"
                      : isPending
                        ? "bg-[#d9a467]/15 text-[var(--color-warn-fg)] border border-[#d9a467]/30"
                        : "bg-[#e07a7a]/15 text-[var(--color-danger-fg)] border border-[#e07a7a]/30"
                  }`}
                >
                  {p.badge}
                </span>
                <p className="mt-2.5 text-xs text-[var(--color-muted-soft)] leading-relaxed">{p.detail}</p>
              </div>
              <div className="mt-3 pt-2.5 border-t border-[color:var(--color-border-soft)]">
                <Link
                  href={p.href}
                  className="text-xs font-medium text-[#38dc89] hover:underline"
                >
                  {p.cta}
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function toneClass(tone: ReadinessTone): string {
  if (tone === "complete") return "bg-[#38dc89]/15 text-[var(--color-success-fg)] border border-[#38dc89]/30";
  if (tone === "pending") return "bg-[#d9a467]/15 text-[var(--color-warn-fg)] border border-[#d9a467]/30";
  if (tone === "blocked" || tone === "load_failed") return "bg-[#e07a7a]/15 text-[var(--color-danger-fg)] border border-[#e07a7a]/30";
  if (tone === "not_configured") return "bg-[var(--color-hover-wash)] text-[var(--color-muted-soft)] border border-white/10";
  return "bg-[var(--color-hover-wash)] text-[var(--color-on-dark)] border border-white/10";
}

function itemLabel(id: CustomerReadinessItemId, copy: ReturnType<typeof useAppCopy>): string {
  return copy.app.readinessItems[id];
}

function detailLabel(detail: ReadinessDetail, copy: ReturnType<typeof useAppCopy>): string {
  return copy.app.readinessDetails[detail];
}

function actionLabel(action: CustomerReadinessItem["action"], copy: ReturnType<typeof useAppCopy>): string | null {
  if (action === "continue") return copy.app.readinessActions.continue;
  if (action === "review") return copy.app.readinessActions.review;
  if (action === "edit") return copy.app.readinessActions.edit;
  return null;
}

export function DashboardPage({
  initialLeads,
  initialReadiness = null,
  readinessLoadFailed = false,
}: {
  initialLeads: DashboardInboxLoad;
  initialReadiness?: CustomerReadinessSnapshot | null;
  readinessLoadFailed?: boolean;
}) {
  const copy = useAppCopy();
  const router = useRouter();
  const { locale } = useDemo();
  const ar = locale === "ar";

  const [readiness, setReadiness] = useState<CustomerReadinessSnapshot | null>(initialReadiness);
  const [loadFailed, setLoadFailed] = useState(readinessLoadFailed);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const genRef = useRef(0);

  const [trackedProps, setTrackedProps] = useState(() => ({
    readiness: initialReadiness,
    failed: readinessLoadFailed,
  }));
  if (
    trackedProps.readiness !== initialReadiness ||
    trackedProps.failed !== readinessLoadFailed
  ) {
    setTrackedProps({ readiness: initialReadiness, failed: readinessLoadFailed });
    setReadiness(initialReadiness);
    setLoadFailed(readinessLoadFailed);
    setRefreshFailed(false);
  }

  useEffect(() => {
    genRef.current += 1;
  }, [initialReadiness, readinessLoadFailed]);

  async function reloadReadiness() {
    const gen = ++genRef.current;
    setBusy(true);
    try {
      const result = await getCustomerReadiness();
      if (gen !== genRef.current) return;
      if (!result.ok) {
        setRefreshFailed(true);
        return;
      }
      setLoadFailed(false);
      setRefreshFailed(false);
      setReadiness(result.data);
      router.refresh();
    } catch {
      if (gen !== genRef.current) return;
      setRefreshFailed(true);
    } finally {
      if (gen === genRef.current) setBusy(false);
    }
  }

  const nextItem = readiness?.nextItemId
    ? readiness.items.find((i) => i.id === readiness.nextItemId) ?? null
    : null;
  const helloName = readiness?.fullName || "";
  const companyName = readiness?.companyName || "";

  const metrics = dashboardInboxMetrics(initialLeads, readiness?.companyId);
  const totalConversations = metrics.total;
  const nouraAutomatedCount = metrics.loadedAutomationPermitted;
  const awaitingStaffCount = metrics.loadedAwaitingStaff;

  // WhatsApp connection state indicator
  const waItem = readiness?.items.find((i) => i.id === "whatsapp");
  const waStatusLabel = waItem
    ? detailLabel(waItem.detail, copy)
    : ar
      ? "غير معروف"
      : "Unknown";
  const waTone = waItem?.tone ?? "not_configured";

  // Recent conversations feed (latest 4 sorted by last activity)
  const recentConversations = initialLeads.ok && (!readiness?.companyId || initialLeads.meta.companyId === readiness.companyId)
    ? [...initialLeads.conversations]
        .sort((a, b) => {
          const aTime = a.lastTouchAt ? Date.parse(a.lastTouchAt) : (a.messages[a.messages.length - 1]?.at ?? 0);
          const bTime = b.lastTouchAt ? Date.parse(b.lastTouchAt) : (b.messages[b.messages.length - 1]?.at ?? 0);
          return bTime - aTime;
        })
        .slice(0, 4)
    : [];

  const stageLabels: Record<string, string> = ar
    ? {
        new: "جديد",
        qualified: "مؤهل",
        follow_up: "متابعة",
        negotiating: "تفاوض",
        won: "مكتمل",
        lost: "ملغي",
      }
    : {
        new: "New",
        qualified: "Qualified",
        follow_up: "Follow-up",
        negotiating: "Negotiation",
        won: "Won",
        lost: "Lost",
      };

  return (
    <WorkspaceShell title={copy.app.dashboardTitle}>
      {/* Executive Welcome & Overview Header */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--color-border-soft)] pb-5">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-on-dark)] lg:text-3xl">
              {fill(copy.app.hello, { name: helloName || (ar ? "صاحب العمل" : "Business Owner") })}
            </h1>
            {companyName ? (
              <span className="inline-flex items-center rounded-full bg-[#38dc89]/15 border border-[#38dc89]/30 px-3 py-1 text-xs font-semibold text-[var(--color-success-fg)]">
                🏢 {companyName}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-[var(--color-muted-on-dark)]">
            {ar
              ? "متابعة الأداء اللحظي لنورا، محادثات العملاء، وحالة ربط واتساب والاشتراك."
              : "Monitor real-time Noura AI performance, customer conversations, and WhatsApp status."}
          </p>
        </div>

        {/* Quick-action shortcuts */}
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton href="/app/conversations" variant="secondary" className="text-xs">
            💬 {copy.app.nav.conversations}
          </LinkButton>
          <LinkButton href="/app/test" variant="secondary" className="text-xs">
            🧪 {copy.app.nav.test}
          </LinkButton>
          <LinkButton href="/app/knowledge" variant="secondary" className="text-xs">
            🧠 {copy.app.nav.knowledge}
          </LinkButton>
          <LinkButton href="/setup" variant="primary" className="text-xs font-semibold">
            🚀 {ar ? "إعداد النشاط" : "Setup Wizard"}
          </LinkButton>
        </div>
      </header>

      {/* Top 4 KPI Metric Cards */}
      <section
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label={ar ? "المؤشرات التشغيلية الرئيسية" : "Key Operational Metrics"}
      >
        {/* Card 1: Total Conversations */}
        <Link
          href="/app/conversations?worklist=all"
          className="group relative overflow-hidden rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] p-4 shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition hover:border-[#38dc89]/50 hover:bg-[var(--color-hover-wash)]"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--color-muted-on-dark)]">
              {ar ? "إجمالي المحادثات المتاحة لك" : "Total visible conversations"}
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#38dc89]/15 text-sm text-[var(--color-success-fg)]">
              💬
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-[var(--color-on-dark)] lg:text-3xl">
            {totalConversations !== null ? totalConversations.toLocaleString(locale) : "—"}
          </p>
          <p className="mt-1 text-xs text-[var(--color-muted-soft)]">
            {ar ? "من السجلات ضمن صلاحيات العرض" : "Authoritative total within your access scope"}
          </p>
        </Link>

        {/* Card 2: Noura Automated Conversations */}
        <Link
          href="/app/conversations?worklist=all"
          className="group relative overflow-hidden rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] p-4 shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition hover:border-[#38dc89]/50 hover:bg-[var(--color-hover-wash)]"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--color-muted-on-dark)]">
              {ar ? "محادثات تسمح بالأتمتة" : "Automation permitted chats"}
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#38dc89]/25 text-sm text-[#38dc89]">
              ✨
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-[var(--color-success-fg)] lg:text-3xl">
            {nouraAutomatedCount !== null ? nouraAutomatedCount.toLocaleString(locale) : "—"}
          </p>
          <p className="mt-1 text-xs text-[var(--color-muted-soft)]">
            {ar ? "ضمن المحادثات المحملة؛ الإذن لا يؤكد الرد الحي" : "Loaded chats; permission does not confirm live replies"}
          </p>
        </Link>

        {/* Card 3: Needs Human Staff Intervention */}
        <Link
          href="/app/conversations?filter=staff"
          className={`group relative overflow-hidden rounded-2xl border p-4 shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition ${
            awaitingStaffCount && awaitingStaffCount > 0
              ? "border-[#d9a467]/50 bg-[var(--color-panel-deep)] hover:border-[#d9a467]"
              : "border-[color:var(--color-border-soft)] bg-[var(--color-panel)] hover:border-[#38dc89]/50 hover:bg-[var(--color-hover-wash)]"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--color-muted-on-dark)]">
              {ar ? "محادثات تحتاج متابعة بشرية" : "Conversations needing human attention"}
            </span>
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm ${
                awaitingStaffCount && awaitingStaffCount > 0
                  ? "bg-[#d9a467]/25 text-[var(--color-warn-fg)]"
                  : "bg-[var(--color-hover-wash)] text-[var(--color-muted-on-dark)]"
              }`}
            >
              👤
            </span>
          </div>
          <p
            className={`mt-3 text-2xl font-bold tracking-tight lg:text-3xl ${
              awaitingStaffCount && awaitingStaffCount > 0 ? "text-[var(--color-warn-fg)]" : "text-[var(--color-on-dark)]"
            }`}
          >
            {awaitingStaffCount !== null ? awaitingStaffCount.toLocaleString(locale) : "—"}
          </p>
          <p className="mt-1 text-xs text-[var(--color-muted-soft)]">
            {ar ? "من سجل التدخل في مساحة العمل المتاحة" : "From durable intervention records in this workspace"}
          </p>
        </Link>

        {/* Card 4: WhatsApp Meta Status */}
        <Link
          href="/app/settings?tab=whatsapp"
          className="group relative overflow-hidden rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] p-4 shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition hover:border-[#38dc89]/50 hover:bg-[var(--color-hover-wash)]"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--color-muted-on-dark)]">
              {ar ? "حالة ربط واتساب" : "WhatsApp Status"}
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#25d366]/20 text-sm text-[#25d366]">
              📱
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${toneClass(waTone)}`}
            >
              {waStatusLabel}
            </span>
          </div>
          <p className="mt-2 text-xs text-[var(--color-muted-soft)]">
            {waItem?.detail === "wa_verified_not_live"
              ? (ar ? "ربط موثق؛ الإطلاق الحي غير مفعّل" : "Verified connection; live rollout disabled")
              : waItem?.detail === "wa_verified"
              ? (ar ? "موثق رسميًا عبر Meta Cloud API" : "Meta Cloud API Verified")
              : (ar ? "تسجيل الرقم طلب ربط وليس توثيقًا" : "Number entry is not verification")}
          </p>
        </Link>
      </section>

      {/* Subscription & Quota Hero Card */}
      <DashboardBillingCard key={readiness?.companyId ?? "none"} companyId={readiness?.companyId ?? null} />

      {/* 5 Decoupled System Pillars */}
      <DashboardDecoupledPillars readiness={readiness} locale={locale} />

      {/* Interactive 8-Milestone Onboarding Stepper / Checklist */}
      <section
        className="mb-6 rounded-3xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] p-5 shadow-[0_8px_24px_rgba(16,27,22,0.06)] sm:p-6"
        aria-label={copy.app.readinessTitle}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#38dc89]/20 text-sm">
                🎯
              </span>
              <h2 className="text-lg font-bold text-[var(--color-on-dark)]">{copy.app.readinessTitle}</h2>
            </div>
            <p className="mt-1 text-xs text-[var(--color-muted-on-dark)] sm:text-sm">{copy.app.readinessBody}</p>
          </div>
          <Button type="button" variant="secondary" busy={busy} onClick={() => void reloadReadiness()}>
            {copy.app.readinessRetry}
          </Button>
        </div>

        {loadFailed && !readiness ? (
          <div className="mt-4">
            <Notice tone="error">{copy.app.readinessLoadFailed}</Notice>
          </div>
        ) : null}
        {refreshFailed && readiness ? (
          <div className="mt-4">
            <Notice tone="warn">{copy.app.readinessStaleSnapshot}</Notice>
          </div>
        ) : null}

        {/* Next Action Banner */}
        {nextItem && nextItem.href && nextItem.action !== "none" ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#38dc89]/40 bg-[var(--color-hover-wash)] p-4 shadow-[0_8px_20px_rgba(56,220,137,0.15)]">
            <div className="min-w-0">
              <span className="inline-block rounded-full bg-[#38dc89]/25 px-2.5 py-0.5 text-xs font-bold text-[var(--color-success-fg)]">
                {copy.app.nextAction}
              </span>
              <h3 className="mt-1 text-sm font-bold text-[var(--color-on-dark)]">
                {itemLabel(nextItem.id, copy)}
              </h3>
              <p className="text-xs text-[var(--color-muted-on-dark)]">{detailLabel(nextItem.detail, copy)}</p>
            </div>
            <LinkButton href={nextItem.href} className="font-semibold">
              {actionLabel(nextItem.action, copy) ?? copy.app.continueSetup}
            </LinkButton>
          </div>
        ) : null}

        {/* Readiness Items List */}
        {readiness ? (
          <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {readiness.items.map((item) => {
              const label = actionLabel(item.action, copy);
              return (
                <li
                  key={item.id}
                  className="flex flex-col justify-between rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] p-4 transition hover:border-[color:var(--color-line)]"
                >
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-sm font-semibold text-[var(--color-on-dark)]">
                        {itemLabel(item.id, copy)}
                      </strong>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${toneClass(item.tone)}`}>
                        {copy.app.readinessTones[item.tone]}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[var(--color-muted-soft)]">
                      {detailLabel(item.detail, copy)}
                    </p>
                  </div>
                  {item.href && label ? (
                    <div className="mt-4 pt-3 border-t border-[color:var(--color-border-soft)]">
                      <Link
                        href={item.href}
                        className="inline-flex min-h-9 items-center justify-center rounded-full border border-[#38dc89]/30 bg-[#38dc89]/10 px-3 text-xs font-medium text-[var(--color-success-fg)] transition hover:bg-[#38dc89]/20"
                      >
                        {label} ↗
                      </Link>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : !loadFailed ? (
          <p className="mt-4 text-sm text-[var(--color-muted-soft)]">{copy.loading}</p>
        ) : null}
      </section>

      {/* Bottom Dual Grid: Recent Conversations Feed & Knowledge Health */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Conversations (2 Columns) */}
        <section
          className="lg:col-span-2 rounded-3xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] p-5 shadow-[0_8px_24px_rgba(16,27,22,0.06)] sm:p-6"
          aria-label={ar ? "محادثات من الصفحة المحمّلة" : "Conversations from the loaded page"}
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--color-border-soft)] pb-3">
            <div>
              <h2 className="text-base font-bold text-[var(--color-on-dark)] sm:text-lg">
                💬 {ar ? "أحدث محادثات العملاء" : "Recent Customer Conversations"}
              </h2>
              <p className="text-xs text-[var(--color-muted-on-dark)]">
                {ar
                  ? "محادثات واتساب الحية المرتبطة بشركتك"
                  : "Latest activity within the loaded page and your access scope"}
              </p>
            </div>
            <Link
              href="/app/conversations"
              className="inline-flex items-center text-xs font-semibold text-[var(--color-success-fg)] hover:underline"
            >
              {ar ? "عرض الكل في الصندوق ↗" : "View all in Inbox ↗"}
            </Link>
          </div>

          {!initialLeads.ok ? (
            <div className="py-6 text-center">
              <p className="text-sm text-[var(--color-muted-on-dark)]" role="status">
                {initialLeads.code === "NO_COMPANY"
                  ? (ar ? "اختر مساحة الشركة لعرض المحادثات المسموح لك بها." : "Select a company workspace to view conversations.")
                  : (ar ? "تعذّر تحميل بيانات المحادثات. لا توجد بيانات مؤكدة." : "Conversation data could not be loaded.")}
              </p>
            </div>
          ) : recentConversations.length === 0 ? (
            <div className="py-8 text-center">
              <span className="text-3xl">📭</span>
              <p className="mt-2 text-sm font-medium text-[var(--color-on-dark)]">
                {ar ? "لا توجد محادثات جارية حتى الآن" : "No active conversations yet"}
              </p>
              <p className="mt-1 text-xs text-[var(--color-muted-soft)]">
                {ar
                  ? "عندما يبدأ العملاء بالتواصل عبر رقم واتساب التجاري، ستظهر المحادثات هنا فوراً."
                  : "When customers reach out via your WhatsApp Business number, chats will appear here."}
              </p>
            </div>
          ) : (
            <ul className="grid gap-3">
              {recentConversations.map((conv) => {
                const isAutomated = !conv.assistantPaused && conv.automationAllowed;
                const timestamp = conv.lastTouchAt
                  ? Date.parse(conv.lastTouchAt)
                  : (conv.messages[conv.messages.length - 1]?.at ?? 0);
                const dateStr = timestamp
                  ? new Date(timestamp).toLocaleTimeString(ar ? "ar-OM" : "en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—";
                const lastSnippet =
                  conv.summary ||
                  conv.messages[conv.messages.length - 1]?.text ||
                  (ar ? "بدء المحادثة" : "Started conversation");
                return (
                  <li
                    key={conv.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] p-3.5 transition hover:border-[#38dc89]/40 hover:bg-[var(--color-hover-wash)]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#38dc89]/15 border border-[#38dc89]/30 text-sm font-bold text-[var(--color-success-fg)]">
                        {conv.customer ? conv.customer.charAt(0).toUpperCase() : "👤"}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-sm font-semibold text-[var(--color-on-dark)] truncate">
                            {conv.customer || (ar ? "عميل واتساب" : "WhatsApp Customer")}
                          </strong>
                          <span className="text-xs text-[var(--color-muted-soft)]" dir="ltr">
                            {conv.phone}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--color-muted-on-dark)] truncate max-w-[280px] sm:max-w-[420px]">
                          {lastSnippet}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-[var(--color-muted-soft)]">{dateStr}</span>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          isAutomated
                            ? "bg-[#38dc89]/15 text-[var(--color-success-fg)] border border-[#38dc89]/30"
                            : "bg-[#d9a467]/15 text-[var(--color-warn-fg)] border border-[#d9a467]/30"
                        }`}
                      >
                        {isAutomated ? (ar ? "أتمتة مسموحة" : "Automation permitted") : (ar ? "موظف" : "Staff")}
                      </span>
                      {conv.leadStage ? (
                        <span className="hidden sm:inline-flex rounded-full bg-[var(--color-hover-wash)] border border-[color:var(--color-border-soft)] px-2 py-0.5 text-xs text-[var(--color-muted-on-dark)]">
                          {stageLabels[conv.leadStage] ?? conv.leadStage}
                        </span>
                      ) : null}
                      <Link
                        href={`/app/conversations?c=${conv.id}`}
                        className="inline-flex h-8 items-center rounded-lg border border-[color:var(--color-border-soft)] px-2.5 text-xs font-medium text-[var(--color-on-dark)] hover:bg-[var(--color-hover-wash)]"
                      >
                        {ar ? "فتح" : "Open"}
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Knowledge & AI Readiness Card (1 Column) */}
        <section
          className="rounded-3xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] p-5 shadow-[0_8px_24px_rgba(16,27,22,0.06)] sm:p-6"
          aria-label={ar ? "جاهزية معرفة نورا" : "Noura Knowledge Readiness"}
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#38dc89]/20 text-sm">
              🧠
            </span>
            <h2 className="text-base font-bold text-[var(--color-on-dark)] sm:text-lg">
              {ar ? "معلومات ونبرة نورا" : "Noura Knowledge"}
            </h2>
          </div>
          <p className="mt-1.5 text-xs text-[var(--color-muted-on-dark)]">
            {ar
              ? "المعلومات المعتمدة التي تستخدمها نورا للرد على استفسارات عملاء الشركة."
              : "Approved knowledge used by Noura to respond to customer inquiries."}
          </p>

          <div className="mt-4 rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] p-4 text-xs">
            <p className="font-semibold text-[var(--color-on-dark)]">
              {ar ? "💡 نصيحة لتحسين دقة الردود:" : "💡 Tip for accuracy:"}
            </p>
            <p className="mt-1 leading-5 text-[var(--color-muted-on-dark)]">
              {ar
                ? "تأكد من إضافة سياسة الاسترجاع، أوقات العمل، وقائمة الأسعار لتتمكن نورا من خدمة العملاء دون تحويل متكرر للموظف."
                : "Ensure you add return policies, business hours, and pricing lists so Noura can resolve questions directly."}
            </p>
          </div>

          <div className="mt-5 grid gap-2">
            <LinkButton href="/app/knowledge" variant="secondary" className="w-full text-xs">
              📂 {ar ? "إدارة مصادر المعرفة والسياسات" : "Manage Knowledge Base"}
            </LinkButton>
            <LinkButton href="/app/test" variant="primary" className="w-full text-xs font-semibold">
              🧪 {ar ? "اختبار ردود نورا في المحاكاة ↗" : "Test Noura Responses ↗"}
            </LinkButton>
          </div>
        </section>
      </div>

      {readiness?.role === "staff" ? (
        <p className="mt-6 text-xs text-[var(--color-muted-soft)]">
          {copy.app.readinessDetails.review_owner_only}
        </p>
      ) : null}
    </WorkspaceShell>
  );
}
