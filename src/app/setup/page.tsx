import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { authFlowHref } from "@/lib/auth/auth-journey";
import { setupReturnContext } from "@/lib/auth/setup-return";
import { AccessGate } from "@/components/app/access-gate";
import { SetupWizard } from "@/components/app/setup-wizard";
import { SetupLoading } from "@/components/app/setup-loading";
import { listKnowledgeSources } from "@/lib/knowledge/actions";
import type { KnowledgeSourceRecord } from "@/lib/knowledge/types";
import { getCompanyAccess, loginPathForReturn } from "@/lib/tenancy/access";
import { getCompanyReviewRequest } from "@/lib/tenancy/actions";
import type { CompanyReviewRequest } from "@/lib/tenancy/types";

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
  const company = access.context.company;
  const userId = access.context.userId;

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

  return (
    <Suspense fallback={<SetupLoading />}>
      <SetupWizard
        userId={userId}
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
