import type { Metadata } from "next";
import { LegalPage } from "@/components/app/workspace-pages";
import { termsDraftPreviewEnabled } from "@/lib/service-terms-draft";

export const metadata: Metadata = { title: "Terms of use · Velora" };

export default async function Page() {
  // The review-only draft is not rendered or wired as effective terms in a
  // production route. The draft component is loaded only for local development.
  if (process.env.NODE_ENV === "development") {
    const { ServiceTermsDraft } = await import("@/components/app/service-terms-draft");
    return <LegalPage kind="terms" draftTerms={termsDraftPreviewEnabled(process.env.NODE_ENV)}><ServiceTermsDraft /></LegalPage>;
  }
  return <LegalPage kind="terms" />;
}
