"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";
import { useDemo } from "@/lib/demo-state";
import { readDashboardBilling } from "@/lib/customer/dashboard-billing-actions";
import type { DashboardBillingLoad } from "@/lib/customer/dashboard-billing-model";
import { DashboardLeads } from "./dashboard-leads";
import type { WhatsappInboxLoad } from "@/lib/whatsapp/inbox";
import { fill } from "@/lib/app-copy";
import {
  getCustomerReadiness,
} from "@/lib/tenancy/actions";
import type {
  CustomerReadinessItem,
  CustomerReadinessItemId,
  CustomerReadinessSnapshot,
  ReadinessDetail,
  ReadinessTone,
} from "@/lib/tenancy/customer-readiness";
import { WorkspaceShell } from "@/components/app/workspace-shell";
import { Button, Card, LinkButton, Notice, useAppCopy } from "@/components/app/ui";

function DashboardBillingCard({ companyId }: { companyId: string | null }) {
  const { locale } = useDemo();
  const ar = locale === "ar";
  const [billing, setBilling] = useState<DashboardBillingLoad | null>(null);
  const request = useRef(0);
  const text = ar ? {
    title: "الاشتراك والاستهلاك", body: "الرسائل الآلية المقبولة والسعة المحجوزة من سجلات النشاط.",
    account: "إدارة الاشتراك", retry: "تحديث", unavailable: "تعذّر تحميل الاشتراك والاستهلاك. لا تتوفر أرقام مؤكدة الآن.",
    forbidden: "بيانات الاشتراك متاحة لمالك النشاط بعد اختيار مساحة العمل.", empty: "لا يوجد اشتراك مسجّل لهذا النشاط.",
    sent: "رسائل آلية مقبولة", held: "سعة محجوزة", remaining: "رسائل متاحة", capMissing: "حد الرسائل غير متوفر", period: "بداية شهر الاستخدام", status: "حالة الاشتراك المسجّلة", paidThrough: "مدفوع حتى", loading: "جارٍ تحميل البيانات…",
  } : {
    title: "Subscription and usage", body: "Accepted automated messages and reserved capacity from company records.",
    account: "Manage subscription", retry: "Refresh", unavailable: "Subscription and usage could not be loaded. Confirmed figures are unavailable.",
    forbidden: "Subscription data requires the company owner and a selected workspace.", empty: "No subscription is recorded for this company.",
    sent: "accepted automated messages", held: "reserved capacity", remaining: "messages available", capMissing: "Message limit unavailable", period: "Usage month starts", status: "Recorded subscription status", paidThrough: "Paid through", loading: "Loading data…",
  };

  useEffect(() => {
    const generation = ++request.current;
    startTransition(async () => {
      try {
        const result = await readDashboardBilling();
        if (generation === request.current) setBilling(result);
      } catch {
        if (generation === request.current) setBilling({ status: "unavailable" });
      }
    });
    return () => { request.current += 1; };
  }, []);

  function refresh() {
    const generation = ++request.current;
    setBilling(null);
    startTransition(async () => {
      try {
        const result = await readDashboardBilling();
        if (generation === request.current) setBilling(result);
      } catch {
        if (generation === request.current) setBilling({ status: "unavailable" });
      }
    });
  }

  const snapshot = billing?.status === "ready" && billing.companyId === companyId ? billing : null;
  const statusLabels: Record<string, string> = ar
    ? { active: "نشط", pending: "قيد الانتظار", expired: "منتهي", suspended: "موقوف", cancelled: "ملغي", canceled: "ملغي", unpaid: "غير مدفوع", inactive: "غير نشط" }
    : { active: "Active", pending: "Pending", expired: "Expired", suspended: "Suspended", cancelled: "Cancelled", canceled: "Cancelled", unpaid: "Unpaid", inactive: "Inactive" };
  const formatDate = (date: string) => new Intl.DateTimeFormat(ar ? "ar-OM" : "en-GB", { timeZone: "UTC" }).format(new Date(date));

  return (
    <section className="mb-5 relative overflow-hidden rounded-3xl border border-[#38dc89]/30 bg-gradient-to-r from-[#12281e] via-[#0d1c15] to-[#08120e] p-5 shadow-[0_12px_36px_rgba(0,0,0,0.4)] sm:p-6" aria-label={text.title}>
      <div className="pointer-events-none absolute end-0 top-0 -me-8 -mt-8 h-40 w-40 rounded-full bg-[#38dc89]/10 blur-3xl" />
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#38dc89]/20 text-sm">⚡</span>
            <h2 className="text-base font-bold text-[#f7fbf8] sm:text-lg">{text.title}</h2>
          </div>
          <p className="mt-1.5 text-xs text-[#b7c6b9] sm:text-sm">{text.body}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" busy={billing === null} onClick={refresh}>{text.retry}</Button>
          <Link href="/app/subscription" className="inline-flex min-h-10 items-center rounded-full border border-[#38dc89]/50 bg-[#38dc89]/15 px-4 text-xs font-semibold text-[#9af0c3] transition hover:bg-[#38dc89]/25">{text.account}</Link>
        </div>
      </div>
      {snapshot ? (
        <div className="relative mt-5">
          <p className="mb-3 text-xs text-[#b7c6b9]">{text.status}: {statusLabels[snapshot.subscriptionStatus] ?? snapshot.subscriptionStatus}{snapshot.paidThrough ? ` · ${text.paidThrough}: ${formatDate(snapshot.paidThrough)}` : ""}</p>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
            <span className="text-[#f7fbf8]"><strong>{snapshot.sent.toLocaleString(locale)}</strong>{snapshot.cap !== null ? ` / ${snapshot.cap.toLocaleString(locale)}` : ""} {text.sent}</span>
            <span className="text-[#9af0c3]">{snapshot.remaining === null ? text.capMissing : `${snapshot.remaining.toLocaleString(locale)} ${text.remaining}`}</span>
          </div>
          {snapshot.usedPercent !== null ? (
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10 p-0.5" role="progressbar" aria-label={text.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={snapshot.usedPercent}>
              <div className="h-full rounded-full bg-gradient-to-r from-[#2ebd73] to-[#38dc89] shadow-[0_0_12px_rgba(56,220,137,0.5)] transition-all duration-700" style={{ width: `${snapshot.usedPercent}%` }} />
            </div>
          ) : null}
          <p className="mt-2 text-xs text-[#b7c6b9]">{snapshot.held.toLocaleString(locale)} {text.held} · {text.period}: {formatDate(snapshot.monthStart)} (UTC)</p>
        </div>
      ) : (
        <p className="relative mt-4 text-sm text-[#b7c6b9]" role="status">{billing === null ? text.loading : billing.status === "forbidden" ? text.forbidden : billing.status === "empty" && billing.companyId === companyId ? text.empty : text.unavailable}</p>
      )}
    </section>
  );
}

function toneClass(tone: ReadinessTone): string {
  if (tone === "complete") return "bg-[#38dc89]/15 text-[var(--color-success-fg)]";
  if (tone === "pending") return "bg-[#d9a467]/15 text-[var(--color-warn-fg)]";
  if (tone === "blocked" || tone === "load_failed") return "bg-[#e07a7a]/15 text-[var(--color-danger-fg)]";
  if (tone === "not_configured") return "bg-[var(--color-hover-wash)] text-[var(--color-muted-soft)]";
  return "bg-[var(--color-hover-wash)] text-[var(--color-on-dark)]";
}

function itemLabel(
  id: CustomerReadinessItemId,
  copy: ReturnType<typeof useAppCopy>,
): string {
  return copy.app.readinessItems[id];
}

function detailLabel(
  detail: ReadinessDetail,
  copy: ReturnType<typeof useAppCopy>,
): string {
  return copy.app.readinessDetails[detail];
}

function actionLabel(
  action: CustomerReadinessItem["action"],
  copy: ReturnType<typeof useAppCopy>,
): string | null {
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
  initialLeads: WhatsappInboxLoad;
  initialReadiness?: CustomerReadinessSnapshot | null;
  readinessLoadFailed?: boolean;
}) {
  const copy = useAppCopy();
  const router = useRouter();

  const [readiness, setReadiness] = useState<CustomerReadinessSnapshot | null>(initialReadiness);
  const [loadFailed, setLoadFailed] = useState(readinessLoadFailed);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const genRef = useRef(0);
  // Follow-up / needs-info must not be driven by local demo conversations.

  // Adopt newer SSR props after router.refresh; invalidate in-flight client reloads.
  const [trackedProps, setTrackedProps] = useState(() => ({
    readiness: initialReadiness,
    failed: readinessLoadFailed,
  }));
  if (
    trackedProps.readiness !== initialReadiness
    || trackedProps.failed !== readinessLoadFailed
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

  return (
    <WorkspaceShell title={copy.app.dashboardTitle}>
      <p className="mb-5 text-[var(--color-muted-on-dark)]">{fill(copy.app.hello, { name: helloName })}</p>

      <DashboardBillingCard key={readiness?.companyId ?? "none"} companyId={readiness?.companyId ?? null} />

      <section className="mb-4 rounded-3xl border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] p-4 sm:p-5" aria-label={copy.app.readinessTitle}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">{copy.app.readinessTitle}</h2>
            <p className="mt-1 text-sm text-[var(--color-muted-on-dark)]">{copy.app.readinessBody}</p>
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

        {nextItem && nextItem.href && nextItem.action !== "none" ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#38dc89]/35 bg-[#38dc89]/10 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--color-success-fg)]">{copy.app.nextAction}</p>
              <p className="text-xs text-[var(--color-muted-on-dark)]">
                {itemLabel(nextItem.id, copy)} — {detailLabel(nextItem.detail, copy)}
              </p>
            </div>
            <LinkButton href={nextItem.href}>
              {actionLabel(nextItem.action, copy) ?? copy.app.continueSetup}
            </LinkButton>
          </div>
        ) : null}

        {readiness ? (
          <ul className="mt-4 grid gap-2">
            {readiness.items.map((item) => {
              const label = actionLabel(item.action, copy);
              return (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[color:var(--color-border-soft)] px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm">{itemLabel(item.id, copy)}</strong>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${toneClass(item.tone)}`}>
                        {copy.app.readinessTones[item.tone]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--color-muted-soft)]">{detailLabel(item.detail, copy)}</p>
                  </div>
                  {item.href && label ? (
                    <Link
                      href={item.href}
                      className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-[color:var(--color-border-soft)] px-3 text-xs"
                    >
                      {label}
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : !loadFailed ? (
          <p className="mt-4 text-sm text-[var(--color-muted-soft)]">{copy.loading}</p>
        ) : null}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <DashboardLeads snapshot={initialLeads}/>
        <Card title={copy.app.needsInfo}>
          <Notice tone="warn">{copy.app.needsInfoUnavailable}</Notice>
          <div className="mt-3">
            <LinkButton href="/app/knowledge" variant="secondary">{copy.app.nav.knowledge}</LinkButton>
          </div>
        </Card>
      </div>

      {readiness?.role === "staff" ? (
        <p className="mt-4 text-xs text-[var(--color-muted-soft)]">{copy.app.readinessDetails.review_owner_only}</p>
      ) : null}
    </WorkspaceShell>
  );
}
