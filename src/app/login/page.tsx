import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginPage } from "@/components/app/auth-pages";

export const metadata: Metadata = { title: "Sign in · Velora" };

export default function Page() {
  return (
    <Suspense fallback={<main className="min-h-svh app-shell" aria-busy="true" />}>
      <LoginPage />
    </Suspense>
  );
}
