import { Suspense } from "react";
import type { Metadata } from "next";
import { SetupWizard } from "@/components/app/setup-wizard";
import { getCompanyAccess } from "@/lib/tenancy/access";

export const metadata: Metadata = { title: "Prepare your business · Velora" };

export default async function Page() {
  const access = await getCompanyAccess();
  const company = access.ok ? access.context.company : null;
  const userId = access.ok ? access.context.userId : "";
  return (
    <Suspense fallback={<main className="min-h-svh bg-[#07110d]" aria-busy="true" />}>
      <SetupWizard userId={userId} initialCompany={company} />
    </Suspense>
  );
}
