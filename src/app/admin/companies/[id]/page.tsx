import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  AdminCompanyDetail,
  type AdminAudit,
  type AdminCompany,
  type AdminMember,
} from "@/components/app/admin-company-detail";
import { adminListCompanyKnowledge } from "@/lib/knowledge/actions";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess, pathForAccess, requirePlatformAdmin } from "@/lib/tenancy/access";

export const metadata: Metadata = { title: "Company · Velora Admin" };

type DetailPayload = {
  company: AdminCompany;
  members: AdminMember[];
  audits?: AdminAudit[];
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
  const knowledge = await adminListCompanyKnowledge(id);

  return (
    <AdminCompanyDetail
      initialCompany={payload.company}
      initialMembers={payload.members ?? []}
      initialAudits={payload.audits ?? []}
      initialKnowledge={knowledge.ok ? knowledge.data : []}
      knowledgeLoadFailed={!knowledge.ok}
    />
  );
}
