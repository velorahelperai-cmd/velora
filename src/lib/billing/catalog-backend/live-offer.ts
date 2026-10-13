import type { SubscriptionOfferView } from "@/components/app/subscription-offers-view";
import { billingUuid } from "../wiring/public-offer-policy";
/** Display evidence only. Checkout rechecks the revision and financial/service locks. */
export function qualifyLiveOffer(value:unknown,offer:SubscriptionOfferView):{liveCheckoutReady:true;catalogRevision:number}|null {
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const result=value as Record<string,unknown>,data=result.data;
 if(result.ok!==true||!data||typeof data!=="object"||Array.isArray(data))return null;
 const row=data as Record<string,unknown>;
 if(!billingUuid(offer.versionId)||!billingUuid(offer.planId)||offer.persona!=="level_1"||offer.term!=="monthly"||offer.currency!=="OMR"
  ||!["basic","premium"].includes(offer.package)||!Number.isSafeInteger(offer.amountBaisa)||offer.amountBaisa<1
  ||!Number.isSafeInteger(offer.automatedOutboundPerMonth)||Number(offer.automatedOutboundPerMonth)<1
  ||row.version_id!==offer.versionId||row.plan_id!==offer.planId||row.amount_baisa!==offer.amountBaisa
  ||row.allowance_cap!==offer.automatedOutboundPerMonth||row.tier!==offer.package
  ||!Number.isSafeInteger(row.catalog_revision)||Number(row.catalog_revision)<1)return null;
 return {liveCheckoutReady:true,catalogRevision:Number(row.catalog_revision)};
}
