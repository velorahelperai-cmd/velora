"use client";
import { AccessibleDialog } from "@/components/app/accessible-dialog";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDemo } from "@/lib/demo-state";
import type {
  AdminSupportOverviewData,
  AdminAccountSearchItem,
  SupportTicketItem,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from "@/lib/tenancy/support-types";
import {
  adminAddTicketNote,
  adminCreateSupportTicket,
  adminLookupCustomerByCodeOrEmail,
  adminUpdateTicketStatus,
} from "@/lib/tenancy/support-actions";
import {
  IconAlert,
  IconBuilding,
  IconCheckCircle,
  IconClock,
  IconPlus,
  IconSearch,
  IconShield,
  IconSparkles,
  IconX,
} from "./admin-icons";

export interface AdminSupportReviewsProps {
  data: AdminSupportOverviewData;
  filters?: { status?: string; search?: string };
}

const PRIORITY_BADGES: Record<TicketPriority, { ar: string; en: string; style: string }> = {
  urgent: { ar: "حرجة للغاية", en: "Urgent", style: "bg-red-100 text-red-800 border-red-200" },
  high: { ar: "عالية", en: "High", style: "bg-amber-100 text-amber-800 border-amber-200" },
  medium: { ar: "متوسطة", en: "Medium", style: "bg-blue-50 text-blue-800 border-blue-200" },
  low: { ar: "منخفضة", en: "Low", style: "bg-stone-100 text-stone-700 border-stone-200" },
};

const STATUS_BADGES: Record<TicketStatus, { ar: string; en: string; style: string }> = {
  open: { ar: "مفتوحة", en: "Open", style: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  in_progress: { ar: "قيد المتابعة", en: "In Progress", style: "bg-blue-100 text-blue-800 border-blue-200" },
  waiting_customer: { ar: "بانتظار العميل", en: "Waiting Customer", style: "bg-amber-50 text-amber-800 border-amber-200" },
  resolved: { ar: "تم الحل", en: "Resolved", style: "bg-teal-50 text-teal-800 border-teal-200" },
  closed: { ar: "مغلقة", en: "Closed", style: "bg-stone-100 text-stone-600 border-stone-200" },
};

export function AdminSupportReviews({ data, filters }: AdminSupportReviewsProps) {
  const { locale } = useDemo();
  const ar = locale === "ar";
  const router = useRouter();

  // Tab state between Tickets & Onboarding Reviews
  const [activeTab, setActiveTab] = useState<"tickets" | "reviews">("tickets");

  // Account search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AdminAccountSearchItem[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, startSearchTransition] = useTransition();

  // Tickets filter state
  const [ticketStatusFilter, setTicketStatusFilter] = useState<string>(filters?.status ?? "all");
  const [ticketSearchQuery, setTicketSearchQuery] = useState<string>(filters?.search ?? "");
  const [ticketActionError, setTicketActionError] = useState<string | null>(null);
  const operations = useRef(new Map<string, string>());
  function operation(kind: string, payload: unknown) {
    const key = kind + ":" + JSON.stringify(payload);
    let id = operations.current.get(key);
    if (!id) { id = crypto.randomUUID(); operations.current.set(key, id); }
    return { key, id };
  }
  function ticketsHref(offset: number, status = ticketStatusFilter) {
    const params = new URLSearchParams({ offset: String(offset), limit: String(data.pagination?.limit ?? 50) });
    if (status !== "all") params.set("status", status);
    if (ticketSearchQuery.trim()) params.set("search", ticketSearchQuery.trim());
    return "/admin/support?" + params.toString();
  }

  // Create ticket dialog state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTicketForm, setNewTicketForm] = useState<{
    companyId: string;
    branchId: string;
    title: string;
    description: string;
    priority: TicketPriority;
    category: TicketCategory;
    initialNote: string;
  }>({
    companyId: "",
    branchId: "",
    title: "",
    description: "",
    priority: "medium",
    category: "technical",
    initialNote: "",
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmitting, startSubmitTransition] = useTransition();

  // Add note dialog state
  const [noteTicket, setNoteTicket] = useState<SupportTicketItem | null>(null);
  const [noteContent, setNoteContent] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [isNoteSubmitting, startNoteTransition] = useTransition();

  const handleAccountSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      setSearchError(null);
      return;
    }
    setSearchError(null);
    startSearchTransition(async () => {
      const res = await adminLookupCustomerByCodeOrEmail(q);
      if (res.ok) {
        setSearchResults(res.rows);
      } else {
        setSearchError(res.message ?? "Search failed");
      }
    });
  };

  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setCreateError(null);
    const input = { ...newTicketForm, branchId: newTicketForm.branchId || null, initialNote: newTicketForm.initialNote || undefined };
    const op = operation("create", input);
    startSubmitTransition(async () => {
      try {
        const res = await adminCreateSupportTicket({ ...input, operationId: op.id });
        if (!res.ok) { setCreateError(res.message ?? "SUPPORT_CREATE_UNAVAILABLE"); return; }
        operations.current.delete(op.key);
        setShowCreateModal(false);
        setNewTicketForm({ companyId: "", branchId: "", title: "", description: "", priority: "medium", category: "technical", initialNote: "" });
        router.refresh();
      } catch { setCreateError("UNKNOWN: " + (ar ? "تعذر التحقق من الحفظ؛ لم تُعد المحاولة تلقائيًا" : "Save outcome unverified; no automatic retry")); }
    });
  };
  const handleStatusChange = (ticketId: string, newStatus: TicketStatus) => {
    if (isSubmitting) return;
    setTicketActionError(null);
    const expectedRevision = data.tickets.find(ticket => ticket.id === ticketId)?.revision;
    const input = { ticketId, status: newStatus, expectedRevision };
    const op = operation("status", input);
    startSubmitTransition(async () => {
      try {
        const res = await adminUpdateTicketStatus({ ...input, operationId: op.id });
        if (!res.ok) { setTicketActionError(res.message ?? "SUPPORT_STATUS_UNAVAILABLE"); return; }
        operations.current.delete(op.key);
        router.refresh();
      } catch { setTicketActionError("UNKNOWN: " + (ar ? "تعذر التحقق من تغيير الحالة" : "Status change outcome unverified")); }
    });
  };
  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTicket || !noteContent.trim() || isNoteSubmitting) return;
    setNoteError(null);
    const input = { ticketId: noteTicket.id, content: noteContent.trim(), noteType: "internal_note" as const, expectedRevision: noteTicket.revision };
    const op = operation("note", input);
    startNoteTransition(async () => {
      try {
        const res = await adminAddTicketNote({ ...input, operationId: op.id });
        if (!res.ok) { setNoteError(res.message ?? "SUPPORT_NOTE_UNAVAILABLE"); return; }
        operations.current.delete(op.key);
        setNoteTicket(null); setNoteContent(""); router.refresh();
      } catch { setNoteError("UNKNOWN: " + (ar ? "تعذر التحقق من حفظ الملاحظة" : "Note save outcome unverified")); }
    });
  };

  const filteredTickets = data.tickets; // Filtering and counts are authoritative server queries.

  return (
    <div className="space-y-6" dir={ar ? "rtl" : "ltr"}>
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--service-line)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-[var(--service-accent)]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--service-accent)]">
              Module 09 · Customer Support & Reviews Center
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-black text-[var(--service-ink)] tracking-tight">
            {ar ? "تذاكر الدعم ومراجعات المنشآت (Support & Reviews)" : "Customer Support & Reviews"}
          </h1>
          <p className="mt-1 text-sm text-[var(--service-muted)]">
            {ar
              ? "نظام تذاكر الدعم والشكاوى الفنية، ومراجعة طلبات تهيئة الشركات، والبحث بكود الدعم (Support Code)."
              : "Full ticketing lifecycle, onboarding setup review requests, and support code customer authentication."}
          </p>
        </div>

        {/* Owner Verification Badge */}
        <div className="flex items-center gap-2 rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] px-3 py-1.5 shadow-sm">
          <IconShield className="h-4 w-4 text-[var(--service-success)]" />
          <span className="text-xs font-bold text-[var(--service-ink)]">{data.kpis.officialSupportEmail}</span>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
            {ar ? "مالك المنصة" : "Platform Owner"}
          </span>
        </div>
      </div>

      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* KPI 1: Open Support Tickets */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "تذاكر الدعم المفتوحة" : "Open Tickets"}
            </span>
            <IconAlert
              className={`h-4 w-4 ${
                data.kpis.openTicketsCount === "UNKNOWN" ? "text-[var(--service-muted)]" : data.kpis.openTicketsCount > 0 ? "text-amber-600" : "text-[var(--service-success)]"
              }`}
            />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span
              className={`text-2xl font-black ${
                data.kpis.openTicketsCount === "UNKNOWN" ? "text-[var(--service-muted)]" : data.kpis.openTicketsCount > 0 ? "text-amber-700" : "text-[var(--service-success)]"
              }`}
            >
              {data.kpis.openTicketsCount}
            </span>
            <span className="text-xs font-bold text-[var(--service-muted)]">
              {data.kpis.openTicketsCount === "UNKNOWN" ? (ar ? "غير متحقق" : "unverified") : (ar ? "تذكرة نشطة" : "active")}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {data.kpis.inProgressTicketsCount} {ar ? "قيد المتابعة والحل" : "in progress / pending"}
          </div>
        </div>

        {/* KPI 2: Pending Reviews Queue */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "طلبات مراجعة التهيئة" : "Pending Reviews"}
            </span>
            <IconCheckCircle className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--service-ink)]">
              {data.kpis.pendingReviewsCount}
            </span>
            <span className="text-xs font-bold text-[var(--service-muted)]">
              {ar ? "بانتظار الاعتماد" : "awaiting approval"}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "طابور مراجعة رقم الواتساب والمساعد" : "WhatsApp & assistant audit queue"}
          </div>
        </div>

        {/* KPI 3: Target SLA Status */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "اتفاقية مستوى الخدمة (SLA)" : "Target SLA Policy"}
            </span>
            <IconClock className="h-4 w-4 text-[var(--service-muted)]" />
          </div>
          <div className="mt-3">
            <span className="rounded-md bg-stone-100 px-2.5 py-1 text-xs font-mono font-bold text-stone-700 border border-stone-200">
              {data.kpis.supportSlaHours === "UNCONFIGURED"
                ? ar ? "غير محدد (UNCONFIGURED)" : "UNCONFIGURED"
                : `${data.kpis.supportSlaHours}h`}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "لا توجد سياسة SLA معتمدة رسميًا" : "No formal SLA policy configured"}
          </div>
        </div>

        {/* KPI 4: Official Support Email */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "البريد المعتمد للمنصة" : "Official Support Contact"}
            </span>
            <IconSparkles className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-3 font-mono text-xs font-bold text-[var(--service-ink)]">
            {data.kpis.officialSupportEmail}
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "البريد الموثق في شروط وسياسة المنصة" : "Verified platform contact address"}
          </div>
        </div>
      </div>

      {/* Customer Account & Support Code Quick Lookup */}
      <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[var(--service-ink)]">
              {ar ? "البحث السريع عن حسابات العملاء بكود الدعم (Support Code Lookup)" : "Customer Support Code Lookup"}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--service-muted)]">
              {ar
                ? "ابحث بكود الدعم الفريد (مثل VEL-XXXX-XXXX-XXXX) أو البريد الإلكتروني أو الهاتف لمطابقة الحساب وتأكيد هوية العميل."
                : "Search by unique Support Code (e.g. VEL-XXXX-XXXX-XXXX), email, or phone to authenticate customer identity."}
            </p>
          </div>
        </div>

        <form onSubmit={handleAccountSearch} className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <input
              type="text"
              aria-label={ar ? "البحث عن حساب بكود الدعم أو البريد أو الهاتف" : "Find account by support code, email or phone"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={ar ? "أدخل كود الدعم (VEL-...) أو البريد أو الهاتف..." : "Enter Support Code (VEL-...), email, or phone..."}
              className="w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3.5 py-2 text-xs outline-none focus:border-[var(--service-accent)]"
            />
          </div>
          <button
            type="submit"
            disabled={isSearching}
            className="rounded-xl bg-[var(--service-accent)] px-4 py-2 text-xs font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50 transition flex items-center gap-1.5"
          >
            <IconSearch className="h-3.5 w-3.5" />
            <span>{isSearching ? (ar ? "جاري البحث..." : "Searching...") : ar ? "بحث عن الحساب" : "Lookup Account"}</span>
          </button>
        </form>

        {searchError && (
          <div className="rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700 border border-red-200">
            {searchError}
          </div>
        )}

        {/* Search Results Table */}
        {searchResults !== null && (
          <div className="overflow-x-auto rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] mt-3">
            <table className="w-full text-right text-xs">
              <thead className="border-b border-[var(--service-line)] text-[11px] font-bold text-[var(--service-muted)]">
                <tr>
                  <th className="p-3">{ar ? "كود الدعم (Support Code)" : "Support Code"}</th>
                  <th className="p-3">{ar ? "اسم العميل" : "Customer Name"}</th>
                  <th className="p-3">{ar ? "البريد الإلكتروني" : "Email"}</th>
                  <th className="p-3">{ar ? "رقم الهاتف" : "Phone"}</th>
                  <th className="p-3">{ar ? "المنشآت المرتبطة" : "Companies"}</th>
                  <th className="p-3">{ar ? "الإجراء" : "Action"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--service-line)] text-[var(--service-ink)]">
                {searchResults.map((acc) => {
                  const primaryCompany = acc.companies[0];

                  return (
                    <tr key={acc.user_id} className="hover:bg-[var(--service-subtle)] transition">
                      <td className="p-3 font-mono font-bold text-[var(--service-accent)]">
                        {acc.support_code || "—"}
                      </td>
                      <td className="p-3 font-medium">{acc.full_name || "—"}</td>
                      <td className="p-3 font-mono text-[11px]">{acc.email || "—"}</td>
                      <td className="p-3 font-mono text-[11px]" dir="ltr">
                        {acc.account_phone || "—"}
                      </td>
                      <td className="p-3">
                        <span className="rounded-md bg-stone-100 px-2 py-0.5 text-[11px] font-bold text-stone-700">
                          {acc.companies.length} {ar ? "منشأة" : "companies"}
                        </span>
                      </td>
                      <td className="p-3">
                        {primaryCompany ? (
                          <Link
                            href={`/admin/companies/${encodeURIComponent(primaryCompany.company_id)}?returnTo=/admin/support`}
                            className="rounded-lg bg-[var(--service-accent-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--service-accent)] hover:bg-[var(--service-line)] transition inline-flex items-center gap-1"
                          >
                            <span>{ar ? "عرض المنشأة" : "Manage"}</span>
                            <span>←</span>
                          </Link>
                        ) : (
                          <span className="text-[11px] text-[var(--service-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {searchResults.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-xs text-[var(--service-muted)]">
                      {ar ? "لم يتم العثور على أي حساب يطابق بيانات البحث." : "No accounts match the lookup query."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Main Dual View Tabs: Support Tickets vs Pending Reviews */}
      <div className="flex items-center gap-3 border-b border-[var(--service-line)] pb-2 text-sm font-bold">
        <button
          type="button"
          onClick={() => setActiveTab("tickets")}
          className={`pb-2 px-1 border-b-2 transition ${
            activeTab === "tickets"
              ? "border-[var(--service-accent)] text-[var(--service-accent)]"
              : "border-transparent text-[var(--service-muted)] hover:text-[var(--service-ink)]"
          }`}
        >
          {ar ? "نظام تذاكر الدعم والشكاوى (Support Tickets)" : "Support Tickets"}
          <span className="ms-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-700">
            {data.tickets.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("reviews")}
          className={`pb-2 px-1 border-b-2 transition ${
            activeTab === "reviews"
              ? "border-[var(--service-accent)] text-[var(--service-accent)]"
              : "border-transparent text-[var(--service-muted)] hover:text-[var(--service-ink)]"
          }`}
        >
          {ar ? "طابور مراجعات تهيئة المنشآت (Onboarding Reviews)" : "Onboarding Reviews"}
          <span className="ms-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            {data.pendingReviews.length}
          </span>
        </button>
      </div>

      {/* TAB 1: Support Tickets System */}
      {activeTab === "tickets" && (
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-[var(--service-ink)]">
                {ar ? "سجل تذاكر الدعم الفني والشكاوى (Customer Support Tickets)" : "Customer Support Tickets"}
              </h2>
              <p className="mt-0.5 text-xs text-[var(--service-muted)]">
                {ar
                  ? "إدارة الحالات، الإسناد، الملاحظات الداخلية، والإغلاق وإعادة الفتح مع حفظ سجل التدقيق."
                  : "Lifecycle management, assignment, internal notes, resolution and audit trail."}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={data.ticketsAvailability === "unavailable"}
                onClick={() => setShowCreateModal(true)}
                className="rounded-xl bg-[var(--service-accent)] px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:opacity-90 transition flex items-center gap-1.5"
              >
                <IconPlus className="h-3.5 w-3.5" />
                <span>{ar ? "إنشاء تذكرة دعم جديدة" : "New Support Ticket"}</span>
              </button>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={ticketSearchQuery}
                onChange={(e) => setTicketSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); router.push(ticketsHref(0)); } }}
                placeholder={ar ? "ابحث برقم التذكرة أو الشركة ثم اضغط Enter" : "Search ticket # or company, then press Enter"}
                className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-1.5 text-xs outline-none focus:border-[var(--service-accent)]"
              />
              <select
                value={ticketStatusFilter}
                onChange={(e) => { setTicketStatusFilter(e.target.value); router.push(ticketsHref(0, e.target.value)); }}
                className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-1.5 text-xs outline-none focus:border-[var(--service-accent)]"
              >
                <option value="all">{ar ? "كل الحالات" : "All Statuses"}</option>
                <option value="open">{ar ? "مفتوحة" : "Open"}</option>
                <option value="in_progress">{ar ? "قيد المتابعة" : "In Progress"}</option>
                <option value="waiting_customer">{ar ? "بانتظار العميل" : "Waiting Customer"}</option>
                <option value="resolved">{ar ? "تم الحل" : "Resolved"}</option>
                <option value="closed">{ar ? "مغلقة" : "Closed"}</option>
              </select>
            </div>
            <div className="text-xs text-[var(--service-muted)]">
              {ar ? "المعروض:" : "Showing:"} {data.ticketsAvailability === "unavailable" ? "—" : `${filteredTickets.length} / ${data.pagination?.totalCount ?? data.tickets.length}`}
            </div>
          </div>

          {(ticketActionError || data.ticketsError) && <p role="alert" className="text-xs text-red-700">{ticketActionError || data.ticketsError}</p>}
          {data.pagination && (
            <nav aria-label={ar ? "صفحات التذاكر" : "Ticket pages"} className="flex gap-4 text-xs">
              {data.pagination.offset > 0 && <Link href={ticketsHref(Math.max(0, data.pagination.offset - data.pagination.limit))}>{ar ? "السابق" : "Previous"}</Link>}
              {data.pagination.hasMore && <Link href={ticketsHref(data.pagination.offset + data.pagination.limit)}>{ar ? "التالي" : "Next"}</Link>}
            </nav>
          )}
          {/* Tickets Table */}
          <div className="overflow-x-auto rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)]">
            <table className="w-full text-right text-xs">
              <thead className="border-b border-[var(--service-line)] text-[11px] font-bold text-[var(--service-muted)]">
                <tr>
                  <th className="p-3.5">{ar ? "رقم التذكرة" : "Ticket #"}</th>
                  <th className="p-3.5">{ar ? "العنوان والتصنيف" : "Title & Category"}</th>
                  <th className="p-3.5">{ar ? "المنشأة" : "Company"}</th>
                  <th className="p-3.5">{ar ? "الأولوية" : "Priority"}</th>
                  <th className="p-3.5">{ar ? "الحالة" : "Status"}</th>
                  <th className="p-3.5">{ar ? "تاريخ الإنشاء" : "Created At"}</th>
                  <th className="p-3.5">{ar ? "الإجراءات" : "Actions"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--service-line)] text-[var(--service-ink)]">
                {filteredTickets.map((t) => {
                  const prioMeta = PRIORITY_BADGES[t.priority] ?? PRIORITY_BADGES.medium;
                  const statMeta = STATUS_BADGES[t.status] ?? STATUS_BADGES.open;

                  return (
                    <tr key={t.id} className="hover:bg-[var(--service-subtle)] transition">
                      <td className="p-3.5 font-mono font-bold text-[var(--service-accent)]">
                        {t.ticketNumber}
                      </td>
                      <td className="p-3.5">
                        <div className="font-bold text-[var(--service-ink)]">{t.title}</div>
                        <div className="text-[11px] text-[var(--service-muted)] uppercase tracking-wider">
                          {t.category}
                        </div>
                      </td>
                      <td className="p-3.5">
                        <Link
                          href={`/admin/companies/${encodeURIComponent(t.companyId)}?returnTo=/admin/support`}
                          className="font-medium hover:underline text-[var(--service-ink)] hover:text-[var(--service-accent)]"
                        >
                          {t.companyName ?? t.companyId}
                        </Link>
                        {t.branchId && (
                          <div className="text-[10px] text-[var(--service-muted)]">
                            {ar ? "فرع:" : "Branch:"} {t.branchId}
                          </div>
                        )}
                      </td>
                      <td className="p-3.5">
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold border ${prioMeta.style}`}>
                          {ar ? prioMeta.ar : prioMeta.en}
                        </span>
                      </td>
                      <td className="p-3.5">
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold border ${statMeta.style}`}>
                          {ar ? statMeta.ar : statMeta.en}
                        </span>
                      </td>
                      <td className="p-3.5 font-mono text-[11px] text-[var(--service-muted)]">
                        <time dateTime={t.createdAt}>
                          {new Intl.DateTimeFormat(locale, {
                            dateStyle: "short",
                            timeStyle: "short",
                            timeZone: "Asia/Muscat",
                          }).format(new Date(t.createdAt))}
                        </time>
                      </td>
                      <td className="p-3.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {t.status === "open" && (
                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={() => handleStatusChange(t.id, "in_progress")}
                              className="rounded-lg bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700 border border-blue-200 hover:bg-blue-100 transition"
                            >
                              {ar ? "بدء المعالجة" : "In Progress"}
                            </button>
                          )}
                          {t.status === "in_progress" && (
                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={() => handleStatusChange(t.id, "resolved")}
                              className="rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition"
                            >
                              {ar ? "حل التذكرة" : "Resolve"}
                            </button>
                          )}
                          {(t.status === "resolved" || t.status === "open" || t.status === "in_progress") && (
                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={() => handleStatusChange(t.id, "closed")}
                              className="rounded-lg bg-stone-100 px-2 py-1 text-[11px] font-bold text-stone-700 border border-stone-200 hover:bg-stone-200 transition"
                            >
                              {ar ? "إغلاق" : "Close"}
                            </button>
                          )}
                          {t.status === "closed" && (
                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={() => handleStatusChange(t.id, "open")}
                              className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800 border border-amber-200 hover:bg-amber-100 transition"
                            >
                              {ar ? "إعادة الفتح" : "Reopen"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setNoteTicket(t);
                              setNoteContent("");
                            }}
                            className="rounded-lg bg-[var(--service-canvas)] px-2 py-1 text-[11px] font-bold text-[var(--service-ink)] border border-[var(--service-line)] hover:bg-[var(--service-subtle)] transition"
                          >
                            {ar ? "ملاحظة" : "Note"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {filteredTickets.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-xs text-[var(--service-muted)]">
                      {data.ticketsAvailability === "unavailable"
                        ? (ar ? "تعذرت قراءة التذاكر؛ عددها غير معلوم. طابور المراجعات متاح في تبويبه." : "Tickets unavailable; count is unknown. Onboarding reviews remain available in their tab.")
                        : ar ? "لا توجد تذاكر دعم مسجلة تطابق شروط الفرز الحالية." : "No support tickets match the current criteria."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Preserved Onboarding Reviews Queue */}
      {activeTab === "reviews" && (
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-[var(--service-ink)]">
                {ar ? "طابور مراجعات تهيئة المنشآت الجديدة (Pending Onboarding Reviews)" : "Pending Onboarding Reviews"}
              </h2>
              <p className="mt-0.5 text-xs text-[var(--service-muted)]">
                {ar
                  ? "المنشآت التي أكملت بيانات الربط وقدمت طلب اعتماد المساعد وتنتظر موافقة الإدارة."
                  : "Businesses that submitted onboarding details and are awaiting administrative verification."}
              </p>
            </div>

            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800 border border-amber-200">
              {data.pendingReviews.length} {ar ? "طلبات قيد الانتظار" : "in queue"}
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)]">
            <table className="w-full text-right text-xs">
              <thead className="border-b border-[var(--service-line)] text-[11px] font-bold text-[var(--service-muted)]">
                <tr>
                  <th className="p-3.5">{ar ? "المنشأة" : "Company"}</th>
                  <th className="p-3.5">{ar ? "نوع النشاط" : "Business Type"}</th>
                  <th className="p-3.5">{ar ? "بريد المالك" : "Owner Email"}</th>
                  <th className="p-3.5">{ar ? "رقم الهاتف المعتمد" : "Contact Phone"}</th>
                  <th className="p-3.5">{ar ? "المدينة / الدولة" : "Location"}</th>
                  <th className="p-3.5">{ar ? "تاريخ التقديم" : "Submitted At"}</th>
                  <th className="p-3.5">{ar ? "الإجراء" : "Action"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--service-line)] text-[var(--service-ink)]">
                {data.pendingReviews.map((row) => (
                  <tr key={row.id} className="hover:bg-[var(--service-subtle)] transition">
                    <td className="p-3.5 font-bold text-[var(--service-ink)]">
                      <div className="flex items-center gap-2">
                        <IconBuilding className="h-3.5 w-3.5 text-[var(--service-accent)]" />
                        <span>{row.display_name}</span>
                      </div>
                    </td>
                    <td className="p-3.5 text-[var(--service-muted)]">{row.business_type || "—"}</td>
                    <td className="p-3.5 font-mono text-[11px]">{row.owner_email || "—"}</td>
                    <td className="p-3.5 font-mono text-[11px]" dir="ltr">
                      {row.contact_phone || "—"}
                    </td>
                    <td className="p-3.5 text-[var(--service-muted)]">
                      {row.city ? `${row.city}, ` : ""}{row.country}
                    </td>
                    <td className="p-3.5 font-mono text-[11px] text-[var(--service-muted)]">
                      {row.review_requested_at || row.updated_at ? (
                        <time dateTime={row.review_requested_at ?? row.updated_at}>
                          {new Intl.DateTimeFormat(locale, {
                            dateStyle: "short",
                            timeStyle: "short",
                            timeZone: "Asia/Muscat",
                          }).format(new Date(row.review_requested_at ?? row.updated_at))}
                        </time>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-3.5">
                      <Link
                        href={`/admin/companies/${encodeURIComponent(row.id)}?returnTo=/admin/support`}
                        className="rounded-xl bg-[var(--service-accent)] px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 transition inline-flex items-center gap-1 shadow-xs"
                      >
                        <span>{ar ? "مراجعة واعتماد" : "Review & Decide"}</span>
                        <span>←</span>
                      </Link>
                    </td>
                  </tr>
                ))}

                {data.pendingReviews.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-xs text-[var(--service-muted)]">
                      {ar
                        ? "لا توجد طلبات مراجعة معلقة حاليًا. كافة المنشآت تمت مراجعتها وجاهزة للعمل."
                        : "No pending company onboarding reviews at this time. All businesses verified."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Official Support Channels & Escalation Matrix */}
      <div className="space-y-3">
        <h2 className="text-base font-bold text-[var(--service-ink)]">
          {ar ? "قنوات التواصل المعتمدة للمنصة (Platform Support Channels)" : "Platform Support Channels"}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {data.supportChannels.map((ch) => (
            <div
              key={ch.id}
              className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--service-ink)]">{ch.channel}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      ch.status === "OPERATIONAL"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-stone-100 text-stone-700"
                    }`}
                  >
                    {ch.status}
                  </span>
                </div>
                <div className="mt-2 font-mono text-xs font-bold text-[var(--service-accent)]">
                  {ch.target}
                </div>
                <p className="mt-1 text-[11px] text-[var(--service-muted)] leading-relaxed">
                  {ch.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal: Create Support Ticket */}
      {showCreateModal && (
        <AccessibleDialog label={ar ? "إنشاء تذكرة دعم" : "Create support ticket"} onClose={() => setShowCreateModal(false)} busy={isSubmitting}>
          <div className="w-full max-w-lg rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--service-line)] pb-3">
              <h3 className="text-base font-bold text-[var(--service-ink)]">
                {ar ? "إنشاء تذكرة دعم فني جديدة" : "Create New Support Ticket"}
              </h3>
              <button
                type="button"
                aria-label={ar ? "إغلاق" : "Close"}
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg p-1 text-[var(--service-muted)] hover:bg-[var(--service-subtle)]"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTicket} className="space-y-3 text-xs">
              <div>
                <label htmlFor="admin-support-reviews-field-1" className="block font-semibold text-[var(--service-ink)] mb-1">
                  {ar ? "معرف المنشأة (Company ID)" : "Company ID"}
                </label>
                <input id="admin-support-reviews-field-1"
                  type="text"
                  required
                  value={newTicketForm.companyId}
                  onChange={(e) => setNewTicketForm({ ...newTicketForm, companyId: e.target.value })}
                  placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                  className="w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-2 outline-none font-mono focus:border-[var(--service-accent)]"
                />
              </div>

              <div>
                <label htmlFor="admin-support-reviews-field-2" className="block font-semibold text-[var(--service-ink)] mb-1">
                  {ar ? "معرف الفرع (اختياري)" : "Branch ID (Optional)"}
                </label>
                <input id="admin-support-reviews-field-2"
                  type="text"
                  value={newTicketForm.branchId}
                  onChange={(e) => setNewTicketForm({ ...newTicketForm, branchId: e.target.value })}
                  placeholder={ar ? "UUID الفرع التابع للشركة" : "Company branch UUID"}
                  className="w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-2 outline-none font-mono focus:border-[var(--service-accent)]"
                />
              </div>

              <div>
                <label htmlFor="admin-support-reviews-field-3" className="block font-semibold text-[var(--service-ink)] mb-1">
                  {ar ? "عنوان التذكرة / المشكلة" : "Ticket Subject / Title"}
                </label>
                <input id="admin-support-reviews-field-3"
                  type="text"
                  required
                  value={newTicketForm.title}
                  onChange={(e) => setNewTicketForm({ ...newTicketForm, title: e.target.value })}
                  placeholder={ar ? "وصف مختصر للمشكلة..." : "Brief subject of the issue..."}
                  className="w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-2 outline-none focus:border-[var(--service-accent)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="admin-support-reviews-field-4" className="block font-semibold text-[var(--service-ink)] mb-1">
                    {ar ? "التصنيف" : "Category"}
                  </label>
                  <select id="admin-support-reviews-field-4"
                    value={newTicketForm.category}
                    onChange={(e) => setNewTicketForm({ ...newTicketForm, category: e.target.value as TicketCategory })}
                    className="w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-2 outline-none focus:border-[var(--service-accent)]"
                  >
                    <option value="technical">Technical</option>
                    <option value="billing">Billing</option>
                    <option value="channel">Channel (WhatsApp/IG)</option>
                    <option value="onboarding">Onboarding</option>
                    <option value="ai">AI Engine</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="admin-support-reviews-field-5" className="block font-semibold text-[var(--service-ink)] mb-1">
                    {ar ? "الأولوية" : "Priority"}
                  </label>
                  <select id="admin-support-reviews-field-5"
                    value={newTicketForm.priority}
                    onChange={(e) => setNewTicketForm({ ...newTicketForm, priority: e.target.value as TicketPriority })}
                    className="w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-2 outline-none focus:border-[var(--service-accent)]"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="admin-support-reviews-field-6" className="block font-semibold text-[var(--service-ink)] mb-1">
                  {ar ? "تفاصيل الشكوى / البلاغ" : "Detailed Description"}
                </label>
                <textarea id="admin-support-reviews-field-6"
                  required
                  rows={3}
                  value={newTicketForm.description}
                  onChange={(e) => setNewTicketForm({ ...newTicketForm, description: e.target.value })}
                  placeholder={ar ? "شرح كامل للمشكلة أو الملاحظة الفنية..." : "Full details of the reported issue..."}
                  className="w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-2 outline-none focus:border-[var(--service-accent)]"
                />
              </div>

              <div>
                <label htmlFor="admin-support-reviews-field-7" className="block font-semibold text-[var(--service-ink)] mb-1">
                  {ar ? "ملاحظة داخلية أولية (اختياري)" : "Initial Internal Note (Optional)"}
                </label>
                <input id="admin-support-reviews-field-7"
                  type="text"
                  value={newTicketForm.initialNote}
                  onChange={(e) => setNewTicketForm({ ...newTicketForm, initialNote: e.target.value })}
                  placeholder={ar ? "ملاحظات داخلية لفريق الدعم..." : "Internal notes for support..."}
                  className="w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-2 outline-none focus:border-[var(--service-accent)]"
                />
              </div>

              {createError && (
                <div className="rounded-xl bg-red-50 p-2 text-xs font-semibold text-red-700 border border-red-200">
                  {createError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--service-line)]">
                <button
                  type="button"
                onClick={() => setShowCreateModal(false)}
                  className="rounded-xl border border-[var(--service-line)] px-4 py-2 font-bold text-[var(--service-ink)] hover:bg-[var(--service-subtle)]"
                >
                  {ar ? "إلغاء" : "Cancel"}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-xl bg-[var(--service-accent)] px-4 py-2 font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
                >
                  {isSubmitting ? (ar ? "جاري الحفظ..." : "Saving...") : ar ? "إنشاء التذكرة" : "Create Ticket"}
                </button>
              </div>
            </form>
          </div>
        </AccessibleDialog>
      )}

      {/* Modal: Add Internal Note */}
      {noteTicket && (
        <AccessibleDialog label={ar ? "إضافة ملاحظة" : "Add note"} onClose={() => setNoteTicket(null)} busy={isSubmitting}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--service-line)] pb-3">
              <div>
                <h3 className="text-base font-bold text-[var(--service-ink)]">
                  {ar ? "إضافة ملاحظة داخلية للتذكرة" : "Add Internal Note"}
                </h3>
                <span className="font-mono text-xs font-bold text-[var(--service-accent)]">
                  {noteTicket.ticketNumber}
                </span>
              </div>
              <button
                type="button"
                aria-label={ar ? "إغلاق" : "Close"}
                onClick={() => setNoteTicket(null)}
                className="rounded-lg p-1 text-[var(--service-muted)] hover:bg-[var(--service-subtle)]"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddNote} className="space-y-3 text-xs">
              <div>
                <label htmlFor="admin-support-reviews-field-8" className="block font-semibold text-[var(--service-ink)] mb-1">
                  {ar ? "نص الملاحظة" : "Note Content"}
                </label>
                <textarea id="admin-support-reviews-field-8"
                  required
                  rows={4}
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder={ar ? "أدخل تفاصيل التحديث أو الملاحظة الفنية..." : "Enter internal diagnostic notes..."}
                  className="w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-2 outline-none focus:border-[var(--service-accent)]"
                />
              </div>

              {noteError && (
                <div className="rounded-xl bg-red-50 p-2 text-xs font-semibold text-red-700 border border-red-200">
                  {noteError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--service-line)]">
                <button
                  type="button"
                onClick={() => setNoteTicket(null)}
                  className="rounded-xl border border-[var(--service-line)] px-4 py-2 font-bold text-[var(--service-ink)] hover:bg-[var(--service-subtle)]"
                >
                  {ar ? "إلغاء" : "Cancel"}
                </button>
                <button
                  type="submit"
                  disabled={isNoteSubmitting}
                  className="rounded-xl bg-[var(--service-accent)] px-4 py-2 font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
                >
                  {isNoteSubmitting ? (ar ? "جاري الحفظ..." : "Saving...") : ar ? "حفظ الملاحظة" : "Save Note"}
                </button>
              </div>
            </form>
          </div>
        </AccessibleDialog>
      )}
    </div>
  );
}
