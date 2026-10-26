import type { Metadata } from "next";
import { SettingsRoute } from "@/components/app/settings-route";
export const metadata: Metadata = {title: "الإعدادات · Settings · Velora"};
export default function Page() { return <SettingsRoute />; }
