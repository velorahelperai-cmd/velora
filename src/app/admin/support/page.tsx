import type { Metadata } from "next";
import { adminGetSupportOverview } from "@/lib/tenancy/support-actions";
import { AdminSupportReviews } from "@/components/admin/admin-support-reviews";
import { AccessGate } from "@/components/app/access-gate";

export const metadata: Metadata = {
  title: "Velora Admin - Customer Support & Reviews",
};

export default async function SupportPage() {
  const result = await adminGetSupportOverview();

  if (!result.ok) {
    return <AccessGate code={result.code === "FORBIDDEN" ? "FORBIDDEN" : "UNAVAILABLE"} />;
  }

  return <AdminSupportReviews data={result.data} />;
}
