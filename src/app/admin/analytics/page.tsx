import type { Metadata } from "next";
import { adminGetFinancialAnalytics } from "@/lib/tenancy/analytics-actions";
import { AdminFinancialAnalytics } from "@/components/admin/admin-financial-analytics";
import { AccessGate } from "@/components/app/access-gate";

export const metadata: Metadata = {
  title: "Financial & Platform Analytics · Velora Admin",
};

export default async function AnalyticsPage() {
  const result = await adminGetFinancialAnalytics();

  if (!result.ok) {
    return <AccessGate code={result.code === "FORBIDDEN" ? "FORBIDDEN" : "UNAVAILABLE"} />;
  }

  return <AdminFinancialAnalytics data={result.data} />;
}
