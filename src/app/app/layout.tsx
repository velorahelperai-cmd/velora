import {AccessGate} from "@/components/app/access-gate";
import { headers } from "next/headers";
import { safeInternalPath } from "@/lib/auth/safe-next";
import { redirect } from "next/navigation";
import { getCompanyAccess, loginPathForReturn } from "@/lib/tenancy/access";

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
  if (access.context.needsCompanyContext) {
    return <div key={`${access.context.userId}:${access.context.company?.id??"none"}:${access.context.membership?.role??"none"}`}>{children}</div>;
  }
  if (!access.context.company) {
    if(access.context.hasBranchMemberships===true)redirect('/branch');
    redirect(`/setup?next=${encodeURIComponent(returnTo)}`);
  }
  return <div key={`${access.context.userId}:${access.context.company?.id??"none"}:${access.context.membership?.role??"none"}`}>{children}</div>;
}
