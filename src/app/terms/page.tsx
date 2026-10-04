import type { Metadata } from "next";
import { LegalPage } from "@/components/app/workspace-pages";

export const metadata: Metadata = { title: "Terms of use · Velora" };

export default function Page() {
  return <LegalPage kind="terms" />;
}
