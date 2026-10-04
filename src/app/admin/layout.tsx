import { redirect } from "next/navigation";
import { getCompanyAccess, pathForAccess, requirePlatformAdmin } from "@/lib/tenancy/access";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdmin();
  if (admin.ok) return children;
  if (admin.code === "UNVERIFIED") redirect("/verify-email");
  if (admin.code === "FORBIDDEN") {
    const access = await getCompanyAccess();
    redirect(pathForAccess(access));
  }
  redirect("/login");
}
