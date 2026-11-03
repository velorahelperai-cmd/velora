"use client";

import { useState } from "react";
import Link from "next/link";
import { useDemo } from "@/lib/demo-state";
import styles from "./admin-channels-hub.module.css";
import { IconAlert, IconCheckCircle, IconHeadphones, IconInstagram, IconLayers, IconPulse, IconWhatsApp } from "./admin-icons";
import { AnimatedBeamConnection } from "@/components/app/magic-ui";

export interface AdminChannelItem {
  id: string;
  companyId: string;
  companyName: string;
  channelType: "whatsapp" | "instagram";
  status: "verified" | "bound" | "request_saved" | "needs_external_action" | "error" | "disconnected";
  identifier: string; // phone number or @handle
  wabaId?: string | null;
  coexistence?: boolean;
  lastActiveAt?: string | null;
}

export interface AdminChannelsHubStats {
  totalChannels: number;
  totalWhatsapp: number;
  totalInstagram: number;
  activeConnected: number;
  needsAction: number;
  coexistenceCount: number;
}

export interface AdminChannelsHubProps {
  channels: AdminChannelItem[];
  stats: AdminChannelsHubStats;
}

export function AdminChannelsHub({ channels, stats }: AdminChannelsHubProps) {
  const { locale } = useDemo();
  const ar = locale === "ar";
  const [filterType, setFilterType] = useState<"all" | "whatsapp" | "instagram">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "attention">("all");

  const filteredChannels = channels.filter((c) => {
    if (filterType !== "all" && c.channelType !== filterType) return false;
    if (filterStatus === "active" && c.status !== "verified" && c.status !== "bound") return false;
    if (filterStatus === "attention" && c.status !== "needs_external_action" && c.status !== "error") return false;
    return true;
  });

  const metrics = [
    { label: ar ? "القنوات المحمّلة" : "Loaded channels", value: stats.totalChannels, icon: IconLayers },
    { label: ar ? "واتساب المحمّل" : "Loaded WhatsApp", value: stats.totalWhatsapp, icon: IconWhatsApp },
    { label: ar ? "إنستجرام المحمّل" : "Loaded Instagram", value: stats.totalInstagram, icon: IconInstagram },
    { label: ar ? "موثّقة أو مرتبطة بالسجل" : "Verified or bound records", value: stats.activeConnected, icon: IconCheckCircle },
    { label: ar ? "تتطلب إجراء" : "Need action", value: stats.needsAction, icon: IconAlert },
    { label: ar ? "طلبات الاحتفاظ بالهاتف" : "Keep-on-phone requests", value: stats.coexistenceCount, icon: IconHeadphones },
  ];

  return (
    <div className={`space-y-6 ${styles.hub}`} dir={ar ? "rtl" : "ltr"}>
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--service-line)] pb-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--service-ink)]">
            {ar ? "مركز القنوات" : "Channels"}
          </h1>
          <p className="mt-1 text-sm text-[var(--service-muted)]">
            {ar ? "سجلات قنوات واتساب وإنستجرام للمنشآت." : "Business WhatsApp and Instagram channel records."}
          </p>
        </div>
      </div>

      <AnimatedBeamConnection
        fromLabel={ar ? "قنوات Meta" : "Meta Channels"}
        fromIcon={<IconWhatsApp aria-hidden="true" className="w-5 h-5 text-[#25D366]" />}
        centerLabel={ar ? "المعالج الذكي" : "AI Processing Core"}
        toLabel={ar ? "رسائل المستأجرين" : "Tenancy Streams"}
        toIcon={<IconLayers aria-hidden="true" className="w-5 h-5 text-[var(--service-accent)]" />}
        statusLabel={ar ? "مسار الربط والمعالجة الفعلي" : "Routing & event flow"}
      />

      <p className="rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 text-sm text-[var(--service-muted)]" role="status">
        {ar ? "الأرقام للقنوات المحمّلة فقط؛ قد تكون القائمة غير مكتملة إذا تعذرت قراءة أحد المصادر. حالة السجل لا تثبت جاهزية الإرسال." : "Counts cover loaded records only; the list may be incomplete if a source could not be read. A recorded status does not prove sending readiness."}
      </p>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 2xl:grid-cols-4">
        {metrics.map(({label,value,icon:Icon}) => (
          <div
            key={label}
            className={styles.metricCard}
            onPointerMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              e.currentTarget.style.setProperty("--spot-x", `${e.clientX - rect.left}px`);
              e.currentTarget.style.setProperty("--spot-y", `${e.clientY - rect.top}px`);
            }}
          >
            <div className={styles.metricHeader}>
              <span className={styles.metricLabel}>{label}</span>
              <span className={styles.metricIcon}><Icon aria-hidden="true" /></span>
            </div>
            <div className={styles.metricValue}><bdi>{value}</bdi></div>
          </div>
        ))}
      </div>

      {/* Filters & Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 ">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilterType("all")}
            aria-pressed={filterType === "all"}
            className={`rounded-xl px-3.5 py-1.5 text-sm font-bold transition ${
              filterType === "all"
                ? "bg-[var(--service-accent)] text-white "
                : "border border-[var(--service-line)] bg-[var(--service-canvas)] text-[var(--service-muted)] hover:text-[var(--service-ink)]"
            }`}
          >
            {ar ? "كل القنوات" : "All channels"} ({channels.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType("whatsapp")}
            aria-pressed={filterType === "whatsapp"}
            className={`rounded-xl px-3.5 py-1.5 text-sm font-bold transition ${
              filterType === "whatsapp"
                ? "bg-[var(--service-accent)] text-white "
                : "border border-[var(--service-line)] bg-[var(--service-canvas)] text-[var(--service-muted)] hover:text-[var(--service-ink)]"
            }`}
          >
            WhatsApp ({stats.totalWhatsapp})
          </button>
          <button
            type="button"
            onClick={() => setFilterType("instagram")}
            aria-pressed={filterType === "instagram"}
            className={`rounded-xl px-3.5 py-1.5 text-sm font-bold transition ${
              filterType === "instagram"
                ? "bg-[var(--service-accent)] text-white "
                : "border border-[var(--service-line)] bg-[var(--service-canvas)] text-[var(--service-muted)] hover:text-[var(--service-ink)]"
            }`}
          >
            Instagram ({stats.totalInstagram})
          </button>
        </div>

        <div className="flex items-center gap-2">
          <select
            aria-label={ar ? "تصفية حالة القناة" : "Filter channel status"}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as "all" | "active" | "attention")}
            className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-1.5 text-sm font-medium text-[var(--service-ink)] outline-none"
          >
            <option value="all">{ar ? "كل الحالات" : "All statuses"}</option>
            <option value="active">{ar ? "موثّقة أو مرتبطة بالسجل" : "Verified or bound records"}</option>
            <option value="attention">{ar ? "تتطلب إجراء" : "Need action"}</option>
          </select>
        </div>
      </div>

      {/* Channels Table */}
      {filteredChannels.length === 0 ? (
        <div className="rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] p-12 text-center ">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--service-subtle)] text-[var(--service-muted)]">
            <IconLayers className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-base font-bold text-[var(--service-ink)]">
            {ar ? "لا توجد قنوات في النتائج المحمّلة" : "No channels in the loaded results"}
          </h3>
          <p className="mt-1 text-sm text-[var(--service-muted)]">
            {ar ? "لا توجد نتائج مطابقة للفلاتر الحالية. قد تكون القائمة غير مكتملة." : "No loaded results match the current filters. The list may be incomplete."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)]  overflow-hidden">
          <div className="overflow-x-auto" role="region" aria-label={ar ? "جدول القنوات" : "Channels table"} tabIndex={0}>
            <table className="w-full text-start text-sm">
              <thead className="border-b border-[var(--service-line)] bg-[var(--service-subtle)] text-sm font-bold text-[var(--service-muted)]">
                <tr>
                  <th scope="col" className="px-5 py-3.5">{ar ? "المنشأة" : "Business"}</th>
                  <th scope="col" className="px-5 py-3.5">{ar ? "نوع القناة" : "Channel"}</th>
                  <th scope="col" className="px-5 py-3.5">{ar ? "المعرّف / الحساب" : "Identifier / account"}</th>
                  <th scope="col" className="px-5 py-3.5">{ar ? "طلب الاحتفاظ بالهاتف" : "Keep-on-phone request"}</th>
                  <th scope="col" className="px-5 py-3.5">{ar ? "حالة السجل" : "Recorded status"}</th>
                  <th scope="col" className="px-5 py-3.5 text-end">{ar ? "إجراءات" : "Actions"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--service-line)]">
                {filteredChannels.map((chn) => (
                  <tr key={chn.id} className="hover:bg-[var(--service-canvas)]/50 transition">
                    <td className="px-5 py-4">
                      <Link
                        href={`/admin/companies/${chn.companyId}`}
                        className="font-bold text-[var(--service-ink)] hover:text-[var(--service-accent)] transition"
                      >
                        <bdi>{chn.companyName}</bdi>
                      </Link>
                      <div className="font-mono text-[13px] text-[var(--service-muted)]">
                        {chn.companyId.slice(0, 14)}...
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      {chn.channelType === "whatsapp" ? (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-sm font-bold text-emerald-800 border border-emerald-200">
                          <IconHeadphones className="h-3.5 w-3.5 text-emerald-600" />
                          WhatsApp
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-purple-50 px-2.5 py-1 text-sm font-bold text-purple-800 border border-purple-200">
                          <IconPulse className="h-3.5 w-3.5 text-purple-600" />
                          Instagram
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      <span className="font-mono text-sm font-semibold text-[var(--service-ink)]" dir="ltr">
                        {chn.identifier}
                      </span>
                      {chn.wabaId && (
                        <div className="text-[13px] text-[var(--service-muted)]">
                          {ar ? "معرّف هاتف المزود" : "Provider phone ID"}: <bdi dir="ltr">{chn.wabaId}</bdi>
                        </div>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      {chn.coexistence ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[13px] font-semibold text-sky-700 border border-sky-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-sky-600" />
                          {ar ? "طلب الاحتفاظ بالهاتف" : "Keep on phone requested"}
                        </span>
                      ) : (
                        <span className="text-sm text-[var(--service-muted)]">{chn.channelType === "instagram" ? "—" : (ar ? "غير مثبت في البيانات المحمّلة" : "Not established in loaded data")}</span>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      {chn.status === "verified" || chn.status === "bound" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--service-success)]/10 px-2.5 py-0.5 text-sm font-bold text-[var(--service-success)] border border-[var(--service-success)]/20">
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          {chn.status === "verified" ? (ar ? "موثّق في السجل" : "Verified in record") : (ar ? "مرتبط في السجل" : "Bound in record")}
                        </span>
                      ) : chn.status === "needs_external_action" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-sm font-bold text-amber-800 border border-amber-500/20">
                          <IconAlert className="h-3 w-3 text-amber-600" />
                          {ar ? "يتطلب إجراء خارجي" : "External action required"}
                        </span>
                      ) : chn.status === "error" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-0.5 text-sm font-bold text-red-700 border border-red-500/20">
                          {ar ? "خطأ في الربط" : "Connection error"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-sm font-semibold text-gray-600">
                          {chn.status === "disconnected" ? (ar ? "غير متصل" : "Disconnected") : (ar ? "طلب مسجل" : "Request saved")}
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-4 text-end">
                      <Link
                        href={`/admin/companies/${chn.companyId}#channels`}
                        className="rounded-lg border border-[var(--service-line)] bg-[var(--service-surface)] px-3 py-1.5 text-sm font-bold text-[var(--service-ink)] hover:bg-[var(--service-subtle)] transition"
                      >
                        {ar ? "إدارة القناة" : "Manage channel"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
