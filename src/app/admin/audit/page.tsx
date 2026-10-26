import type { Metadata } from "next";
import { adminGetAuditLogsOverview } from "@/lib/tenancy/audit-actions";
import { AdminAuditCompliance } from "@/components/admin/admin-audit-compliance";
import { AccessGate } from "@/components/app/access-gate";

export const metadata: Metadata = {
  title: "Velora Admin - Audit & Compliance",
};

export interface AuditPageProps {
  searchParams?: Promise<{
    action?: string;
    category?: string;
    companyId?: string;
    search?: string;
    limit?: string;
    offset?: string;
  }>;
}

export default async function AuditPage(props: AuditPageProps) {
  const resolvedParams = props.searchParams ? await props.searchParams : undefined;
  const filter = resolvedParams
    ? {
        action: resolvedParams.action,
        category: resolvedParams.category,
        companyId: resolvedParams.companyId,
        search: resolvedParams.search,
        limit: resolvedParams.limit ? parseInt(resolvedParams.limit, 10) : undefined,
        offset: resolvedParams.offset ? parseInt(resolvedParams.offset, 10) : undefined,
      }
    : undefined;

  const result = await adminGetAuditLogsOverview(filter);

  if (!result.ok) {
    return <AccessGate code={result.code === "FORBIDDEN" ? "FORBIDDEN" : "UNAVAILABLE"} />;
  }

  return <AdminAuditCompliance key={JSON.stringify(filter)} data={result.data} initialFilter={filter} />;
}
