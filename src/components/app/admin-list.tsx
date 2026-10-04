"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { clearCompanyDrafts } from "@/lib/company-draft";
import { createClient } from "@/lib/supabase/client";
import { adminListCompanies, signOut } from "@/lib/tenancy/actions";
import type { AdminCompanyListItem, CompanyStatus } from "@/lib/tenancy/types";
import { Button, LangSwitch, Notice, useAction, useAppCopy } from "@/components/app/ui";

export function AdminList() {
  const copy = useAppCopy();
  const router = useRouter();
  const { busy, run } = useAction();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | CompanyStatus>("all");
  const [rows, setRows] = useState<AdminCompanyListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  const filtered = useMemo(
    () => (status === "all" ? rows : rows.filter((r) => r.status === status)),
    [rows, status],
  );

  return (
    <main className="min-h-svh bg-[#07110d] px-4 py-6 text-[#f7fbf8]">
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-[#38dc89]">{copy.brand}</p>
          <h1 className="text-3xl font-bold">{copy.admin.title}</h1>
          <p className="mt-1 text-sm text-[#adbeaf]">{copy.admin.body}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LangSwitch />
          <Button
            variant="secondary"
            onClick={() => void run(async () => {
              let userId: string | undefined;
              try {
                const supabase = createClient();
                const { data } = await supabase.auth.getUser();
                userId = data.user?.id;
              } catch {
                /* signOut remains authoritative */
              }
              const result = await signOut();
              if (!result.ok) {
                setError(result.message ?? copy.auth.logoutFailed);
                return;
              }
              if (userId) clearCompanyDrafts(userId);
              router.replace("/login");
              router.refresh();
            })}
          >
            {copy.logout}
          </Button>
        </div>
      </div>

      <section className="mx-auto mt-6 max-w-[1100px] rounded-3xl border border-white/10 bg-[#0d1a14] p-4 sm:p-6">
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
              <Link
                href={`/admin/companies/${row.id}`}
                className="block rounded-2xl border border-white/10 px-4 py-3 transition hover:border-[#38dc89]/50 hover:bg-white/5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <strong className="block break-words text-base">{row.display_name}</strong>
                    <p className="mt-1 text-xs text-[#8da195]">{row.business_type} · {row.city || row.country}</p>
                    <p className="mt-1 text-xs text-[#adbeaf]" dir="ltr">{row.owner_email || "—"}</p>
                  </div>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]">
                    {row.status === "setup"
                      ? copy.admin.statusSetup
                      : row.status === "active"
                        ? copy.admin.statusActive
                        : row.status === "suspended"
                          ? copy.admin.statusSuspended
                          : row.status}
                  </span>
                </div>
              </Link>
            </li>
          ))}
          {!filtered.length ? <li className="text-sm text-[#8da195]">{copy.admin.empty}</li> : null}
        </ul>
      </section>
    </main>
  );
}
