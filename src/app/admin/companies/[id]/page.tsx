import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AccessGate } from "@/components/app/access-gate";
import {
  AdminCompanyDetail,
  type AdminAudit,
  type AdminCompany,
  type AdminMember,
} from "@/components/app/admin-company-detail";
import { adminListCompanyKnowledge } from "@/lib/knowledge/actions";
import { adminGetWhatsappCompanyLink } from "@/lib/whatsapp/connection-actions";
import type { WhatsappCompanyLink } from "@/lib/whatsapp/connection";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess, pathForAccess, requirePlatformAdmin } from "@/lib/tenancy/access";
import type { CompanyReviewRequest } from "@/lib/tenancy/types";

export const metadata: Metadata = { title: "Company · Velora Admin" };

type DetailPayload = {
  company: AdminCompany;
  members: AdminMember[];
  audits?: AdminAudit[];
  review_request?: CompanyReviewRequest | null;
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requirePlatformAdmin();
  if (!admin.ok) {
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
    redirect(`/login?next=${encodeURIComponent(`/admin/companies/${id}`)}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_get_company", { p_company_id: id });
  // RPC/service failure ≠ missing company. Only empty payload means not found.
  if (error) return <AccessGate code="UNAVAILABLE" />;
  if (!data) notFound();

  const payload = data as DetailPayload;
  const knowledge = await adminListCompanyKnowledge(id);

  // Exception or explicit failure → load-failed; never treat as «not linked».
  let initialWhatsappLink: WhatsappCompanyLink | null = null;
  let whatsappLinkLoadFailed = false;
  try {
    const waLink = await adminGetWhatsappCompanyLink(id);
    if (waLink.ok) {
      initialWhatsappLink = waLink.data;
    } else {
      whatsappLinkLoadFailed = true;
    }
  } catch {
    whatsappLinkLoadFailed = true;
  }

  return (
    <AdminCompanyDetail
      key={`company-${payload.company.id}`}
      initialCompany={payload.company}
      initialMembers={payload.members ?? []}
      initialAudits={payload.audits ?? []}
      initialReview={payload.review_request ?? null}
      initialWhatsappLink={initialWhatsappLink}
      whatsappLinkLoadFailed={whatsappLinkLoadFailed}
      initialKnowledge={knowledge.ok ? knowledge.data.sources : []}
      knowledgeLoadFailed={!knowledge.ok}
      approvalFoundation={knowledge.ok ? knowledge.data.approvalFoundation : "unavailable"}
    />
  );
}
