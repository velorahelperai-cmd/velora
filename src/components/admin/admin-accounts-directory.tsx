"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AdminAccountSearchItem } from "@/lib/tenancy/types";
import { AccountDeletionPanel } from './account-deletion-panel';

export interface AdminAccountsDirectoryProps {
  initialQuery?: string;
  initialOffset?: number;
  initialLimit?: number;
  accounts: AdminAccountSearchItem[];
  hasMore: boolean;
  atBrowseWindowEnd?: boolean;
  maxOffset?: number;
}

export function AdminAccountsDirectory({
  initialQuery = "",
  initialOffset = 0,
  initialLimit = 20,
  accounts,
  hasMore,
  atBrowseWindowEnd = false,
  maxOffset = 500,
}: AdminAccountsDirectoryProps) {
  const router = useRouter();
  const [search, setSearch] = useState(initialQuery);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSearching(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    params.set("offset", "0");
    router.push(`/admin/accounts?${params.toString()}`);
  };

  const handlePageChange = (newOffset: number) => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    params.set("offset", String(Math.max(0, newOffset)));
    router.push(`/admin/accounts?${params.toString()}`);
  };

  const startIndex = initialOffset + 1;
  const endIndex = initialOffset + accounts.length;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Search Header */}
      <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
        <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[260px]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="البحث بالاسم، البريد، الهاتف، أو كود الدعم (Support Code)..."
              className="w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-4 py-2.5 text-sm text-[var(--service-ink)] placeholder-[var(--service-muted)] outline-none focus:border-[var(--service-accent)] focus:ring-1 focus:ring-[var(--service-accent)] transition"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  router.push("/admin/accounts");
                }}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--service-muted)] hover:text-[var(--service-ink)]"
              >
                مسح
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={isSearching}
            className="rounded-xl bg-[var(--service-accent)] px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:opacity-95 transition disabled:opacity-50"
          >
            {isSearching ? "جارِ البحث..." : "بحث"}
          </button>
          {initialQuery && (
            <Link
              href="/admin/accounts"
              className="rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] px-4 py-2.5 text-xs font-semibold text-[var(--service-ink)] hover:bg-[var(--service-subtle)] transition"
            >
              إعادة الضبط
            </Link>
          )}
        </form>
      </div>

      {/* Accounts Directory Table */}
      {accounts.length === 0 ? (
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-12 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--service-subtle)] text-[var(--service-muted)]">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <h3 className="mt-4 text-base font-bold text-[var(--service-ink)]">
            لا توجد حسابات مطابقة
          </h3>
          <p className="mt-1 text-sm text-[var(--service-muted)]">
            لم يتم العثور على أي حسابات بالمعايير المحددة. جرب كلمة بحث أخرى.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b border-[var(--service-line)] bg-[var(--service-subtle)] text-xs font-bold text-[var(--service-muted)]">
                <tr>
                  <th className="px-5 py-3.5">المستخدم وكود الدعم</th>
                  <th className="px-5 py-3.5">البريد وحالة التوثيق</th>
                  <th className="px-5 py-3.5">الهاتف الموثق</th>
                  <th className="px-5 py-3.5">المنشآت المرتبطة</th>
                  <th className="px-5 py-3.5 text-left">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--service-line)]">
                {accounts.map((acc) => (
                  <tr key={acc.user_id} className="hover:bg-[var(--service-canvas)]/50 transition">
                    <td className="px-5 py-4">
                      <div className="font-bold text-[var(--service-ink)]">
                        {acc.full_name || "بدون اسم مسجل"}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 font-mono text-xs text-[var(--service-muted)]">
                        <span>{acc.support_code || acc.user_id.slice(0, 12)}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-mono text-xs text-[var(--service-ink)]" dir="ltr">
                        {acc.email || "—"}
                      </div>
                      <div className="mt-1">
                        {acc.email_confirmed === true ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--service-success)]/10 px-2 py-0.5 text-[11px] font-semibold text-[var(--service-success)] border border-[var(--service-success)]/20">
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                            مؤكد
                          </span>
                        ) : acc.email_confirmed === false ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 border border-amber-500/20">
                            غير مؤكد
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                            غير محدد
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {acc.account_phone ? (
                        <span className="font-mono text-xs text-[var(--service-ink)]" dir="ltr">
                          {acc.account_phone}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--service-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {acc.companies.length === 0 ? (
                        <span className="text-xs text-[var(--service-muted)]">لا توجد منشأة</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 max-w-xs">
                          {acc.companies.map((c) => (
                            <Link
                              key={c.company_id}
                              href={`/admin/companies/${c.company_id}`}
                              className="inline-flex items-center gap-1 rounded-lg border border-[var(--service-line)] bg-[var(--service-subtle)] px-2 py-1 text-xs text-[var(--service-ink)] hover:border-[var(--service-accent)] transition"
                            >
                              <span className="font-medium truncate max-w-[120px]">{c.display_name}</span>
                              <span className="rounded bg-[var(--service-surface)] px-1 text-[10px] text-[var(--service-muted)]">
                                {c.role === "owner" ? "مالك" : "عضو"}
                              </span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-left">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/identity-recovery?userId=${acc.user_id}`}
                          className="rounded-lg border border-[var(--service-line)] bg-[var(--service-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--service-ink)] hover:bg-[var(--service-subtle)] transition"
                        >
                          استرداد الهوية
                        </Link>
                        <AccountDeletionPanel key={acc.user_id} target={acc.user_id} email={acc.email}/>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--service-line)] bg-[var(--service-subtle)] px-5 py-3 text-xs text-[var(--service-muted)]">
            <div>
              عرض <span className="font-bold text-[var(--service-ink)]">{startIndex}</span> إلى{" "}
              <span className="font-bold text-[var(--service-ink)]">{endIndex}</span> حساب
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={initialOffset === 0}
                onClick={() => handlePageChange(initialOffset - initialLimit)}
                className="rounded-lg border border-[var(--service-line)] bg-[var(--service-surface)] px-3 py-1.5 font-bold text-[var(--service-ink)] hover:bg-[var(--service-canvas)] transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← السابق
              </button>
              <button
                type="button"
                disabled={!hasMore}
                onClick={() => handlePageChange(initialOffset + initialLimit)}
                className="rounded-lg border border-[var(--service-line)] bg-[var(--service-surface)] px-3 py-1.5 font-bold text-[var(--service-ink)] hover:bg-[var(--service-canvas)] transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                التالي →
              </button>
            </div>
          </div>
        </div>
      )}

      {atBrowseWindowEnd && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-800">
          تم الوصول إلى الحد الأقصى للتصفح المتسلسل ({maxOffset} حساب). يرجى استخدام شريط البحث لتحديد حسابات معينة بدقة.
        </div>
      )}
    </div>
  );
}
