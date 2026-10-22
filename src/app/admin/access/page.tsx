import type { Metadata } from "next";
import { adminGetPlatformAccessOverview } from "@/lib/tenancy/access-actions";
import { AdminPlatformAccess } from "@/components/admin/admin-platform-access";
import { AccessGate } from "@/components/app/access-gate";

export const metadata: Metadata = {
  title: "Access Control & Platform Teams · Velora Admin",
};

export default async function AccessPage() {
  const result = await adminGetPlatformAccessOverview();

  if (!result.ok) {
    return <AccessGate code={result.code === "FORBIDDEN" ? "FORBIDDEN" : "UNAVAILABLE"} />;
  }

  return <AdminPlatformAccess data={result.data} />;
}
