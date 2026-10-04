import { Suspense } from "react";
import type { Metadata } from "next";
import { AcceptInvitePage } from "@/components/app/auth-pages";

export const metadata: Metadata = { title: "Accept invitation · Velora" };

export default function Page() {
  return (
    <Suspense fallback={<main className="min-h-svh bg-[#07110d]" aria-busy="true" />}>
      <AcceptInvitePage />
    </Suspense>
  );
}
