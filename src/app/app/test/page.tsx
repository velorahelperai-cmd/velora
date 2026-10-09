import { getCompanyAccess } from "@/lib/tenancy/access";
import {AccessGate} from "@/components/app/access-gate";
import { Suspense } from "react";
import type { Metadata } from "next";
import { TestPage } from "@/components/app/workspace-pages";

export const metadata: Metadata = { title: "Test assistant · Velora" };

export default async function Page() {
  const access=await getCompanyAccess("owner");
  if(!access.ok||!access.context.company||access.context.membership?.role!=="owner")return <AccessGate code={!access.ok&&access.code==="UNAVAILABLE"?"UNAVAILABLE":"FORBIDDEN"}/>;
  return (
    <Suspense fallback={<main className="min-h-svh bg-[#07110d]" aria-busy="true" />}>
      <TestPage />
    </Suspense>
  );
}
