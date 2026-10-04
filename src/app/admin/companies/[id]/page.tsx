import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminCompanyDetail } from "@/components/app/admin-company-detail";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess, pathForAccess, requirePlatformAdmin } from "@/lib/tenancy/access";
import type { CompanyStatus } from "@/lib/tenancy/types";

export const metadata: Metadata = { title: "Company · Velora Admin" };

type DetailPayload = {
  company: {
    id: string;
    display_name: string;
    status: CompanyStatus;
    business_type: string;
    country: string;
    city: string;
    hours: string;
    contact_phone: string;
    contact_email: string;
    created_at: string;
  };
  members: Array<{
    role: string;
    status: string;
    member_name: string;
    email?: string | null;
  }>;
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requirePlatformAdmin();
  if (!admin.ok) {
    if (admin.code === "UNVERIFIED") redirect("/verify-email");
    if (admin.code === "FORBIDDEN") {
      const access = await getCompanyAccess();
      redirect(pathForAccess(access));
    }
    redirect("/login");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_get_company", { p_company_id: id });
  if (error || !data) notFound();

  const payload = data as DetailPayload;
  const owner =
    payload.members.find((m) => m.role === "owner" && m.status === "active") ??
    payload.members.find((m) => m.role === "owner") ??
    null;

  return (
    <AdminCompanyDetail
      company={payload.company}
      owner={owner ? { member_name: owner.member_name, email: owner.email ?? null } : null}
    />
  );
}
