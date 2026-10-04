import { Suspense } from "react";
import type { Metadata } from "next";
import { VerifyEmailPage } from "@/components/app/auth-pages";

export const metadata: Metadata = { title: "Confirm email · Velora" };

export default function Page() {
  return (
    <Suspense fallback={<main className="min-h-svh bg-[#07110d]" aria-busy="true" />}>
      <VerifyEmailPage />
    </Suspense>
  );
}
