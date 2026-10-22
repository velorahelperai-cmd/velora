import type { Metadata } from "next";
import { adminGetOperationsOverview } from "@/lib/tenancy/operations-actions";
import { AdminOperationsCenter } from "@/components/admin/admin-operations-center";
import { AccessGate } from "@/components/app/access-gate";

export const metadata: Metadata = {
  title: "Velora Admin - Operations & Incident Center",
};

export interface OperationsPageProps {
  searchParams?:
    | Promise<{
        correlationId?: string;
        service?: string;
        severity?: string;
      }>
    ;
}

export default async function OperationsPage(props: OperationsPageProps) {
  const resolvedParams = props.searchParams ? await props.searchParams : undefined;
  const result = await adminGetOperationsOverview(resolvedParams);

  if (!result.ok) {
    return <AccessGate code={result.code === "FORBIDDEN" ? "FORBIDDEN" : "UNAVAILABLE"} />;
  }

  return <AdminOperationsCenter data={result.data} />;
}
