import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  getDirection,
  resolveLocale,
} from "@/lib/i18n";
import { DemoProvider } from "@/lib/demo-state";
import "./globals.css";

export const metadata: Metadata = {
  title: "Velora",
  description:
    "Velora — WhatsApp customer-service assistant for your business.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value ?? DEFAULT_LOCALE,
  );
  const dir = getDirection(locale);

  return (
    <html lang={locale} dir={dir} className="no-js">
      <body>
        <DemoProvider initialLocale={locale}>{children}</DemoProvider>
      </body>
    </html>
  );
}
