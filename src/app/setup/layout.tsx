import { redirect } from "next/navigation";
import { getCompanyAccess } from "@/lib/tenancy/access";

export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const access = await getCompanyAccess();
  if (!access.ok) {
    if (access.code === "UNVERIFIED") redirect("/verify-email");
    redirect("/login");
  }
  if (access.context.needsProfileName) redirect("/complete-profile");
  if (access.context.isPlatformAdmin) redirect("/admin");
  if (access.context.membership?.role === "staff") {
    redirect("/app/conversations");
  }
  return children;
}
