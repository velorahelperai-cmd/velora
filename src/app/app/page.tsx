import { loadWhatsappInboxInitialPage } from "@/lib/whatsapp/inbox";
import { Suspense } from "react";
import type { Metadata } from "next";
import { DashboardPage } from "@/components/app/dashboard";
import { getCompanyAccess } from "@/lib/tenancy/access";

export const metadata: Metadata = { title: "Dashboard · Velora" };

async function DashboardContent() {
  const [access,leads] = await Promise.all([getCompanyAccess(),loadWhatsappInboxInitialPage()]);
  const workspace=access.ok?{actorId:access.context.userId,companyId:access.context.company?.id??null,companyName:access.context.company?.display_name??null,fullName:access.context.fullName,role:access.context.membership?.role??null}:null;
  const safeLeads=leads.ok&&(!workspace?.companyId||leads.meta.companyId!==workspace.companyId)?{ok:false as const,code:"FORBIDDEN" as const}:leads;
  return (
      <DashboardPage
        key={workspace?`${workspace.actorId}:${workspace.companyId}:${workspace.role}`:"unavailable"}
        initialLeads={safeLeads} workspace={workspace}
      />
  );
}

export default function Page() {
  return <Suspense fallback={<main className="min-h-svh app-shell" aria-busy="true"><p role="status">جارٍ تحميل لوحة العمل… / Loading dashboard…</p></main>}><DashboardContent/></Suspense>;
}
