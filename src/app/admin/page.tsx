import type { Metadata } from "next";
import { AdminList } from "@/components/app/admin-list";
import { adminGetOverviewStats } from "@/lib/tenancy/actions";

export const metadata: Metadata = { title: "Velora Admin" };

export default async function Page() {
  const overview = await adminGetOverviewStats();
  return (
    <AdminList
      initialOverview={overview.ok ? overview.data : null}
      overviewUnavailable={
        !overview.ok
          ? { code: overview.code, message: overview.message ?? null }
          : null
      }
    />
  );
}
