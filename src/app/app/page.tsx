import { Suspense } from "react";
import type { Metadata } from "next";
import { DashboardPage } from "@/components/app/dashboard";

export const metadata: Metadata = { title: "Dashboard · Velora" };

export default function Page() {
  return (
    <Suspense fallback={<main className="min-h-svh bg-[#07110d]" aria-busy="true" />}>
      <DashboardPage />
    </Suspense>
  );
}
