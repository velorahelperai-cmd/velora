import type { Metadata } from "next";
import { LegalPage } from "@/components/app/workspace-pages";

export const metadata: Metadata = { title: "Delete account and data · Velora" };

export default function Page() {
  return <LegalPage kind="deletion" />;
}
