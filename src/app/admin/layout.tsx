import { redirect } from "next/navigation";
import { AccessGate } from "@/components/app/access-gate";
import { getCompanyAccess, pathForAccess, requirePlatformAdmin } from "@/lib/tenancy/access";
import { pathAtOrUnder } from "@/lib/auth/safe-next";
import { AdminShell } from "@/components/admin/admin-shell";
import theme from "@/components/admin/admin-theme.module.css";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdmin();
  if (admin.ok) {
    return <AdminShell>{children}</AdminShell>;
  }
  if (admin.code === "UNVERIFIED") redirect("/verify-email");
  if (admin.code === "UNAVAILABLE") return <div className={theme.theme}><AccessGate code="UNAVAILABLE" /></div>;
  if (admin.code === "FORBIDDEN") {
    const access = await getCompanyAccess();
    if (!access.ok) {
      if (access.code === "UNAVAILABLE") return <div className={theme.theme}><AccessGate code="UNAVAILABLE" /></div>;
      if (access.code === "FORBIDDEN") return <div className={theme.theme}><AccessGate code="FORBIDDEN" /></div>;
      redirect("/login");
    }
    const target = pathForAccess(access);
    const pathOnly = target.split(/[?#]/)[0];
    if (pathAtOrUnder(pathOnly, "/admin")) {
      return <div className={theme.theme}><AccessGate code="FORBIDDEN" /></div>;
    }
    redirect(target);
  }
  redirect(admin.sessionExpired ? "/login?reason=session_expired&next=%2Fadmin" : "/login?next=%2Fadmin");
}
