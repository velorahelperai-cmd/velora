import {AccessGate} from "@/components/app/access-gate";
import { headers } from "next/headers";
import { safeInternalPath } from "@/lib/auth/safe-next";
import { redirect } from "next/navigation";
import { getCompanyAccess, loginPathForReturn } from "@/lib/tenancy/access";
import {WorkspaceBootstrapProvider} from '@/components/app/workspace-bootstrap';
import {sessionHasCompanyCapability} from '@/lib/access/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const returnTo = safeInternalPath((await headers()).get("x-velora-return-path"), "/app");
  const access = await getCompanyAccess();
  if (!access.ok) {
    if(access.code==="UNAVAILABLE"||access.code==="FORBIDDEN")return <AccessGate code={access.code}/>;
    if (access.code === "UNVERIFIED") redirect(`/verify-email?next=${encodeURIComponent(returnTo)}`);
    redirect(loginPathForReturn(returnTo));
  }
  if (access.context.needsProfileName) redirect(`/complete-profile?next=${encodeURIComponent(returnTo)}`);
  if (access.context.isPlatformAdmin && !access.context.company && !access.context.needsCompanyContext) {
    redirect("/admin");
  }
  if (!access.context.needsCompanyContext && !access.context.company) {
    if(access.context.hasBranchMemberships===true)redirect('/branch');
    redirect(`/setup?next=${encodeURIComponent(returnTo)}`);
  }
  const context=access.context;
  const knowledgeAllowed=context.membership?.role==='owner'||Boolean(context.company&&await sessionHasCompanyCapability(context.company.id,'knowledge.read')===true);
  // Presentation metadata only. Pages and native readers independently enforce
  // permissions; changing account/company/role remounts the displayed workspace.
  return <WorkspaceBootstrapProvider key={`${context.userId}:${context.company?.id??"none"}:${context.membership?.role??"none"}`} value={{
    workspace:{needsContext:context.needsCompanyContext,selectedCompanyId:context.company?.id??null,isPlatformAdmin:context.isPlatformAdmin,choices:context.workspaceChoices},
    identity:{userId:context.userId,fullName:context.fullName,email:context.email},knowledgeAllowed,
  }}>{children}</WorkspaceBootstrapProvider>;
}
