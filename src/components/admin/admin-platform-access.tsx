"use client";
import { AccessibleDialog } from "@/components/app/accessible-dialog";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDemo } from "@/lib/demo-state";
import styles from "./admin-platform-access.module.css";
import type {
  PlatformAccessOverviewData,
  PlatformAdminStatus,
  PlatformAdminUser,
  PlatformRole,
} from "@/lib/tenancy/access-types";
import {
  adminGrantPlatformAdminRole,
  adminRevokePlatformAdmin,
  adminToggleAdminStatus,
  adminUpdatePlatformAdminRole,
} from "@/lib/tenancy/access-actions";
import {
  IconAlert,
  IconCheckCircle,
  IconPlus,
  IconX,
} from "./admin-icons";

export interface AdminPlatformAccessProps {
  data: PlatformAccessOverviewData;
}

const ROLE_BADGES: Record<PlatformRole, { ar: string; en: string; style: string }> = {
  owner: { ar: "مالك المنصة (Super Admin)", en: "Platform Owner", style: "bg-purple-100 text-purple-800 border-purple-200" },
  support: { ar: "مشرف دعم ومراجعات", en: "Support Admin", style: "bg-blue-100 text-blue-800 border-blue-200" },
  finance: { ar: "مشرف مالية واشتراكات", en: "Finance Admin", style: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  operations: { ar: "مشرف عمليات وتشغيل", en: "Operations Admin", style: "bg-amber-100 text-amber-800 border-amber-200" },
};

export function AdminPlatformAccess({ data }: AdminPlatformAccessProps) {
  const { locale } = useDemo();
  const ar = locale === "ar";
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Modals state
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [grantUserId, setGrantUserId] = useState("");
  const [grantRole, setGrantRole] = useState<Exclude<PlatformRole, "owner">>("support");
  const [grantNote, setGrantNote] = useState("");
  const [grantError, setGrantError] = useState<string | null>(null);

  const [editingAdmin, setEditingAdmin] = useState<PlatformAdminUser | null>(null);
  const [editRole, setEditRole] = useState<Exclude<PlatformRole, "owner">>("support");
  const [editStatus, setEditStatus] = useState<PlatformAdminStatus>("active");
  const [editNote, setEditNote] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const [confirmRevokeAdmin, setConfirmRevokeAdmin] = useState<PlatformAdminUser | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const handleGrant = async () => {
    setGrantError(null);
    if (!grantUserId.trim()) {
      setGrantError(ar ? "يرجى إدخال معرف المستخدم (User ID)" : "User ID is required");
      return;
    }

    startTransition(async () => {
      const res = await adminGrantPlatformAdminRole({
        userId: grantUserId.trim(),
        role: grantRole,
        note: grantNote.trim(),
      });

      if (!res.ok) {
        setGrantError(res.message ?? (ar ? "فشل تفويض المشرف" : "Failed to grant platform role"));
      } else {
        setShowGrantModal(false);
        setGrantUserId("");
        setGrantNote("");
        setActionMessage(ar ? "تم تفويض المشرف بنجاح" : "Platform role granted successfully");
        router.refresh();
      }
    });
  };

  const handleUpdate = async () => {
    if (!editingAdmin) return;
    setEditError(null);

    startTransition(async () => {
      const res = await adminUpdatePlatformAdminRole({
        userId: editingAdmin.userId,
        role: editRole,
        status: editStatus,
        note: editNote.trim(),
      });

      if (!res.ok) {
        setEditError(res.message ?? (ar ? "فشل تحديث الصلاحية" : "Failed to update role"));
      } else {
        setEditingAdmin(null);
        setActionMessage(ar ? "تم تحديث صلاحية المشرف بنجاح" : "Admin role updated successfully");
        router.refresh();
      }
    });
  };

  const handleToggleStatus = (admin: PlatformAdminUser) => {
    const nextStatus = admin.status === "active" ? "disabled" : "active";
    startTransition(async () => {
      const res = await adminToggleAdminStatus(admin.userId, nextStatus);
      if (res.ok) {
        setActionMessage(
          nextStatus === "disabled"
            ? ar ? "تم تعليق حساب المشرف" : "Admin suspended"
            : ar ? "تم إعادة تفعيل حساب المشرف" : "Admin reactivated"
        );
        router.refresh();
      }
    });
  };

  const handleRevoke = async () => {
    if (!confirmRevokeAdmin) return;
    startTransition(async () => {
      const res = await adminRevokePlatformAdmin(confirmRevokeAdmin.userId);
      if (res.ok) {
        setConfirmRevokeAdmin(null);
        setActionMessage(ar ? "تم إلغاء التفويض وإبطال الوصول الإداري بالكامل" : "Delegated role revoked successfully");
        router.refresh();
      }
    });
  };

  return (
    <div className={`space-y-6 ${styles.access}`} dir={ar ? "rtl" : "ltr"}>
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--service-line)] pb-4">
        <div>
          <h1 className="mt-1 text-2xl font-black text-[var(--service-ink)] tracking-tight">
            {ar ? "صلاحيات المشرفين" : "Administrator access"}
          </h1>
          <p className="mt-1 text-sm text-[var(--service-muted)]">
            {ar
              ? "إدارة أدوار المشرفين المفوضين ومراجعة السجلات المتاحة."
              : "Manage delegated administrator roles and review available records."}
          </p>
        </div>

        {/* Platform Owner Verified Badge */}
        <div className="flex items-center gap-3">

          <button
            type="button"
            onClick={() => setShowGrantModal(true)}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--service-accent)] px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:opacity-95 transition"
          >
            <IconPlus className="h-4 w-4" />
            <span>{ar ? "تفويض مشرف جديد" : "Grant New Admin"}</span>
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
          <div className="flex items-center gap-2">
            <IconCheckCircle className="h-4 w-4 text-emerald-600" />
            <span className="font-semibold">{actionMessage}</span>
          </div>
          <button type="button" aria-label={ar ? "إغلاق التنبيه" : "Dismiss notification"} onClick={() => setActionMessage(null)} className="text-emerald-700 hover:opacity-75">
            <IconX className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className={styles.summary}>
        <div className="rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4">
          <h2 className="text-sm font-semibold text-[var(--service-muted)]">{ar ? "سجلات المشرفين المفوضين المحمّلة" : "Loaded delegated administrator records"}</h2>
          <p className="mt-2 text-2xl font-bold text-[var(--service-ink)]">{data.delegatedAdmins.length}</p>
        </div>
        <p role="status" className="rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 text-sm text-[var(--service-muted)]">
          {ar ? "بعض تفاصيل الهوية والدور والحالة والتاريخ قد تتضمن قيمًا افتراضية. تحقق من الحساب والسجل قبل إجراء أي تغيير." : "Some identity, role, status and date details may contain defaults. Verify the account and record before making changes."}
        </p>
      </div>

      {/* Delegated Admins Directory Table */}
      <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[var(--service-ink)]">
              {ar ? "دليل المشرفين المفوضين (Platform Staff Directory)" : "Delegated Platform Staff Directory"}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--service-muted)]">
              {ar
                ? "سجلات المشرفين المفوضين والأدوار المعروضة لهم."
                : "Loaded records of delegated administrators and their displayed roles."}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)]" role="region" aria-label={ar ? "جدول المشرفين" : "Administrators table"} tabIndex={0}>
          <table className="w-full text-start text-xs">
            <thead className="border-b border-[var(--service-line)] text-[11px] font-bold text-[var(--service-muted)]">
              <tr>
                <th scope="col" className="p-3.5">{ar ? "المشرف" : "Administrator"}</th>
                <th scope="col" className="p-3.5">{ar ? "الدور الإداري" : "Role"}</th>
                <th scope="col" className="p-3.5">{ar ? "الحالة التشغيلية" : "Status"}</th>
                <th scope="col" className="p-3.5">{ar ? "تاريخ التفويض" : "Granted At"}</th>
                <th scope="col" className="p-3.5">{ar ? "ملاحظات" : "Notes"}</th>
                <th scope="col" className="p-3.5">{ar ? "الإجراءات" : "Actions"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--service-line)] text-[var(--service-ink)]">
              {/* Sovereign Owner Row */}
              <tr className="bg-purple-50/40">
                <td className="p-3.5">
                  <div className="font-bold text-[var(--service-ink)]">{data.owner.fullName}</div>
                  <div className="text-sm text-[var(--service-muted)]">{ar ? "البريد غير متحقق من مصدره" : "Email source not verified"}</div>
                </td>
                <td className="p-3.5">
                  <span className="rounded-md px-2 py-0.5 text-[10px] font-bold border bg-purple-100 text-purple-800 border-purple-200">
                    {ar ? "مالك المنصة (Super Admin)" : "Platform Owner"}
                  </span>
                </td>
                <td className="p-3.5">
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-700">
                    {ar ? "الحالة غير متحققة هنا" : "Status not verified here"}
                  </span>
                </td>
                <td className="p-3.5 font-mono text-[11px] text-[var(--service-muted)]">
                  —
                </td>
                <td className="p-3.5 text-xs text-[var(--service-muted)]">
                  {ar ? "سياق وصول المالك" : "Owner access context"}
                </td>
                <td className="p-3.5 text-xs text-[var(--service-muted)]">
                  <span className="text-[11px] text-stone-400 italic">{ar ? "لا يُعدّل من هنا" : "Not editable here"}</span>
                </td>
              </tr>

              {/* Delegated Admins Rows */}
              {data.delegatedAdmins.map((admin) => {
                const roleMeta = ROLE_BADGES[admin.role] ?? ROLE_BADGES.support;
                const isActive = admin.status === "active";

                return (
                  <tr key={admin.userId} className="hover:bg-[var(--service-subtle)] transition">
                    <td className="p-3.5">
                      <div className="font-bold text-[var(--service-ink)]">{admin.fullName}</div>
                      <div className="text-sm text-[var(--service-muted)]">{ar ? "البريد غير متحقق من مصدره" : "Email source not verified"}</div>
                      <div dir="ltr" className="text-[13px] font-mono text-[var(--service-muted)]">{admin.userId}</div>
                      {admin.supportCode && (
                        <div className="text-[10px] font-mono text-[var(--service-accent)]">{admin.supportCode}</div>
                      )}
                    </td>
                    <td className="p-3.5">
                      <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold border ${roleMeta.style}`}>
                        {ar ? roleMeta.ar : roleMeta.en}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                          isActive
                            ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                            : "bg-red-100 text-red-800 border-red-200"
                        }`}
                      >
                        {isActive ? (ar ? "نشط" : "Active") : ar ? "معلق (Suspended)" : "Suspended"}
                      </span>
                    </td>
                    <td className="p-3.5 font-mono text-[11px] text-[var(--service-muted)]">
                      {ar ? "غير متحقق" : "Not verified"}
                    </td>
                    <td className="p-3.5 text-xs text-[var(--service-muted)] max-w-xs truncate">
                      {admin.note || "—"}
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingAdmin(admin);
                            setEditRole(admin.role === "owner" ? "support" : admin.role);
                            setEditStatus(admin.status);
                            setEditNote(admin.note);
                          }}
                          className="rounded-lg bg-[var(--service-surface)] px-2.5 py-1 text-[11px] font-bold text-[var(--service-ink)] border border-[var(--service-line)] hover:bg-[var(--service-subtle)] transition"
                        >
                          {ar ? "تعديل" : "Edit"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(admin)}
                          disabled={isPending}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-bold border transition ${
                            isActive
                              ? "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
                              : "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                          }`}
                        >
                          {isActive ? (ar ? "تعليق" : "Suspend") : ar ? "تفعيل" : "Activate"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRevokeAdmin(admin)}
                          className="rounded-lg bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700 border border-red-200 hover:bg-red-100 transition"
                        >
                          {ar ? "إلغاء التفويض" : "Revoke"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {data.delegatedAdmins.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-xs text-[var(--service-muted)] font-sans">
                    {ar
                      ? "لا يوجد مشرفون مفوضون حالياً في السجلات المحمّلة."
                      : "No delegated administrators in the loaded records."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Role Catalog Cards */}
      <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm space-y-3">
        <h2 className="text-sm font-bold text-[var(--service-ink)]">
          {ar ? "تعريفات الأدوار" : "Role definitions"}
        </h2>
        <div className={styles.roles}>
          {data.roleCatalog.map((cat) => (
            <div key={cat.role} className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold border ${cat.badgeStyle}`}>
                  {ar ? cat.nameAr : cat.nameEn}
                </span>
              </div>
              <p className="text-[11px] text-[var(--service-muted)]">
                {ar ? cat.descriptionAr : cat.descriptionEn}
              </p>
              <div className="pt-2 border-t border-[var(--service-line)]">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--service-muted)] mb-1">
                  {ar ? "الصلاحيات المذكورة:" : "Listed capabilities:"}
                </div>
                <div className="flex flex-wrap gap-1">
                  {cat.capabilities.map((cap) => (
                    <span key={cap} className="rounded bg-[var(--service-surface)] px-1.5 py-0.5 text-[9px] font-mono border border-[var(--service-line)] text-[var(--service-ink)]">
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Grant Modal */}
      {showGrantModal && (
        <AccessibleDialog label={ar ? "تفويض مشرف منصة جديد" : "Grant platform access"} onClose={() => setShowGrantModal(false)} busy={isPending}>
          <div className="w-full max-w-lg rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--service-line)] pb-3">
              <h3 className="text-base font-bold text-[var(--service-ink)]">
                {ar ? "تفويض مشرف منصة جديد" : "Grant Delegated Platform Admin"}
              </h3>
              <button
                type="button"
                aria-label={ar ? "إغلاق" : "Close"}
                onClick={() => setShowGrantModal(false)}
                className="rounded-lg p-1 text-[var(--service-muted)] hover:bg-[var(--service-subtle)]"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>

            {grantError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {grantError}
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label htmlFor="admin-platform-access-field-1" className="block font-semibold text-[var(--service-ink)] mb-1">
                  {ar ? "معرف المستخدم (User ID)" : "Target User ID (UUID)"}
                </label>
                <input id="admin-platform-access-field-1"
                  type="text"
                  value={grantUserId}
                  onChange={(e) => setGrantUserId(e.target.value)}
                  placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                  className="w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-2.5 font-mono outline-none focus:border-[var(--service-accent)]"
                />
              </div>

              <div>
                <label htmlFor="admin-platform-access-field-2" className="block font-semibold text-[var(--service-ink)] mb-1">
                  {ar ? "الدور الإداري المخصص" : "Scoped Platform Role"}
                </label>
                <select id="admin-platform-access-field-2"
                  value={grantRole}
                  onChange={(e) => setGrantRole(e.target.value as Exclude<PlatformRole, "owner">)}
                  className="w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-2.5 outline-none focus:border-[var(--service-accent)]"
                >
                  <option value="support">{ar ? "مشرف دعم ومراجعات (Support Admin)" : "Support Admin"}</option>
                  <option value="finance">{ar ? "مشرف مالية واشتراكات (Finance Admin)" : "Finance Admin"}</option>
                  <option value="operations">{ar ? "مشرف عمليات وتشغيل (Operations Admin)" : "Operations Admin"}</option>
                </select>
              </div>

              <div>
                <label htmlFor="admin-platform-access-field-3" className="block font-semibold text-[var(--service-ink)] mb-1">
                  {ar ? "ملاحظة / سبب التفويض" : "Note / Delegation Reason"}
                </label>
                <textarea id="admin-platform-access-field-3"
                  value={grantNote}
                  onChange={(e) => setGrantNote(e.target.value)}
                  rows={2}
                  placeholder={ar ? "سبب منح الدور الإداري للموظف..." : "Internal reason for granting this role..."}
                  className="w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-2.5 outline-none focus:border-[var(--service-accent)]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--service-line)]">
              <button
                type="button"
                onClick={() => setShowGrantModal(false)}
                className="rounded-xl border border-[var(--service-line)] px-4 py-2 text-xs font-semibold text-[var(--service-muted)] hover:bg-[var(--service-subtle)]"
              >
                {ar ? "إلغاء" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={handleGrant}
                disabled={isPending}
                className="rounded-xl bg-[var(--service-accent)] px-4 py-2 text-xs font-bold text-white shadow-sm hover:opacity-95 disabled:opacity-50"
              >
                {isPending ? (ar ? "جارٍ الحفظ..." : "Saving...") : ar ? "تأكيد التفويض" : "Grant Role"}
              </button>
            </div>
          </div>
        </AccessibleDialog>
      )}

      {/* Edit Modal */}
      {editingAdmin && (
        <AccessibleDialog label={ar ? "تعديل الصلاحية" : "Edit access"} onClose={() => setEditingAdmin(null)} busy={isPending}>
          <div className="w-full max-w-lg rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--service-line)] pb-3">
              <h3 className="text-base font-bold text-[var(--service-ink)]">
                {ar ? `تعديل صلاحية: ${editingAdmin.fullName}` : `Edit Role: ${editingAdmin.fullName}`}
              </h3>
              <button
                type="button"
                aria-label={ar ? "إغلاق" : "Close"}
                onClick={() => setEditingAdmin(null)}
                className="rounded-lg p-1 text-[var(--service-muted)] hover:bg-[var(--service-subtle)]"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>

            {editError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {editError}
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label htmlFor="admin-platform-access-field-4" className="block font-semibold text-[var(--service-ink)] mb-1">
                  {ar ? "الدور الإداري" : "Platform Role"}
                </label>
                <select id="admin-platform-access-field-4"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as Exclude<PlatformRole, "owner">)}
                  className="w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-2.5 outline-none focus:border-[var(--service-accent)]"
                >
                  <option value="support">{ar ? "مشرف دعم ومراجعات (Support Admin)" : "Support Admin"}</option>
                  <option value="finance">{ar ? "مشرف مالية واشتراكات (Finance Admin)" : "Finance Admin"}</option>
                  <option value="operations">{ar ? "مشرف عمليات وتشغيل (Operations Admin)" : "Operations Admin"}</option>
                </select>
              </div>

              <div>
                <label htmlFor="admin-platform-access-field-5" className="block font-semibold text-[var(--service-ink)] mb-1">
                  {ar ? "الحالة التشغيلية" : "Operational Status"}
                </label>
                <select id="admin-platform-access-field-5"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as PlatformAdminStatus)}
                  className="w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-2.5 outline-none focus:border-[var(--service-accent)]"
                >
                  <option value="active">{ar ? "نشط (Active)" : "Active"}</option>
                  <option value="disabled">{ar ? "معلق (Suspended - Invalidate Sessions)" : "Suspended"}</option>
                </select>
              </div>

              <div>
                <label htmlFor="admin-platform-access-field-6" className="block font-semibold text-[var(--service-ink)] mb-1">
                  {ar ? "الملاحظات" : "Notes"}
                </label>
                <textarea id="admin-platform-access-field-6"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-2.5 outline-none focus:border-[var(--service-accent)]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--service-line)]">
              <button
                type="button"
                onClick={() => setEditingAdmin(null)}
                className="rounded-xl border border-[var(--service-line)] px-4 py-2 text-xs font-semibold text-[var(--service-muted)] hover:bg-[var(--service-subtle)]"
              >
                {ar ? "إلغاء" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={handleUpdate}
                disabled={isPending}
                className="rounded-xl bg-[var(--service-accent)] px-4 py-2 text-xs font-bold text-white shadow-sm hover:opacity-95 disabled:opacity-50"
              >
                {isPending ? (ar ? "جارٍ التحديث..." : "Updating...") : ar ? "حفظ التغييرات" : "Save Changes"}
              </button>
            </div>
          </div>
        </AccessibleDialog>
      )}

      {/* Revoke Confirmation Modal */}
      {confirmRevokeAdmin && (
        <AccessibleDialog label={ar ? "إلغاء التفويض" : "Revoke access"} onClose={() => setConfirmRevokeAdmin(null)} busy={isPending}>
          <div className="w-full max-w-md rounded-2xl border border-red-200 bg-[var(--service-surface)] p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <IconAlert className="h-6 w-6" />
              <h3 className="text-base font-bold text-[var(--service-ink)]">
                {ar ? "تأكيد إلغاء التفويض الإداري" : "Confirm Revoke Admin Role"}
              </h3>
            </div>

            <p className="text-xs text-[var(--service-muted)] leading-relaxed">
              {ar
                ? `هل أنت متأكد من إلغاء التفويض الإداري للمستخدم ${confirmRevokeAdmin.fullName} (${confirmRevokeAdmin.userId})؟ سيُطلب إلغاء التفويض من الخادم.`
                : `Are you sure you want to revoke platform administration for ${confirmRevokeAdmin.fullName} (${confirmRevokeAdmin.userId})? The server will be asked to revoke the role.`}
            </p>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--service-line)]">
              <button
                type="button"
                onClick={() => setConfirmRevokeAdmin(null)}
                className="rounded-xl border border-[var(--service-line)] px-4 py-2 text-xs font-semibold text-[var(--service-muted)] hover:bg-[var(--service-subtle)]"
              >
                {ar ? "تراجع" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={handleRevoke}
                disabled={isPending}
                className="rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
              >
                {isPending ? (ar ? "جارٍ الإلغاء..." : "Revoking...") : ar ? "تأكيد الإلغاء الفوري" : "Revoke Immediately"}
              </button>
            </div>
          </div>
        </AccessibleDialog>
      )}
    </div>
  );
}
