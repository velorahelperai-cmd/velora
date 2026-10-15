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
import { listKnowledgeSources } from "@/lib/knowledge/actions";
import type { KnowledgeSourceRecord } from "@/lib/knowledge/types";
import { getCompanyAccess, loginPathForReturn } from "@/lib/tenancy/access";
import { getCompanyReviewRequest } from "@/lib/tenancy/actions";
import type { CompanyReviewRequest } from "@/lib/tenancy/types";
import {readSetupFileContext} from '@/lib/tenancy/setup-draft-actions';
import {masterJourneyEnabled} from '@/lib/master-journey/rollout';
import {smartOnboardingEnabled} from '@/lib/tenancy/smart-rollout';

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
  // Unpaid preparation never reads or restores a server draft. Confirmed
  // companies retain their existing management/recovery path below.
  if (!company) return <PrepaymentPreparation key={userId} userId={userId} />;
  const draftScope={expectedUserId:userId,expectedCompanyId:company?.id??null};
  const draftRead=readSetupFileContext(draftScope);

  let initialKnowledge: KnowledgeSourceRecord[] = [];
  let knowledgeLoadFailed = false;
  let approvalFoundation: "ready" | "unavailable" = "ready";
  let initialReview: CompanyReviewRequest | null = null;
  let reviewLoadFailed = false;

  if (company) {
    const [listed, review] = await Promise.all([
      listKnowledgeSources({ expectedCompanyId: company.id }),
      access.context.membership?.role === "owner"
        ? getCompanyReviewRequest({ expectedCompanyId: company.id })
        : Promise.resolve(null),
    ]);
    if (listed.ok) {
      initialKnowledge = listed.data.sources;
      approvalFoundation = listed.data.approvalFoundation;
    } else {
      knowledgeLoadFailed = true;
    }

    if (review) {
      if (review.ok) initialReview = review.data;
      else reviewLoadFailed = true;
    }
  }

  const initialDraftRead={scope:draftScope,result:await draftRead};

  return (
    <Suspense fallback={<SetupLoading />}>
      <SetupWizard
        initialDraftRead={initialDraftRead}
        masterJourneyEnabled={masterEnabled}
        userId={userId}
        smartOnboardingEnabled={smartOnboardingEnabled()}
        preferredNext={preferredNext}
        initialCompany={company}
        initialKnowledge={initialKnowledge}
        knowledgeLoadFailed={knowledgeLoadFailed}
        approvalFoundation={approvalFoundation}
        initialReview={initialReview}
        reviewLoadFailed={reviewLoadFailed}
      />
    </Suspense>
  );
}
