import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/auth/site-url";
import { readTestCheckoutConfig } from "../wiring/test-checkout";
import { readLiveCheckoutConfig } from "../wiring/live-checkout";
import { qualifyLiveOffer } from "./live-offer";
import { evaluatePublicOffer } from "../wiring/public-offer-policy";
import { readPublicCatalogBackend } from "./rpc";
import { offersViewFromCatalog, type SubscriptionOffersView } from "@/components/app/subscription-offers-view";

/** Read-only payment readiness. Never creates an order, binds a version or calls Paymob.
 * This snapshot guides display; checkout independently rechecks actor, tenant and offer.
 * No credentials or configuration values are serialized to the client.
 */
export async function readSubscriptionOffersView(): Promise<SubscriptionOffersView> {
 const view=offersViewFromCatalog(await readPublicCatalogBackend());
 const live=readLiveCheckoutConfig(process.env);
 if(view.status!=="ready" || (!live.ok&&!readTestCheckoutConfig(process.env).ok))return view;
 let origin:URL;
 try { origin=new URL(siteUrl()); } catch { return view; }
 if(origin.protocol!=="https:" || origin.username || origin.password || ["localhost","127.0.0.1","[::1]"].includes(origin.hostname))return view;
 const admin=createAdminClient();
 if(!admin)return view;
 // Billing RPC is deployed but not yet included in generated Database types.
 const reader=admin as unknown as SupabaseClient;
 const offers=await Promise.all(view.offers.map(async offer=>{
  if(live.ok){
   if(offer.persona!=="level_1"||offer.term!=="monthly")return offer;
   try{
    const {data,error}=await reader.rpc("billing_read_public_live_offer",{p_plan_version_id:offer.versionId,p_integration_id:live.config.integrationId,p_merchant_owner_id:live.config.merchantOwnerId,p_units_per_omr:live.unitsPerOmr});
    const qualified=!error?qualifyLiveOffer(data,offer):null;
    return qualified?{...offer,...qualified}:offer;
   }catch{return offer;}
  }
  if(offer.persona!=="level_1" || offer.package!=="basic" || offer.term!=="monthly" || offer.amountBaisa!==45000)return offer;
  try{
   const {data,error}=await reader.rpc("billing_read_public_test_offer",{p_plan_version_id:offer.versionId});
   const qualified=!error && data?.ok===true ? evaluatePublicOffer(data.data,offer.versionId):null;
   return {...offer,testCheckoutReady:!!qualified && qualified.plan_id===offer.planId && qualified.amount_baisa===offer.amountBaisa};
  }catch{return offer;}
 }));
 return {...view,offers};
}
