import { subscriptionDestination } from "@/components/app/subscription-navigation";
import { readPublicCatalogBackend } from "@/lib/billing/catalog-backend/rpc";
import { offersViewFromCatalog } from "@/components/app/subscription-offers-view";
import { cookies } from "next/headers";

import { LandingPage } from "@/components/landing/landing-page";
import { DEFAULT_LOCALE, LOCALE_COOKIE, resolveLocale } from "@/lib/i18n";
import { getCompanyAccess, pathForAccess } from "@/lib/tenancy/access";

export default async function HomePage() {
  // Public offers do not depend on the selected workspace or its access read.
  const [cookieStore, access, catalog] = await Promise.all([
    cookies(), getCompanyAccess(), readPublicCatalogBackend(),
  ]);
  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value ?? DEFAULT_LOCALE,
  );

  const authHref = !access.ok
    ? access.code === "UNVERIFIED"
      ? "/verify-email"
      : access.code==="UNAVAILABLE"||access.code==="FORBIDDEN"?"/account":"/signup"
    : pathForAccess(access);

  const offersView = offersViewFromCatalog(catalog);
  return <LandingPage initialLocale={locale} authHref={authHref} offersView={offersView} subscriptionDestination={subscriptionDestination(access)} />;
}
