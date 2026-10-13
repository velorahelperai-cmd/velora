import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccessGate } from "@/components/app/access-gate";
import { getCompanyAccess, pathForAccess } from "@/lib/tenancy/access";

export const metadata: Metadata = { title: "Access · Velora" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; next?: string }>;
}) {
  const params = await searchParams;
  const access = await getCompanyAccess();
  if (access.ok && params.code === "UNAVAILABLE") redirect(pathForAccess(access, params.next));
  if (!access.ok && access.code === "UNAUTHENTICATED") redirect(access.sessionExpired ? "/login?reason=session_expired" : "/login");
  if (!access.ok && access.code === "UNVERIFIED") redirect("/verify-email");

  const code = params.code === "FORBIDDEN" || params.code === "UNAVAILABLE"
    ? params.code
    : access.ok
      ? null
      : access.code === "FORBIDDEN" || access.code === "UNAVAILABLE"
        ? access.code
        : "UNAVAILABLE";

  if (!code) redirect("/");
  return <AccessGate code={code} />;
}
