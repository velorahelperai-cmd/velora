import type { Metadata } from "next";
import { safeCompanyReturnHref } from "@/components/app/admin-company-navigation";
import { notFound, redirect } from "next/navigation";
import { AccessGate } from "@/components/app/access-gate";
import {
  AdminCompanyDetail,
  type AdminAudit,
  type AdminCompany,
  type AdminCompanyBranch,
  type AdminMember,
} from "@/components/app/admin-company-detail";
import { adminListCompanyKnowledge } from "@/lib/knowledge/actions";
import { adminGetWhatsappCompanyLink } from "@/lib/whatsapp/connection-actions";
import type { WhatsappCompanyLink } from "@/lib/whatsapp/connection";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess, pathForAccess, requirePlatformOwner } from "@/lib/tenancy/access";
import type { CompanyReviewRequest } from "@/lib/tenancy/types";

export const metadata: Metadata = { title: "Company · Velora Admin" };

type DetailPayload = {
  company: AdminCompany;
  members: AdminMember[];
  audits?: AdminAudit[];
  review_request?: CompanyReviewRequest | null;
};

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const admin = await requirePlatformOwner();
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

  // Load multi-branch isolation records if present
  let initialBranches: AdminCompanyBranch[] = [];
  try {
    const { data: branchesData, error: branchesError } = await (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (k: string, v: string) => {
            order: (col: string, opt: { ascending: boolean }) => {
              order: (col2: string, opt2: { ascending: boolean }) => Promise<{ data: AdminCompanyBranch[] | null; error: unknown }>;
            };
          };
        };
      };
    })
      .from("company_branches")
      .select("id, company_id, name, timezone, status, is_primary, created_at")
      .eq("company_id", id)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });

    if (!branchesError && Array.isArray(branchesData)) {
      initialBranches = branchesData;
    }
  } catch {
    initialBranches = [];
  }

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
      returnTo={safeCompanyReturnHref((await searchParams)?.returnTo)}
      initialCompany={payload.company}
      initialMembers={payload.members ?? []}
      initialAudits={payload.audits ?? []}
      initialBranches={initialBranches}
      initialReview={payload.review_request ?? null}
      initialWhatsappLink={initialWhatsappLink}
      whatsappLinkLoadFailed={whatsappLinkLoadFailed}
      initialKnowledge={knowledge.ok ? knowledge.data.sources : []}
      knowledgeLoadFailed={!knowledge.ok}
      approvalFoundation={knowledge.ok ? knowledge.data.approvalFoundation : "unavailable"}
    />
  );
}
