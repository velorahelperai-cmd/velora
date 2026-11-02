import type { Metadata } from "next";
import { headers } from "next/headers";
import { setupReturnContext } from "@/lib/auth/setup-return";
import { SetupAccountEntry } from "@/components/app/setup-account-entry";

export const metadata: Metadata = { title: "Prepare your business · Velora" };
// Server Actions retain their existing limit and independent native checks.
export const maxDuration = 120;

export default async function Page() {
  const { returnTo, preferredNext } = setupReturnContext((await headers()).get("x-velora-return-path"));
  // Public navigation intent only. No account or company data in the RSC payload.
  return <SetupAccountEntry returnTo={returnTo} preferredNext={preferredNext}/>;
}
