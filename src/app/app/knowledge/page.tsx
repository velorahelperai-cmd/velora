import {sessionHasCompanyCapability} from "@/lib/access/actions";
import {AccessGate} from "@/components/app/access-gate";
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
    if(access.code==="UNAVAILABLE"||access.code==="FORBIDDEN")return <AccessGate code={access.code}/>;
    if (access.code === "UNVERIFIED") redirect("/verify-email");
    redirect("/login");
  }
  if (!access.context.company || !access.context.membership) {
    redirect(pathForAccess(access));
  }

  const owner=access.context.membership.role==="owner";
  if(!owner&&await sessionHasCompanyCapability(access.context.company.id,"knowledge.read")!==true)return <AccessGate code="FORBIDDEN"/>;
  const listed = await listKnowledgeSources({ expectedCompanyId: access.context.company.id });
  const canWrite=owner||await sessionHasCompanyCapability(access.context.company.id,"knowledge.write")===true;
  const canDelete=owner||await sessionHasCompanyCapability(access.context.company.id,"knowledge.delete")===true;

  return (
    <KnowledgePage
      companyId={access.context.company.id}
      canWrite={canWrite}
      canDelete={canDelete}
      initialSources={listed.ok ? listed.data.sources : []}
      initialLoadFailed={!listed.ok}
      approvalFoundation={listed.ok ? listed.data.approvalFoundation : "unavailable"}
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
