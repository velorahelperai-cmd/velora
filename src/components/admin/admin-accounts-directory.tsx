"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useDemo } from "@/lib/demo-state";
import { useRouter } from "next/navigation";
import type { AdminAccountSearchItem } from "@/lib/tenancy/types";
import { AccountDeletionPanel } from './account-deletion-panel';
import styles from "./admin-accounts-directory.module.css";

const ACCOUNT_STATUS_FILTERS = ["all", "active", "setup", "none", "verified", "unconfirmed"] as const;
const ACCOUNT_SORTS = ["default", "name_asc", "name_desc", "companies_desc"] as const;

export type AccountStatusFilter = (typeof ACCOUNT_STATUS_FILTERS)[number];
export type AccountSort = (typeof ACCOUNT_SORTS)[number];

export function accountStatusFilter(value: string | string[] | undefined): AccountStatusFilter {
  return typeof value === "string" && (ACCOUNT_STATUS_FILTERS as readonly string[]).includes(value)
    ? value as AccountStatusFilter
    : "all";
}

export function accountSortOrder(value: string | string[] | undefined): AccountSort {
  return typeof value === "string" && (ACCOUNT_SORTS as readonly string[]).includes(value)
    ? value as AccountSort
    : "default";
}

function subscriptionStatus(account: AdminAccountSearchItem): "active" | "setup" | "none" {
  for (const company of account.companies) {
    if (company.company_status === "active") return "active";
  }
  for (const company of account.companies) {
    if (company.company_status === "setup") return "setup";
  }
  return "none";
}

function listedPhone(account: AdminAccountSearchItem): { value: string; source: "account" | "business" } | null {
  if (account.account_phone?.trim()) return { value: account.account_phone.trim(), source: "account" };
  for (const company of account.companies) {
    if (company.business_phone?.trim()) return { value: company.business_phone.trim(), source: "business" };
  }
  return null;
}

export interface AdminAccountsDirectoryProps {
  initialQuery?: string;
  initialOffset?: number;
  initialLimit?: number;
  accounts: AdminAccountSearchItem[];
  hasMore: boolean;
  atBrowseWindowEnd?: boolean;
  maxOffset?: number;
  statusFilter?: AccountStatusFilter;
  sortOrder?: AccountSort;
}

export function AdminAccountsHeading() {
  const { locale } = useDemo();
  const ar = locale === "ar";
  return (
    <header className="border-b border-[var(--service-line)] pb-4" dir={ar ? "rtl" : "ltr"}>
      <h1 className="text-2xl font-bold text-[var(--service-ink)]">{ar ? "الحسابات والمستخدمون" : "Accounts and users"}</h1>
      <p className="mt-1 text-sm text-[var(--service-muted)]">{ar ? "الحسابات وحالة التوثيق والمنشآت المرتبطة واسترداد الهوية." : "Accounts, verification status, linked businesses and identity recovery."}</p>
    </header>
  );
}

export function AdminAccountsDirectory({
  initialQuery = "",
  initialOffset = 0,
  initialLimit = 20,
  accounts,
  hasMore,
  atBrowseWindowEnd = false,
  maxOffset = 500,
  statusFilter = "all",
  sortOrder = "default",
}: AdminAccountsDirectoryProps) {
  const router = useRouter();
  const { locale } = useDemo();
  const ar = locale === "ar";
  const [search, setSearch] = useState(initialQuery);
  const [previousQuery, setPreviousQuery] = useState(initialQuery);
  const [isSearching, startTransition] = useTransition();
  if (previousQuery !== initialQuery) {
    setPreviousQuery(initialQuery);
    setSearch(initialQuery);
  }

  const listHref = (next: { query: string; offset: number; status?: AccountStatusFilter; sort?: AccountSort; keepOffset?: boolean }) => {
    const params = new URLSearchParams();
    const query = next.query.trim();
    const offset = Math.max(0, next.offset);
    const status = next.status ?? statusFilter;
    const sort = next.sort ?? sortOrder;
    if (query) params.set("q", query);
    if (next.keepOffset !== false || offset > 0) params.set("offset", String(offset));
    if (status !== "all") params.set("status", status);
    if (sort !== "default") params.set("sort", sort);
    const searchText = params.toString();
    return searchText ? `/admin/accounts?${searchText}` : "/admin/accounts";
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(() => router.push(listHref({ query: search, offset: 0 })));
  };

  const handlePageChange = (newOffset: number) => {
    startTransition(() => router.push(listHref({ query: initialQuery, offset: newOffset })));
  };

  const visibleAccounts = useMemo(() => {
    let list = accounts.filter((account) => {
      if (statusFilter === "active" || statusFilter === "setup" || statusFilter === "none") {
        return subscriptionStatus(account) === statusFilter;
      }
      if (statusFilter === "verified") return account.email_confirmed === true;
      if (statusFilter === "unconfirmed") return account.email_confirmed !== true;
      return true;
    });
    const collation = ar ? "ar" : "en";
    if (sortOrder === "name_asc" || sortOrder === "name_desc") {
      list = [...list].sort((a, b) => {
        const compared = (a.full_name || a.email || "").localeCompare(b.full_name || b.email || "", collation);
        return sortOrder === "name_asc" ? compared : -compared;
      });
    } else if (sortOrder === "companies_desc") {
      list = [...list].sort((a, b) => b.companies.length - a.companies.length);
    }
    return list;
  }, [accounts, statusFilter, sortOrder, ar]);

  const startIndex = initialOffset + 1;
  const endIndex = initialOffset + accounts.length;
  const filtersActive = statusFilter !== "all" || sortOrder !== "default";

  return (
    <div className={`space-y-6 ${styles.directory}`} dir={ar ? "rtl" : "ltr"}>
      <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
        <form onSubmit={handleSearchSubmit} aria-busy={isSearching} className="flex flex-wrap items-end gap-3">
          <div className="relative flex-1 min-w-0 basis-64">
            <label htmlFor="admin-account-search" className="mb-2 block text-sm font-medium text-[var(--service-ink)]">{ar ? "البحث عن حساب" : "Search accounts"}</label>
            <input
              id="admin-account-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={ar ? "اسم، بريد، هاتف أو كود دعم" : "Name, email, phone or support code"}
              className="w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] ps-4 pe-16 py-2.5 text-sm text-[var(--service-ink)] placeholder-[var(--service-muted)] outline-none focus:border-[var(--service-accent)] focus:ring-1 focus:ring-[var(--service-accent)] transition"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  startTransition(() => router.push(listHref({ query: "", offset: 0, keepOffset: false })));
                }}
                className="absolute end-3 bottom-3 text-xs text-[var(--service-muted)] hover:text-[var(--service-ink)]"
              >
                {ar ? "مسح" : "Clear"}
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={isSearching}
            className="rounded-xl bg-[var(--service-accent)] px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:opacity-95 transition disabled:opacity-50"
          >
            {isSearching ? (ar ? "جارِ البحث..." : "Searching...") : (ar ? "بحث" : "Search")}
          </button>
          {initialQuery && (
            <Link
              href="/admin/accounts"
              className="rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] px-4 py-2.5 text-xs font-semibold text-[var(--service-ink)] hover:bg-[var(--service-subtle)] transition"
            >
              {ar ? "إعادة الضبط" : "Reset"}
            </Link>
          )}
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            aria-label={ar ? "تصفية الحسابات" : "Filter accounts"}
            onChange={(event) => startTransition(() => router.push(listHref({
              query: initialQuery,
              offset: initialOffset,
              status: accountStatusFilter(event.target.value),
            })))}
            className="min-h-11 rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 text-xs font-bold text-[var(--service-ink)]"
          >
            <option value="all">{ar ? "كل الحالات" : "All statuses"}</option>
            <option value="active">{ar ? "مشترك نشط" : "Active subscriber"}</option>
            <option value="setup">{ar ? "قيد التجهيز" : "Setup in progress"}</option>
            <option value="none">{ar ? "غير مشترك" : "Unsubscribed"}</option>
            <option value="verified">{ar ? "بريد مؤكّد" : "Email verified"}</option>
            <option value="unconfirmed">{ar ? "بريد غير مؤكّد" : "Email unconfirmed"}</option>
          </select>
          <select
            value={sortOrder}
            aria-label={ar ? "ترتيب الحسابات" : "Sort accounts"}
            onChange={(event) => startTransition(() => router.push(listHref({
              query: initialQuery,
              offset: initialOffset,
              sort: accountSortOrder(event.target.value),
            })))}
            className="min-h-11 rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 text-xs font-bold text-[var(--service-ink)]"
          >
            <option value="default">{ar ? "الترتيب الافتراضي" : "Default order"}</option>
            <option value="name_asc">{ar ? "الاسم: أ - ي" : "Name: A to Z"}</option>
            <option value="name_desc">{ar ? "الاسم: ي - أ" : "Name: Z to A"}</option>
            <option value="companies_desc">{ar ? "الأكثر شركات" : "Most companies"}</option>
          </select>
          {filtersActive && (
            <button
              type="button"
              onClick={() => startTransition(() => router.push(listHref({ query: initialQuery, offset: initialOffset, status: "all", sort: "default" })))}
              className="min-h-11 rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] px-3 text-xs font-bold text-[var(--service-ink)]"
            >
              {ar ? "إعادة تعيين التصفية" : "Reset filters"}
            </button>
          )}
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-12 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--service-subtle)] text-[var(--service-muted)]">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <h3 className="mt-4 text-base font-bold text-[var(--service-ink)]">
            {ar ? "لا توجد حسابات مطابقة" : "No matching accounts"}
          </h3>
          <p className="mt-1 text-sm text-[var(--service-muted)]">
            {ar ? "لم يتم العثور على أي حسابات بالمعايير المحددة. جرب كلمة بحث أخرى." : "No accounts matched these criteria. Try another search."}
          </p>
          {initialOffset > 0 && (
            <button type="button" onClick={() => handlePageChange(initialOffset - initialLimit)} disabled={isSearching} className={styles.previousEmpty}>
              {ar ? "العودة للصفحة السابقة" : "Return to previous page"}
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] shadow-sm overflow-hidden">
          <div className="overflow-x-auto" role="region" aria-label={ar ? "جدول الحسابات" : "Accounts table"} tabIndex={0}>
            <table className="w-full text-start text-sm">
              <thead className="border-b border-[var(--service-line)] bg-[var(--service-subtle)] text-xs font-bold text-[var(--service-muted)]">
                <tr>
                  <th scope="col" className="px-5 py-3.5">{ar ? "المستخدم وكود الدعم" : "User and support code"}</th>
                  <th scope="col" className="px-5 py-3.5">{ar ? "البريد وحالة التوثيق" : "Email and verification"}</th>
                  <th scope="col" className="px-5 py-3.5">{ar ? "الهاتف" : "Phone"}</th>
                  <th scope="col" className="px-5 py-3.5">{ar ? "الاشتراك" : "Subscription"}</th>
                  <th scope="col" className="px-5 py-3.5">{ar ? "المنشآت المرتبطة" : "Linked businesses"}</th>
                  <th scope="col" className="px-5 py-3.5 text-end">{ar ? "إجراءات" : "Actions"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--service-line)]">
                {visibleAccounts.map((acc) => {
                  const phone = listedPhone(acc);
                  const subscription = subscriptionStatus(acc);
                  return (
                  <tr key={acc.user_id} className="hover:bg-[var(--service-canvas)]/50 transition">
                    <td className="px-5 py-4">
                      <div className="font-bold text-[var(--service-ink)]">
                        <bdi>{acc.full_name || (ar ? "بدون اسم مسجل" : "No name recorded")}</bdi>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 font-mono text-xs text-[var(--service-muted)]">
                        <bdi dir="ltr">{acc.support_code || acc.user_id.slice(0, 12)}</bdi>
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
                            {ar ? "مؤكد" : "Verified"}
                          </span>
                        ) : acc.email_confirmed === false ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 border border-amber-500/20">
                            {ar ? "غير مؤكد" : "Unverified"}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                            {ar ? "غير محدد" : "Unknown"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {phone ? (
                        <div>
                          <span className="font-mono text-xs text-[var(--service-ink)]" dir="ltr">{phone.value}</span>
                          {phone.source === "business" && (
                            <div className="mt-1 text-[11px] text-[var(--service-muted)]">{ar ? "هاتف المنشأة" : "Business phone"}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--service-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-xs font-semibold text-[var(--service-ink)]">
                        {subscription === "active"
                          ? (ar ? "مشترك نشط" : "Active")
                          : subscription === "setup"
                            ? (ar ? "قيد التجهيز" : "Setup")
                            : (ar ? "غير مشترك" : "Unsubscribed")}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {acc.companies.length === 0 ? (
                        <span className="text-xs text-[var(--service-muted)]">{ar ? "لا توجد منشأة" : "No business"}</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 max-w-xs">
                          {acc.companies.map((c) => (
                            <Link
                              key={c.company_id}
                              href={`/admin/companies/${c.company_id}`}
                              className="inline-flex items-center gap-1 rounded-lg border border-[var(--service-line)] bg-[var(--service-subtle)] px-2 py-1 text-xs text-[var(--service-ink)] hover:border-[var(--service-accent)] transition"
                            >
                              <bdi className="font-medium truncate max-w-[120px]">{c.display_name}</bdi>
                              <span className="rounded bg-[var(--service-surface)] px-1 text-[10px] text-[var(--service-muted)]">
                                {c.role === "owner" ? (ar ? "مالك" : "Owner") : (ar ? "عضو" : "Member")}
                              </span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-end">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Link
                          href={`/admin/identity-recovery?userId=${acc.user_id}`}
                          className="rounded-lg border border-[var(--service-line)] bg-[var(--service-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--service-ink)] hover:bg-[var(--service-subtle)] transition"
                        >
                          {ar ? "استرداد الهوية" : "Recover identity"}
                        </Link>
                        <AccountDeletionPanel key={acc.user_id} target={acc.user_id} email={acc.email}/>
                      </div>
                    </td>
                  </tr>
                  );
                })}
                {visibleAccounts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-sm text-[var(--service-muted)]">
                      {ar ? "لا توجد حسابات مطابقة في هذه الصفحة." : "No accounts on this page match the filter."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--service-line)] bg-[var(--service-subtle)] px-5 py-3 text-xs text-[var(--service-muted)]">
            <div>
              {ar ? "عرض" : "Showing"} <span className="font-bold text-[var(--service-ink)]">{startIndex}</span> {ar ? "إلى" : "to"}{" "}
              <span className="font-bold text-[var(--service-ink)]">{endIndex}</span> {ar ? "حساب" : "accounts"}
              {filtersActive && (
                <span> · {ar ? "بعد التصفية" : "after filtering"} {visibleAccounts.length}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={initialOffset === 0}
                onClick={() => handlePageChange(initialOffset - initialLimit)}
                className="rounded-lg border border-[var(--service-line)] bg-[var(--service-surface)] px-3 py-1.5 font-bold text-[var(--service-ink)] hover:bg-[var(--service-canvas)] transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {ar ? "← السابق" : "Previous"}
              </button>
              <button
                type="button"
                disabled={!hasMore}
                onClick={() => handlePageChange(initialOffset + initialLimit)}
                className="rounded-lg border border-[var(--service-line)] bg-[var(--service-surface)] px-3 py-1.5 font-bold text-[var(--service-ink)] hover:bg-[var(--service-canvas)] transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {ar ? "التالي →" : "Next"}
              </button>
            </div>
          </div>
        </div>
      )}

      {atBrowseWindowEnd && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-800">
          {ar ? `تم الوصول إلى الحد الأقصى للتصفح المتسلسل (${maxOffset} حساب). يرجى استخدام البحث لتحديد حسابات معينة.` : `The browsing limit (${maxOffset} accounts) was reached. Use search to find specific accounts.`}
        </div>
      )}
    </div>
  );
}
