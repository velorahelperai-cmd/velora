import { headers } from "next/headers";
import { safeInternalPath } from "@/lib/auth/safe-next";
import { redirect } from "next/navigation";
import { getCompanyAccess, loginPathForReturn } from "@/lib/tenancy/access";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const returnTo = safeInternalPath((await headers()).get("x-velora-return-path"), "/app");
  const access = await getCompanyAccess();
  if (!access.ok) {
    if (access.code === "UNVERIFIED") redirect("/verify-email");
    redirect(loginPathForReturn(returnTo));
  }
  if (access.context.needsProfileName) redirect("/complete-profile");
  if (access.context.isPlatformAdmin && !access.context.company && !access.context.needsCompanyContext) {
    redirect("/admin");
  }
  if (access.context.needsCompanyContext) {
    return children;
  }
  if (!access.context.company) redirect("/setup");
  return children;
}
