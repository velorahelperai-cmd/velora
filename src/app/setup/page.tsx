import {canUseAccountPrepDraft} from "@/lib/tenancy/account-prep-eligibility";
import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { authFlowHref } from "@/lib/auth/auth-journey";
import { setupReturnContext } from "@/lib/auth/setup-return";
import { AccessGate } from "@/components/app/access-gate";
import { SetupWizard } from "@/components/app/setup-wizard";
import { PrepaymentPreparation } from "@/components/app/prepayment-preparation";
import { SetupLoading } from "@/components/app/setup-loading";


import { getCompanyAccess, loginPathForReturn } from "@/lib/tenancy/access";



import {masterJourneyEnabled} from '@/lib/master-journey/rollout';

export const metadata: Metadata = { title: "Prepare your business · Velora" };

export default async function Page() {
  const { returnTo, preferredNext } = setupReturnContext((await headers()).get("x-velora-return-path"));
  const access = await getCompanyAccess();
  if (!access.ok) {
    if (access.code === "UNVERIFIED") redirect(authFlowHref("/verify-email", returnTo));
    if (access.code === "FORBIDDEN" || access.code === "UNAVAILABLE") {
      return <AccessGate code={access.code} />;
    }
    redirect(loginPathForReturn(returnTo));
  }
  if (access.context.needsCompanyContext) redirect(`/app?next=${encodeURIComponent(returnTo)}`);
  const company = access.context.company;
  const masterEnabled=masterJourneyEnabled();
  const userId = access.context.userId;
  // Unpaid preparation reads only its account-owned draft. Confirmed
  // companies retain their existing management/recovery path below.
  if (!company) {
    if(!canUseAccountPrepDraft(access.context))return <AccessGate code="FORBIDDEN"/>;
    return (
      <PrepaymentPreparation key={userId} userId={userId} preferredNext={preferredNext} variant="studio" />
    );
  }
  // Confirmed-company setup uses paid branch reads in SetupWizard. Legacy draft,
  // company knowledge and administrative review data are not consumed by that path.
  return <Suspense fallback={<SetupLoading />}><SetupWizard masterJourneyEnabled={masterEnabled} userId={userId} preferredNext={preferredNext} initialCompany={company}/></Suspense>;
}