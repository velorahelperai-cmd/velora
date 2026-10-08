import { loadOwnerBillingSubscription } from "@/lib/billing/wiring/subscription-read";
import { Suspense } from "react";
import type { Metadata } from "next";
import { getCompanyAccess } from "@/lib/tenancy/access";
import { readPublicCatalogBackend } from "@/lib/billing/catalog-backend/rpc";
import { offersViewFromCatalog } from "@/components/app/subscription-offers-view";
import { readCompanyEntitlement } from "@/lib/billing/entitlement";
import { subscriptionViewFromEntitlement } from "@/components/app/subscription-model";
import { SettingsPage } from "@/components/app/settings";
import { getWhatsappCompanyLink } from "@/lib/whatsapp/connection-actions";
import { singleTenantReceptionStatus, whatsappLiveOpsReady } from "@/lib/whatsapp/config";

export const metadata: Metadata = { title: "Settings · Velora" };

export default async function Page() {
  const linkResult = await getWhatsappCompanyLink();
  const access = await getCompanyAccess();
  const company = access.ok ? access.context.company : null;
  const initialSubscription = await loadOwnerBillingSubscription(subscriptionViewFromEntitlement(readCompanyEntitlement(company?.id ?? null), company?.status ?? null));
  const initialOffersView = offersViewFromCatalog(await readPublicCatalogBackend());
  const singleTenant = singleTenantReceptionStatus();
  return (
    <Suspense fallback={<main className="min-h-svh bg-[#07110d]" aria-busy="true" />}>
      <SettingsPage
        initialAccess={{email: access.ok ? access.context.email : null, companyId: company?.id ?? null, companyName:company?.display_name ?? null, role:access.ok ? access.context.membership?.role ?? null : null, needsCompanyContext:access.ok && access.context.needsCompanyContext, isPlatformAdmin:access.ok && access.context.isPlatformAdmin, choices:access.ok ? access.context.workspaceChoices : []}}
        initialCompany={company}
        initialSubscription={initialSubscription}
        initialOffersView={initialOffersView}
        initialWhatsappLink={linkResult.ok ? linkResult.data : null}
        whatsappLinkLoadFailed={!linkResult.ok && linkResult.code !== "FORBIDDEN" && linkResult.code !== "UNAUTHENTICATED"}
        whatsappLiveOpsReady={whatsappLiveOpsReady()}
        singleTenantReception={singleTenant}
      />
    </Suspense>
  );
}
