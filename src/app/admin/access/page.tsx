import type { Metadata } from "next";
import { AdminAccessPage } from "@/components/app/admin-access";

export const metadata: Metadata = { title: "Access · Velora Admin" };

export default function Page() {
  return <AdminAccessPage />;
}
