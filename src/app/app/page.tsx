import { loadWhatsappInboxInitialPage } from "@/lib/whatsapp/inbox";
import { Suspense } from "react";
import type { Metadata } from "next";
import { DashboardPage } from "@/components/app/dashboard";
import { getCustomerReadiness } from "@/lib/tenancy/actions";

export const metadata: Metadata = { title: "Dashboard · Velora" };

async function DashboardContent() {
  const [readiness,leads] = await Promise.all([getCustomerReadiness(),loadWhatsappInboxInitialPage()]);
  return (
      <DashboardPage
        initialLeads={leads} initialDiagnostic={readiness.diagnostic}
        initialReadiness={readiness.ok ? readiness.data : null}
        readinessLoadFailed={!readiness.ok}
      />
  );
}

export default function Page() {
  return <Suspense fallback={<main className="min-h-svh app-shell" aria-busy="true" />}><DashboardContent/></Suspense>;
}
