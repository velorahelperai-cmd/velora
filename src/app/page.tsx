import { subscriptionDestination } from "@/components/app/subscription-navigation";
import { readPublicCatalogBackend } from "@/lib/billing/catalog-backend/rpc";
import { offersViewFromCatalog } from "@/components/app/subscription-offers-view";
import { cookies } from "next/headers";
import { AccessGate } from "@/components/app/access-gate";
import { LandingPage } from "@/components/landing/landing-page";
import { DEFAULT_LOCALE, LOCALE_COOKIE, resolveLocale } from "@/lib/i18n";
import { getCompanyAccess, pathForAccess } from "@/lib/tenancy/access";

export default async function HomePage() {
  const cookieStore = await cookies();
  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value ?? DEFAULT_LOCALE,
  );
  const access = await getCompanyAccess();

  if (!access.ok && (access.code === "FORBIDDEN" || access.code === "UNAVAILABLE")) {
    return <AccessGate code={access.code} />;
  }

  const authHref = !access.ok
    ? access.code === "UNVERIFIED"
      ? "/verify-email"
      : "/signup"
    : pathForAccess(access);

  const offersView = offersViewFromCatalog(await readPublicCatalogBackend());
  return <LandingPage initialLocale={locale} authHref={authHref} offersView={offersView} subscriptionDestination={subscriptionDestination(access)} />;
}
