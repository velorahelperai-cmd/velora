import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CompleteProfilePage } from "@/components/app/auth-pages";
import { getCompanyAccess, pathForAccess } from "@/lib/tenancy/access";

export const metadata: Metadata = { title: "Complete profile · Velora" };

export default async function Page() {
  const access = await getCompanyAccess();
  if (!access.ok) {
    if (access.code === "UNVERIFIED") redirect("/verify-email");
    redirect("/login");
  }
  if (!access.context.needsProfileName) {
    redirect(pathForAccess(access));
  }
  return <CompleteProfilePage />;
}
