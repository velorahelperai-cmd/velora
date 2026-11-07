import { loadOwnerBillingSubscription } from "@/lib/billing/wiring/subscription-read";
import { Suspense } from "react";
import { getCompanyAccess } from "@/lib/tenancy/access";
import { readSubscriptionOffersView } from "@/lib/billing/catalog-backend/offer-readiness";
import { readCompanyEntitlement } from "@/lib/billing/entitlement";
import { subscriptionViewFromEntitlement } from "@/components/app/subscription-model";
import { SettingsPage } from "@/components/app/settings";
import { RouteLoading } from "@/components/app/route-loading";
import { getWhatsappCompanyLink } from "@/lib/whatsapp/connection-actions";
import { singleTenantReceptionStatus, whatsappLiveOpsReady } from "@/lib/whatsapp/config";
import {readSubscriptionActivationAction} from '@/lib/billing/activation-actions';
import {masterJourneyEnabled} from '@/lib/master-journey/rollout';
import {readCycleCreditsAction} from '@/lib/billing/cycle-credit-actions';


export function SettingsRoute({subscriptionOnly = false}: {subscriptionOnly?: boolean}) {
  return <Suspense fallback={<RouteLoading />}><SettingsContent subscriptionOnly={subscriptionOnly}/></Suspense>;
}

async function SettingsContent({subscriptionOnly}: {subscriptionOnly:boolean}) {
  const linkPromise = subscriptionOnly ? Promise.resolve({ ok: false, code: "UNAVAILABLE" } as const) : getWhatsappCompanyLink();
  const access = await getCompanyAccess();
  const company = access.ok ? access.context.company : null;
  const owner = company && access.ok && access.context.membership?.role === 'owner';
  const [initialSubscription, initialOffersView, activation, credits, linkResult] = await Promise.all([
    loadOwnerBillingSubscription(subscriptionViewFromEntitlement(readCompanyEntitlement(company?.id ?? null), company?.status ?? null)),
    readSubscriptionOffersView(),
    owner ? readSubscriptionActivationAction(company.id) : Promise.resolve(null),
    masterJourneyEnabled() && owner ? readCycleCreditsAction(company.id) : Promise.resolve(null),
    linkPromise,
  ]);
  const singleTenant = singleTenantReceptionStatus(company?.id);
  return (
      <SettingsPage
        subscriptionOnly={subscriptionOnly}
        masterJourneyEnabled={masterJourneyEnabled()}
        initialAccess={{userId: access.ok ? access.context.userId : null, email: access.ok ? access.context.email : null, companyId: company?.id ?? null, companyName:company?.display_name ?? null, role:access.ok ? access.context.membership?.role ?? null : null, needsCompanyContext:access.ok && access.context.needsCompanyContext, isPlatformAdmin:access.ok && access.context.isPlatformAdmin, choices:access.ok ? access.context.workspaceChoices : []}}
        initialCompany={company}
        initialSubscription={initialSubscription}
        initialOffersView={initialOffersView}
        initialActivation={activation?.ok ? activation.data : null}
        initialCredits={credits?.ok?credits.data:null}
        initialWhatsappLink={linkResult.ok ? linkResult.data : null}
        whatsappLinkLoadFailed={!linkResult.ok && linkResult.code !== "FORBIDDEN" && linkResult.code !== "UNAUTHENTICATED"}
        whatsappLiveOpsReady={whatsappLiveOpsReady()}
        singleTenantReception={singleTenant}
      />
  );
}
