import { Suspense } from "react";
import type { Metadata } from "next";
import { SettingsPage } from "@/components/app/settings";
import { getWhatsappCompanyLink } from "@/lib/whatsapp/connection-actions";
import { singleTenantReceptionStatus, whatsappLiveOpsReady } from "@/lib/whatsapp/config";

export const metadata: Metadata = { title: "Settings · Velora" };

export default async function Page() {
  const linkResult = await getWhatsappCompanyLink();
  const singleTenant = singleTenantReceptionStatus();
  return (
    <Suspense fallback={<main className="min-h-svh bg-[#07110d]" aria-busy="true" />}>
      <SettingsPage
        initialWhatsappLink={linkResult.ok ? linkResult.data : null}
        whatsappLinkLoadFailed={!linkResult.ok && linkResult.code !== "FORBIDDEN" && linkResult.code !== "UNAUTHENTICATED"}
        whatsappLiveOpsReady={whatsappLiveOpsReady()}
        singleTenantReception={singleTenant}
      />
    </Suspense>
  );
}
