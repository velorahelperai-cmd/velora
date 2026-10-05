import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccessGate } from "@/components/app/access-gate";
import { CompleteProfilePage } from "@/components/app/auth-pages";
import { getCompanyAccess, pathForAccess } from "@/lib/tenancy/access";

export const metadata: Metadata = { title: "Complete profile · Velora" };

export default async function Page() {
  const access = await getCompanyAccess();
  if (!access.ok) {
    if (access.code === "UNVERIFIED") redirect("/verify-email");
    if (access.code === "FORBIDDEN" || access.code === "UNAVAILABLE") {
      return <AccessGate code={access.code} />;
    }
    redirect("/login?next=%2Fcomplete-profile");
  }
  if (!access.context.needsProfileName) {
    redirect(pathForAccess(access));
  }
  return <CompleteProfilePage />;
}
