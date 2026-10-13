import { loadWhatsappInboxInitialPage } from "@/lib/whatsapp/inbox";
import { Suspense } from "react";
import type { Metadata } from "next";
import { DashboardPage } from "@/components/app/dashboard";
import { getCustomerReadiness } from "@/lib/tenancy/actions";

export const metadata: Metadata = { title: "Dashboard · Velora" };

export default async function Page() {
  const [readiness,leads] = await Promise.all([getCustomerReadiness(),loadWhatsappInboxInitialPage()]);
  return (
    <Suspense fallback={<main className="min-h-svh app-shell" aria-busy="true" />}>
      <DashboardPage
        initialLeads={leads} initialDiagnostic={readiness.diagnostic}
        initialReadiness={readiness.ok ? readiness.data : null}
        readinessLoadFailed={!readiness.ok}
      />
    </Suspense>
  );
}
