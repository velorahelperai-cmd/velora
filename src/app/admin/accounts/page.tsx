import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AccessGate } from "@/components/app/access-gate";
import { requirePlatformOwner } from "@/lib/tenancy/access";
import { adminSearchAccounts } from "@/lib/tenancy/actions";
import { AdminAccountsDirectory, AdminAccountsHeading } from "@/components/admin/admin-accounts-directory";

export const metadata: Metadata = { title: "Accounts & Identity Hub · Velora Admin" };

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

async function AccountsContent({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const query = typeof sp.q === "string" ? sp.q : "";
  const offset = typeof sp.offset === "string" ? Math.max(0, parseInt(sp.offset, 10) || 0) : 0;
  const limit = 20;

  const res = await adminSearchAccounts({
    query,
    offset,
    limit,
  });

  if (!res.ok) {
    if (res.code === "UNAVAILABLE") {
      return (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center text-sm text-red-800">
          <p className="font-bold">تعذر تحميل بيانات الحسابات من الخادم</p>
          <p className="mt-1 text-xs text-red-600">{res.message || "يرجى التحقق من اتصال قاعدة البيانات والمحاولة لاحقاً."}</p>
        </div>
      );
    }
    return <AccessGate code="FORBIDDEN" />;
  }

  const { rows, hasMore, atBrowseWindowEnd, maxOffset } = res.data;

  return (
    <AdminAccountsDirectory
      initialQuery={query}
      initialOffset={offset}
      initialLimit={limit}
      accounts={rows}
      hasMore={hasMore}
      atBrowseWindowEnd={atBrowseWindowEnd}
      maxOffset={maxOffset}
    />
  );
}

function AccountsLoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" dir="rtl">
      <div className="h-16 rounded-2xl bg-[var(--service-surface)] border border-[var(--service-line)]" />
      <div className="h-96 rounded-2xl bg-[var(--service-surface)] border border-[var(--service-line)]" />
    </div>
  );
}

export default async function AccountsPage({ searchParams }: PageProps) {
  const admin = await requirePlatformOwner();
  if (!admin.ok) {
    if (admin.code === "UNVERIFIED") redirect("/verify-email");
    if (admin.code === "UNAVAILABLE") return <AccessGate code="UNAVAILABLE" />;
    if (admin.code === "FORBIDDEN") return <AccessGate code="FORBIDDEN" />;
    redirect(`/login?next=${encodeURIComponent("/admin/accounts")}`);
  }

  return (
    <div className="space-y-6">
      <AdminAccountsHeading />

      <Suspense fallback={<AccountsLoadingSkeleton />}>
        <AccountsContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
