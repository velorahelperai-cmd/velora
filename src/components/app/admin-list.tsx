"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppTopBar } from "@/components/app/account-chrome";
import { Button, Notice, useAction, useAppCopy } from "@/components/app/ui";
import { fill } from "@/lib/app-copy";
import { adminListCompanies, adminSearchAccounts } from "@/lib/tenancy/actions";
import type { AdminAccountSearchItem, AdminCompanyListItem, CompanyStatus } from "@/lib/tenancy/types";

const ACCOUNT_PAGE_SIZE = 20;

export function AdminList() {
  const copy = useAppCopy();
  const { busy, run } = useAction();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | CompanyStatus>("all");
  const [rows, setRows] = useState<AdminCompanyListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [accountQuery, setAccountQuery] = useState("");
  const [accountRows, setAccountRows] = useState<AdminAccountSearchItem[]>([]);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountOffset, setAccountOffset] = useState(0);
  const [accountHasMore, setAccountHasMore] = useState(false);
  const searchGen = useRef(0);

  async function load(q = search) {
    setError(null);
    const result = await adminListCompanies(q);
    if (!result.ok) {
      setError(result.message ?? copy.errors.authFailed);
      return;
    }
    setRows(result.data);
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void load("");
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load
  }, []);

  useEffect(() => {
    const q = accountQuery.trim();
    const timer = window.setTimeout(() => {
      if (!q) {
        searchGen.current += 1;
        setAccountRows([]);
        setAccountError(null);
        setAccountBusy(false);
        setAccountOffset(0);
        setAccountHasMore(false);
        return;
      }
      const gen = ++searchGen.current;
      setAccountBusy(true);
      setAccountOffset(0);
      void (async () => {
        try {
          const result = await adminSearchAccounts({
            query: q,
            limit: ACCOUNT_PAGE_SIZE,
            offset: 0,
          });
          if (gen !== searchGen.current) return;
          if (!result.ok) {
            setAccountError(
              result.message === "rate_limited"
                ? copy.admin.accountSearchRateLimited
                : (result.message ?? copy.errors.authFailed),
            );
            setAccountRows([]);
            setAccountHasMore(false);
            return;
          }
          setAccountError(null);
          setAccountRows(result.data);
          setAccountHasMore(result.data.length >= ACCOUNT_PAGE_SIZE);
        } catch {
          if (gen !== searchGen.current) return;
          setAccountError(copy.errors.authFailed);
        } finally {
          if (gen === searchGen.current) setAccountBusy(false);
        }
      })();
    }, q ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [accountQuery, copy.errors.authFailed, copy.admin.accountSearchRateLimited]);

  async function loadAccountPage(nextOffset: number) {
    const q = accountQuery.trim();
    if (!q) return;
    const gen = ++searchGen.current;
    setAccountBusy(true);
    try {
      const result = await adminSearchAccounts({
        query: q,
        limit: ACCOUNT_PAGE_SIZE,
        offset: nextOffset,
      });
      if (gen !== searchGen.current) return;
      if (!result.ok) {
        setAccountError(result.message ?? copy.errors.authFailed);
        return;
      }
      setAccountError(null);
      setAccountRows(result.data);
      setAccountOffset(nextOffset);
      setAccountHasMore(result.data.length >= ACCOUNT_PAGE_SIZE);
    } catch {
      if (gen !== searchGen.current) return;
      setAccountError(copy.errors.authFailed);
    } finally {
      if (gen === searchGen.current) setAccountBusy(false);
    }
  }

  const filtered = useMemo(
    () => (status === "all" ? rows : rows.filter((r) => r.status === status)),
    [rows, status],
  );

  const reviewPending = useMemo(
    () => rows.filter((r) => r.review_status === "pending_review"),
    [rows],
  );

  const pageNumber = Math.floor(accountOffset / ACCOUNT_PAGE_SIZE) + 1;

  return (
    <main className="app-shell px-4 py-6">
      <div className="mx-auto max-w-[1100px]">
        <AppTopBar />
        <div className="mt-6">
          <p className="text-sm text-[#38dc89]">{copy.brand}</p>
          <h1 className="text-3xl font-bold">{copy.admin.title}</h1>
          <p className="mt-1 text-sm text-[#adbeaf]">{copy.admin.body}</p>
        </div>

        <nav className="mt-4 flex flex-wrap gap-2 text-sm" aria-label={copy.admin.title}>
          <a href="#accounts" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-3 hover:bg-white/5">{copy.admin.navAccounts}</a>
          <a href="#companies" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-3 hover:bg-white/5">{copy.admin.navCompanies}</a>
          <a href="#reviews" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-3 hover:bg-white/5">{copy.admin.navReviews}</a>
        </nav>

        <section id="accounts" className="app-panel mt-6 rounded-3xl p-4 sm:p-6">
          <h2 className="text-lg font-bold">{copy.admin.accountsTitle}</h2>
          <p className="mt-1 text-sm text-[#adbeaf]">{copy.admin.accountsBody}</p>
          <input
            value={accountQuery}
            onChange={(e) => setAccountQuery(e.target.value)}
            placeholder={copy.admin.accountSearch}
            className="mt-4 min-h-11 w-full rounded-xl border border-white/15 bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89]"
          />
          {accountBusy ? <p className="mt-3 text-xs text-[#8da195]">{copy.loading}</p> : null}
          {accountError ? <div className="mt-3"><Notice tone="error">{accountError}</Notice></div> : null}
          <ul className="mt-4 grid gap-2">
            {accountRows.map((row) => (
              <li key={row.user_id} className="rounded-2xl border border-white/10 px-4 py-3">
                <strong className="block break-words">{row.full_name || copy.account.unnamed}</strong>
                <p className="mt-1 font-mono text-xs text-[#9af0c3]" dir="ltr">{row.support_code}</p>
                <p className="mt-1 text-xs text-[#adbeaf]" dir="ltr">{row.email || "—"}</p>
                <p className="mt-1 text-xs text-[#8da195]" dir="ltr">{copy.admin.accountPhone}: {row.account_phone || "—"}</p>
                <ul className="mt-2 grid gap-1 text-xs text-[#adbeaf]">
                  {row.companies.length ? row.companies.map((c) => (
                    <li key={`${row.user_id}-${c.company_id}`}>
                      <Link href={`/admin/companies/${c.company_id}`} className="text-[#38dc89] underline">{c.display_name}</Link>
                      {" · "}{c.role}
                      {c.business_phone ? <span dir="ltr"> · {copy.admin.businessPhone}: {c.business_phone}</span> : null}
                    </li>
                  )) : <li>{copy.admin.noCompaniesYet}</li>}
                </ul>
              </li>
            ))}
            {accountQuery.trim() && !accountBusy && !accountRows.length && !accountError ? (
              <li className="text-sm text-[#8da195]">{copy.admin.accountSearchEmpty}</li>
            ) : null}
          </ul>
          {accountQuery.trim() && (accountOffset > 0 || accountHasMore) ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                disabled={accountBusy || accountOffset <= 0}
                onClick={() => void loadAccountPage(Math.max(0, accountOffset - ACCOUNT_PAGE_SIZE))}
              >
                {copy.admin.accountPrev}
              </Button>
              <span className="text-xs text-[#8da195]">{fill(copy.admin.accountPage, { n: pageNumber })}</span>
              <Button
                variant="secondary"
                disabled={accountBusy || !accountHasMore}
                onClick={() => void loadAccountPage(accountOffset + ACCOUNT_PAGE_SIZE)}
              >
                {copy.admin.accountNext}
              </Button>
            </div>
          ) : null}
        </section>

        <section id="companies" className="app-panel mt-6 rounded-3xl p-4 sm:p-6">
          <form
            className="grid gap-3 sm:grid-cols-[1fr_auto_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => load(search));
            }}
          >
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={copy.admin.search}
              className="min-h-11 w-full rounded-xl border border-white/15 bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89]"
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "all" | CompanyStatus)}
              aria-label={copy.admin.statusFilter}
              className="min-h-11 rounded-xl border border-white/15 bg-[#0d1a14] px-3 text-sm"
            >
              <option value="all">{copy.admin.statusAll}</option>
              <option value="setup">{copy.admin.statusSetup}</option>
              <option value="active">{copy.admin.statusActive}</option>
              <option value="suspended">{copy.admin.statusSuspended}</option>
            </select>
            <Button type="submit" busy={busy} busyLabel={copy.loading}>{copy.admin.searchAction}</Button>
          </form>
          {error ? <div className="mt-4"><Notice tone="error">{error}</Notice></div> : null}
          <ul className="mt-5 grid gap-2">
            {filtered.map((row) => (
              <li key={row.id}>
                <Link href={`/admin/companies/${row.id}`} className="block rounded-2xl border border-white/10 px-4 py-3 transition hover:border-[#38dc89]/50 hover:bg-white/5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <strong className="block break-words text-base">{row.display_name}</strong>
                      <p className="mt-1 text-xs text-[#8da195]">{row.business_type} · {row.city || row.country}</p>
                      <p className="mt-1 text-xs text-[#adbeaf]" dir="ltr">{row.owner_email || "—"}</p>
                    </div>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]">
                      {row.status === "setup" ? copy.admin.statusSetup
                        : row.status === "active" ? copy.admin.statusActive
                          : row.status === "suspended" ? copy.admin.statusSuspended
                            : row.status}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
            {!filtered.length ? <li className="text-sm text-[#8da195]">{copy.admin.empty}</li> : null}
          </ul>
        </section>

        <section id="reviews" className="app-panel mt-6 rounded-3xl p-4 sm:p-6">
          <h2 className="text-lg font-bold">{copy.admin.navReviews}</h2>
          <ul className="mt-4 grid gap-2">
            {reviewPending.map((row) => (
              <li key={`review-${row.id}`}>
                <Link href={`/admin/companies/${row.id}`} className="text-sm text-[#38dc89] underline">{row.display_name}</Link>
                {row.review_revision != null ? (
                  <span className="ms-2 text-xs text-[#8da195]">r{row.review_revision}</span>
                ) : null}
              </li>
            ))}
            {!reviewPending.length ? <li className="text-sm text-[#8da195]">{copy.admin.reviewNone ?? copy.admin.empty}</li> : null}
          </ul>
        </section>
      </div>
    </main>
  );
}
