import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccessGate } from "@/components/app/access-gate";
import { AccountPage } from "@/components/app/account-page";
import { getCompanyAccess, pathForAccess } from "@/lib/tenancy/access";

export const metadata: Metadata = { title: "Account · Velora" };

export default async function Page() {
  const access = await getCompanyAccess();
  if (!access.ok) {
    if (access.code === "UNAUTHENTICATED") redirect("/login?next=%2Faccount");
    if (access.code === "UNVERIFIED") redirect("/verify-email");
    if (access.code === "FORBIDDEN" || access.code === "UNAVAILABLE") {
      return <AccessGate code={access.code} />;
    }
    redirect("/login?next=%2Faccount");
  }
  if (access.context.needsProfileName) redirect("/complete-profile");

  const ctx = access.context;
  return (
    <AccountPage
      key={ctx.userId}
      initial={{
        userId: ctx.userId,
        fullName: ctx.fullName,
        email: ctx.email,
        supportCode: ctx.supportCode,
        role: ctx.isPlatformAdmin ? "admin" : ctx.membership?.role ?? null,
        companyName: ctx.company?.display_name ?? null,
        companyId: ctx.company?.id ?? null,
        workHref: pathForAccess(access),
      }}
    />
  );
}
