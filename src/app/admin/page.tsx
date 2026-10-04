import type { Metadata } from "next";
import { AdminList } from "@/components/app/admin-list";

export const metadata: Metadata = { title: "Velora Admin" };

export default function Page() {
  return <AdminList />;
}
