import type { Metadata } from "next";
import { AdminList } from "@/components/app/admin-list";
import { adminGetOverviewStats } from "@/lib/tenancy/actions";
import {readAdminTruth} from "@/lib/answers/runtime/admin-truth";

export const metadata: Metadata = { title: "Velora Admin" };

export default async function Page() {
  const [overview,truth] = await Promise.all([adminGetOverviewStats(),readAdminTruth()]);
  return (
    <AdminList
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
