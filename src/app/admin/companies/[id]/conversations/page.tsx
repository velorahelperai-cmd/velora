import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AccessGate } from "@/components/app/access-gate";
import { AdminConversationsView } from "@/components/app/admin-conversations";
import { createClient } from "@/lib/supabase/server";
import { adminListCompanyConversations } from "@/lib/tenancy/actions";
import { getCompanyAccess, pathForAccess, requirePlatformAdmin } from "@/lib/tenancy/access";

export const metadata: Metadata = { title: "Conversations · Velora Admin" };

function serviceGate(reason?: string | null) {
  return <AccessGate code="UNAVAILABLE" reason={reason} />;
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ phone?: string }>;
}) {
  const { id } = await params;
  const { phone } = await searchParams;
  const admin = await requirePlatformAdmin();
  if (!admin.ok) {
    if (admin.code === "UNVERIFIED") redirect("/verify-email");
    if (admin.code === "UNAVAILABLE") return serviceGate();
    if (admin.code === "FORBIDDEN") {
      const access = await getCompanyAccess();
      if (!access.ok) {
        if (access.code === "UNAVAILABLE") return serviceGate();
        if (access.code === "FORBIDDEN") return <AccessGate code="FORBIDDEN" />;
        redirect("/login");
      }
      redirect(pathForAccess(access));
    }
    redirect(`/login?next=${encodeURIComponent(`/admin/companies/${id}/conversations`)}`);
  }

  // Company existence is separate from conversation RPC / query health.
  const supabase = await createClient();
  const { data: companyPayload, error: companyError } = await supabase.rpc("admin_get_company", {
    p_company_id: id,
  });
  if (companyError) return serviceGate(companyError.message);
  if (!companyPayload) notFound();

  // Do not auto-pick the first phone identity — require an explicit selection.
  const phoneNumberId = typeof phone === "string" && phone.trim() ? phone.trim() : null;
  const result = await adminListCompanyConversations({
    companyId: id,
    phoneNumberId,
    limit: 20,
    offset: 0,
  });
  if (!result.ok) {
    if (result.code === "UNAVAILABLE" || result.code === "AUTH_ERROR") {
      return serviceGate(result.message);
    }
    if (result.code === "FORBIDDEN") return <AccessGate code="FORBIDDEN" />;
    if (result.code === "INVALID_INPUT") {
      if (result.message === "NOT_FOUND") notFound();
      // Bad/stale phone query param — recover with the phone-picker shell.
      if (phoneNumberId) {
        const bare = await adminListCompanyConversations({
          companyId: id,
          phoneNumberId: null,
          limit: 20,
          offset: 0,
        });
        if (bare.ok) {
          return <AdminConversationsView key={`${id}:`} initial={bare.data} />;
        }
        if (bare.code === "UNAVAILABLE" || bare.code === "AUTH_ERROR") {
          return serviceGate(bare.message);
        }
        if (bare.code === "FORBIDDEN") return <AccessGate code="FORBIDDEN" />;
        if (bare.message === "NOT_FOUND") notFound();
      }
      return serviceGate(result.message);
    }
    return serviceGate(result.message);
  }

  return (
    <AdminConversationsView
      key={`${id}:${phoneNumberId ?? ""}`}
      initial={result.data}
    />
  );
}
