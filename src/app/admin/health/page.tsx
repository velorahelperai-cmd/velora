import type { Metadata } from "next";
import { adminGetPlatformHealthOverview } from "@/lib/tenancy/health-actions";
import { AdminPlatformHealth } from "@/components/admin/admin-platform-health";
import { AccessGate } from "@/components/app/access-gate";

export const metadata: Metadata = {
  title: "Platform Readiness & Health · Velora Admin",
};

export default async function PlatformHealthPage() {
  const result = await adminGetPlatformHealthOverview();

  if (!result.ok) {
    return <AccessGate code={result.code === "FORBIDDEN" ? "FORBIDDEN" : "UNAVAILABLE"} />;
  }

  return <AdminPlatformHealth data={result.data} />;
}
