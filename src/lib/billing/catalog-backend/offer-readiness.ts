import "server-only";
import { readPublicCatalogBackend } from "./rpc";
import { offersViewFromCatalog, type SubscriptionOffersView } from "@/components/app/subscription-offers-view";
/** Existing-company checkout is retired. Account onboarding uses its separately
 * authorized Thawani Test flow; catalog display never implies payment readiness. */
export async function readSubscriptionOffersView(): Promise<SubscriptionOffersView> {
  return offersViewFromCatalog(await readPublicCatalogBackend());
}
