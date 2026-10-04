import { Suspense } from "react";
import type { Metadata } from "next";
import { SettingsPage } from "@/components/app/settings";

export const metadata: Metadata = { title: "Settings · Velora" };

export default function Page() {
  return (
    <Suspense fallback={<main className="min-h-svh bg-[#07110d]" aria-busy="true" />}>
      <SettingsPage />
    </Suspense>
  );
}
