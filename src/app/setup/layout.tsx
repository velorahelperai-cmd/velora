import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { authFlowHref } from "@/lib/auth/auth-journey";
import { setupReturnContext } from "@/lib/auth/setup-return";
import { AccessGate } from "@/components/app/access-gate";
import { getCompanyAccess, loginPathForReturn } from "@/lib/tenancy/access";
import { Suspense } from "react";
import { SetupLoading } from "@/components/app/setup-loading";

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  // The route loading boundary is below this layout. Stream only public chrome
  // while its native access read runs; page/read/action authorization stays intact.
  return <Suspense fallback={<SetupLoading />}><AuthorizedSetup>{children}</AuthorizedSetup></Suspense>;
}

async function AuthorizedSetup({ children }: { children: React.ReactNode }) {
  const { returnTo } = setupReturnContext((await headers()).get("x-velora-return-path"));
  const access = await getCompanyAccess();
  if (!access.ok) {
    if (access.code === "UNVERIFIED") redirect(authFlowHref("/verify-email", returnTo));
    if (access.code === "FORBIDDEN" || access.code === "UNAVAILABLE") {
      return <AccessGate code={access.code} />;
    }
    redirect(loginPathForReturn(returnTo));
  }
  if (access.context.needsProfileName) redirect(authFlowHref("/complete-profile", returnTo));
  if (access.context.needsCompanyContext) redirect(`/app?next=${encodeURIComponent(returnTo)}`);
  if (access.context.isPlatformAdmin && !access.context.company) redirect("/admin");
  if (access.context.membership?.role === "staff") {
    redirect("/app/conversations");
  }
  return children;
}
