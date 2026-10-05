import { redirect } from "next/navigation";
import { AccessGate } from "@/components/app/access-gate";
import { getCompanyAccess, loginPathForReturn } from "@/lib/tenancy/access";

export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const access = await getCompanyAccess();
  if (!access.ok) {
    if (access.code === "UNVERIFIED") redirect("/verify-email");
    if (access.code === "FORBIDDEN" || access.code === "UNAVAILABLE") {
      return <AccessGate code={access.code} />;
    }
    redirect(loginPathForReturn("/setup"));
  }
  if (access.context.needsProfileName) redirect("/complete-profile");
  if (access.context.isPlatformAdmin) redirect("/admin");
  if (access.context.membership?.role === "staff") {
    redirect("/app/conversations");
  }
  return children;
}
