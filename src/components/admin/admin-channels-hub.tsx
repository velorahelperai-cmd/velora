"use client";

import { useState } from "react";
import Link from "next/link";
import { IconAlert, IconHeadphones, IconLayers, IconPulse } from "./admin-icons";

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
  const [filterType, setFilterType] = useState<"all" | "whatsapp" | "instagram">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "attention">("all");

  const filteredChannels = channels.filter((c) => {
    if (filterType !== "all" && c.channelType !== filterType) return false;
    if (filterStatus === "active" && c.status !== "verified" && c.status !== "bound") return false;
    if (filterStatus === "attention" && c.status !== "needs_external_action" && c.status !== "error") return false;
    return true;
  });

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--service-line)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-[var(--service-accent)]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--service-accent)]">
              Module 04 · Omnichannel Infrastructure
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-black text-[var(--service-ink)] tracking-tight">
            مركز القنوات والربط المركزي (Channels Hub)
          </h1>
          <p className="mt-1 text-sm text-[var(--service-muted)]">
            متابعة وإدارة تكاملات WhatsApp Cloud API وInstagram Graph API والتعايش المزدوج (Coexistence).
          </p>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 shadow-sm">
          <div className="text-xs font-semibold text-[var(--service-muted)]">إجمالي القنوات</div>
          <div className="mt-2 text-2xl font-black text-[var(--service-ink)]">{stats.totalChannels}</div>
        </div>

        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 shadow-sm">
          <div className="text-xs font-semibold text-[var(--service-muted)]">قنوات WhatsApp</div>
          <div className="mt-2 text-2xl font-black text-[var(--service-accent)]">{stats.totalWhatsapp}</div>
        </div>

        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 shadow-sm">
          <div className="text-xs font-semibold text-[var(--service-muted)]">قنوات Instagram</div>
          <div className="mt-2 text-2xl font-black text-purple-700">{stats.totalInstagram}</div>
        </div>

        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 shadow-sm">
          <div className="text-xs font-semibold text-[var(--service-muted)]">نشطة ومتصلة</div>
          <div className="mt-2 text-2xl font-black text-[var(--service-success)]">{stats.activeConnected}</div>
        </div>

        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 shadow-sm">
          <div className="text-xs font-semibold text-[var(--service-muted)]">تتطلب إجراء</div>
          <div className="mt-2 text-2xl font-black text-amber-700">{stats.needsAction}</div>
        </div>

        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 shadow-sm">
          <div className="text-xs font-semibold text-[var(--service-muted)]">التعايش المزدوج</div>
          <div className="mt-2 text-2xl font-black text-sky-700">{stats.coexistenceCount}</div>
        </div>
      </div>

      {/* Filters & Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilterType("all")}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
              filterType === "all"
                ? "bg-[var(--service-accent)] text-white shadow-sm"
                : "border border-[var(--service-line)] bg-[var(--service-canvas)] text-[var(--service-muted)] hover:text-[var(--service-ink)]"
            }`}
          >
            جميع القنوات ({channels.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType("whatsapp")}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
              filterType === "whatsapp"
                ? "bg-[var(--service-accent)] text-white shadow-sm"
                : "border border-[var(--service-line)] bg-[var(--service-canvas)] text-[var(--service-muted)] hover:text-[var(--service-ink)]"
            }`}
          >
            WhatsApp ({stats.totalWhatsapp})
          </button>
          <button
            type="button"
            onClick={() => setFilterType("instagram")}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
              filterType === "instagram"
                ? "bg-[var(--service-accent)] text-white shadow-sm"
                : "border border-[var(--service-line)] bg-[var(--service-canvas)] text-[var(--service-muted)] hover:text-[var(--service-ink)]"
            }`}
          >
            Instagram ({stats.totalInstagram})
          </button>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as "all" | "active" | "attention")}
            className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-1.5 text-xs font-medium text-[var(--service-ink)] outline-none"
          >
            <option value="all">كل الحالات التشغيلية</option>
            <option value="active">القنوات النشطة فقط</option>
            <option value="attention">تتطلب إجراء فقط</option>
          </select>
        </div>
      </div>

      {/* Channels Table */}
      {filteredChannels.length === 0 ? (
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-12 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--service-subtle)] text-[var(--service-muted)]">
            <IconLayers className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-base font-bold text-[var(--service-ink)]">
            لا توجد قنوات مربوطة حالياً
          </h3>
          <p className="mt-1 text-sm text-[var(--service-muted)]">
            لم يتم العثور على أي تكاملات قنوات مطابقة للشروط المحددة.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b border-[var(--service-line)] bg-[var(--service-subtle)] text-xs font-bold text-[var(--service-muted)]">
                <tr>
                  <th className="px-5 py-3.5">المنشأة</th>
                  <th className="px-5 py-3.5">نوع القناة</th>
                  <th className="px-5 py-3.5">المعرّف / الحساب</th>
                  <th className="px-5 py-3.5">وضع التعايش</th>
                  <th className="px-5 py-3.5">الحالة التشغيلية</th>
                  <th className="px-5 py-3.5 text-left">إجراءات</th>
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
                        {chn.companyName}
                      </Link>
                      <div className="font-mono text-[11px] text-[var(--service-muted)]">
                        {chn.companyId.slice(0, 14)}...
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      {chn.channelType === "whatsapp" ? (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 border border-emerald-200">
                          <IconHeadphones className="h-3.5 w-3.5 text-emerald-600" />
                          WhatsApp
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-purple-50 px-2.5 py-1 text-xs font-bold text-purple-800 border border-purple-200">
                          <IconPulse className="h-3.5 w-3.5 text-purple-600" />
                          Instagram
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      <span className="font-mono text-xs font-semibold text-[var(--service-ink)]" dir="ltr">
                        {chn.identifier}
                      </span>
                      {chn.wabaId && (
                        <div className="font-mono text-[10px] text-[var(--service-muted)]" dir="ltr">
                          WABA: {chn.wabaId}
                        </div>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      {chn.coexistence ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 border border-sky-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-sky-600" />
                          Coexistence نشط
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--service-muted)]">عادي (API فقط)</span>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      {chn.status === "verified" || chn.status === "bound" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--service-success)]/10 px-2.5 py-0.5 text-xs font-bold text-[var(--service-success)] border border-[var(--service-success)]/20">
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          متصل ونشط
                        </span>
                      ) : chn.status === "needs_external_action" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-800 border border-amber-500/20">
                          <IconAlert className="h-3 w-3 text-amber-600" />
                          يتطلب إجراء خارجي
                        </span>
                      ) : chn.status === "error" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-bold text-red-700 border border-red-500/20">
                          خطأ في الربط
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
                          طلب مسجل
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-4 text-left">
                      <Link
                        href={`/admin/companies/${chn.companyId}#channels`}
                        className="rounded-lg border border-[var(--service-line)] bg-[var(--service-surface)] px-3 py-1.5 text-xs font-bold text-[var(--service-ink)] hover:bg-[var(--service-subtle)] transition"
                      >
                        إدارة القناة ←
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
