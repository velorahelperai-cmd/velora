import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KnowledgePage } from "@/components/app/workspace-pages";
import { listKnowledgeSources } from "@/lib/knowledge/actions";
import { getCompanyAccess, pathForAccess } from "@/lib/tenancy/access";

export const metadata: Metadata = { title: "Knowledge · Velora" };

async function KnowledgeLoader() {
  const access = await getCompanyAccess();
  if (!access.ok) {
    if (access.code === "UNVERIFIED") redirect("/verify-email");
    redirect("/login");
  }
  if (!access.context.company || !access.context.membership) {
    redirect(pathForAccess(access));
  }

  const listed = await listKnowledgeSources();
  const canWrite = access.context.membership.role === "owner";

  return (
    <KnowledgePage
      canWrite={canWrite}
      initialSources={listed.ok ? listed.data : []}
      initialLoadFailed={!listed.ok}
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="min-h-svh bg-[#07110d]" aria-busy="true" />}>
      <KnowledgeLoader />
    </Suspense>
  );
}
