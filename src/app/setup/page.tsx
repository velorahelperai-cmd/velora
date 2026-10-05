import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccessGate } from "@/components/app/access-gate";
import { SetupWizard } from "@/components/app/setup-wizard";
import { listKnowledgeSources } from "@/lib/knowledge/actions";
import type { KnowledgeSourceRecord } from "@/lib/knowledge/types";
import { getCompanyAccess, loginPathForReturn } from "@/lib/tenancy/access";
import { getCompanyReviewRequest } from "@/lib/tenancy/actions";
import type { CompanyReviewRequest } from "@/lib/tenancy/types";

export const metadata: Metadata = { title: "Prepare your business · Velora" };

export default async function Page() {
  const access = await getCompanyAccess();
  if (!access.ok) {
    if (access.code === "UNVERIFIED") redirect("/verify-email");
    if (access.code === "FORBIDDEN" || access.code === "UNAVAILABLE") {
      return <AccessGate code={access.code} />;
    }
    redirect(loginPathForReturn("/setup"));
  }
  const company = access.context.company;
  const userId = access.context.userId;

  let initialKnowledge: KnowledgeSourceRecord[] = [];
  let knowledgeLoadFailed = false;
  let initialReview: CompanyReviewRequest | null = null;
  let reviewLoadFailed = false;

  if (company) {
    const listed = await listKnowledgeSources();
    if (listed.ok) initialKnowledge = listed.data;
    else knowledgeLoadFailed = true;

    if (access.context.membership?.role === "owner") {
      const review = await getCompanyReviewRequest();
      if (review.ok) initialReview = review.data;
      else reviewLoadFailed = true;
    }
  }

  return (
    <Suspense fallback={<main className="min-h-svh bg-[#07110d]" aria-busy="true" />}>
      <SetupWizard
        userId={userId}
        initialCompany={company}
        initialKnowledge={initialKnowledge}
        knowledgeLoadFailed={knowledgeLoadFailed}
        initialReview={initialReview}
        reviewLoadFailed={reviewLoadFailed}
      />
    </Suspense>
  );
}
