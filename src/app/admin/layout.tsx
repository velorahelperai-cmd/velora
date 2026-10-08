import { redirect } from "next/navigation";
import { AccessGate } from "@/components/app/access-gate";
import { getCompanyAccess, pathForAccess, requirePlatformAdmin } from "@/lib/tenancy/access";
import { AdminShell } from "@/components/admin/admin-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdmin();
  if (admin.ok) {
    return <AdminShell>{children}</AdminShell>;
  }
  if (admin.code === "UNVERIFIED") redirect("/verify-email");
  if (admin.code === "UNAVAILABLE") return <AccessGate code="UNAVAILABLE" />;
  if (admin.code === "FORBIDDEN") {
    const access = await getCompanyAccess();
    if (!access.ok) {
      if (access.code === "UNAVAILABLE") return <AccessGate code="UNAVAILABLE" />;
      if (access.code === "FORBIDDEN") return <AccessGate code="FORBIDDEN" />;
      redirect("/login");
    }
    redirect(pathForAccess(access));
  }
  redirect(admin.sessionExpired ? "/login?reason=session_expired&next=%2Fadmin" : "/login?next=%2Fadmin");
}
