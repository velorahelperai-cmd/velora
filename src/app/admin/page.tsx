import type { Metadata } from "next";
import {companyListFilters,companyListReturnHref} from "@/components/app/admin-company-navigation";
import { AdminList } from "@/components/app/admin-list";
import { adminGetOverviewStats } from "@/lib/tenancy/actions";
import {readAdminTruth} from "@/lib/answers/runtime/admin-truth";

export const metadata: Metadata = { title: "Velora Admin" };

export default async function Page({searchParams}: {searchParams?:Promise<Record<string,string|string[]|undefined>>} = {}) {
  const filters=companyListFilters(await searchParams??{});
  const [overview,truth] = await Promise.all([adminGetOverviewStats(),readAdminTruth()]);
  return (
    <AdminList
      key={companyListReturnHref(filters)}
      initialCompanyFilters={filters}
      initialOverview={overview.ok ? overview.data : null}
      initialTruth={truth.ok?truth.data:null}
      overviewUnavailable={
        !overview.ok
          ? { code: overview.code, message: overview.message ?? null }
          : null
      }
    />
  );
}
