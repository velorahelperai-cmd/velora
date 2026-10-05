import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AccessGate } from "@/components/app/access-gate";
import { AdminConversationsView } from "@/components/app/admin-conversations";
import { adminListCompanyConversations } from "@/lib/tenancy/actions";
import { getCompanyAccess, pathForAccess, requirePlatformAdmin } from "@/lib/tenancy/access";

export const metadata: Metadata = { title: "Conversations · Velora Admin" };

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
    redirect(`/login?next=${encodeURIComponent(`/admin/companies/${id}/conversations`)}`);
  }

  // Do not auto-pick the first phone identity — require an explicit selection.
  const phoneNumberId = typeof phone === "string" && phone.trim() ? phone.trim() : null;
  const result = await adminListCompanyConversations({
    companyId: id,
    phoneNumberId,
    limit: 20,
    offset: 0,
  });
  if (!result.ok) {
    if (result.code === "UNAVAILABLE") return <AccessGate code="UNAVAILABLE" />;
    if (result.code === "FORBIDDEN") return <AccessGate code="FORBIDDEN" />;
    if (result.code === "INVALID_INPUT") {
      const bare = await adminListCompanyConversations({
        companyId: id,
        phoneNumberId: null,
        limit: 20,
        offset: 0,
      });
      if (bare.ok) {
        return <AdminConversationsView key={`${id}:`} initial={bare.data} />;
      }
      notFound();
    }
    notFound();
  }

  return (
    <AdminConversationsView
      key={`${id}:${phoneNumberId ?? ""}`}
      initial={result.data}
    />
  );
}
