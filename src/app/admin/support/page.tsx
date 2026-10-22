import type { Metadata } from "next";
import { adminGetSupportOverview } from "@/lib/tenancy/support-actions";
import { AdminSupportReviews } from "@/components/admin/admin-support-reviews";
import { AccessGate } from "@/components/app/access-gate";

export const metadata: Metadata = {
  title: "Velora Admin - Customer Support & Reviews",
};

export interface SupportPageProps {
  searchParams?: Promise<{
    status?: string;
    priority?: string;
    search?: string;
    offset?: string;
    limit?: string;
  }>;
}

export default async function SupportPage(props: SupportPageProps) {
  const resolvedParams = props.searchParams ? await props.searchParams : undefined;
  const result = await adminGetSupportOverview({ ...resolvedParams,
    offset: resolvedParams?.offset === undefined ? 0 : Number(resolvedParams.offset),
    limit: resolvedParams?.limit === undefined ? 50 : Number(resolvedParams.limit),
  });

  if (!result.ok) {
    return <AccessGate code={result.code === "FORBIDDEN" ? "FORBIDDEN" : "UNAVAILABLE"} />;
  }

  return <AdminSupportReviews data={result.data} filters={resolvedParams} />;
}
