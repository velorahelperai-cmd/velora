import { redirect } from "next/navigation";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Subscriptions · Velora", robots: { index: false, follow: false } };
/** Retained legacy URL; no fixtures or simulated customer/admin data rendered. */
export default function Page() { redirect("/app/settings?tab=plan"); }
