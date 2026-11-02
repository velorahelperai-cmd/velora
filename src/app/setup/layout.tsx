import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { setupReturnContext } from "@/lib/auth/setup-return";
import { AccessGate } from "@/components/app/access-gate";
import { getCompanyAccess } from "@/lib/tenancy/access";
import { setupLayoutDecision, setupDecisionHref } from "@/lib/tenancy/setup-entry-decision";
import { Suspense } from "react";
import { SetupLoading } from "@/components/app/setup-loading";

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  // The route loading boundary is below this layout. Stream only public chrome
  // while its native access read runs; page/read/action authorization stays intact.
  return <Suspense fallback={<SetupLoading />}><AuthorizedSetup>{children}</AuthorizedSetup></Suspense>;
}

async function AuthorizedSetup({ children }: { children: React.ReactNode }) {
  const requestPath = (await headers()).get("x-velora-return-path");
  // Only the root document is a public client entry; child routes still gate here.
  if (requestPath?.split('?')[0] === '/setup') return children;
  const { returnTo } = setupReturnContext(requestPath);
  const access = await getCompanyAccess();
  const decision = setupLayoutDecision(access);
  if (decision?.kind === 'deny') return <AccessGate code={decision.code} />;
  if (decision?.kind === 'redirect') redirect(setupDecisionHref(decision.target, returnTo));
  return children;
}
