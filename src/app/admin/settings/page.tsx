import type { Metadata } from "next";
import { adminGetPlatformSettingsOverview } from "@/lib/tenancy/settings-actions";
import { AdminPlatformSettings } from "@/components/admin/admin-platform-settings";
import { AccessGate } from "@/components/app/access-gate";

export const metadata: Metadata = {
  title: "Platform Settings & Automations · Velora Admin",
};

export default async function SettingsPage() {
  const result = await adminGetPlatformSettingsOverview();

  if (!result.ok) {
    return <AccessGate code={result.code === "FORBIDDEN" ? "FORBIDDEN" : "UNAVAILABLE"} />;
  }

  return <AdminPlatformSettings data={result.data} />;
}
