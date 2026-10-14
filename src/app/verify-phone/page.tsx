import type { Metadata } from "next";
import { PersonalPhonePage } from "@/components/app/personal-phone-page";
import { getPersonalPhoneStatus } from "@/lib/tenancy/personal-phone-actions";
import { safeInternalPath } from "@/lib/auth/safe-next";
export const metadata: Metadata = { title: "Verify personal phone · Velora" };
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [initialResult, params] = await Promise.all([getPersonalPhoneStatus(), searchParams]);
  return <PersonalPhonePage key={initialResult.ok ? initialResult.data.userId : "unavailable"} initialResult={initialResult} next={safeInternalPath(params.next, "/setup")} />;
}
