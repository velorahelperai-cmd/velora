import { redirect } from "next/navigation";
import { getCompanyAccess } from "@/lib/tenancy/access";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const access = await getCompanyAccess();
  if (!access.ok) {
    if (access.code === "UNVERIFIED") redirect("/verify-email");
    redirect("/login");
  }
  if (access.context.isPlatformAdmin) redirect("/admin");
  if (!access.context.company) redirect("/setup");
  return children;
}
