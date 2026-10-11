import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/auth/site-url";
import { readTestCheckoutConfig } from "../wiring/test-checkout";
import { evaluatePublicOffer } from "../wiring/public-offer-policy";
import { readPublicCatalogBackend } from "./rpc";
import { offersViewFromCatalog, type SubscriptionOffersView } from "@/components/app/subscription-offers-view";

/** Read-only Test readiness. Never creates an order, binds a version or calls Paymob.
 * This snapshot guides display; checkout independently rechecks actor, tenant and offer.
 * No credentials or configuration values are serialized to the client.
 */
export async function readSubscriptionOffersView(): Promise<SubscriptionOffersView> {
 const view=offersViewFromCatalog(await readPublicCatalogBackend());
 if(view.status!=="ready" || !readTestCheckoutConfig(process.env).ok)return view;
 let origin:URL;
 try { origin=new URL(siteUrl()); } catch { return view; }
 if(origin.protocol!=="https:" || ["localhost","127.0.0.1"].includes(origin.hostname))return view;
 const admin=createAdminClient();
 if(!admin)return view;
 // Billing RPC is deployed but not yet included in generated Database types.
 const reader=admin as unknown as SupabaseClient;
 const offers=await Promise.all(view.offers.map(async offer=>{
  if(offer.persona!=="level_1" || offer.package!=="basic" || offer.term!=="monthly" || offer.amountBaisa!==45000)return offer;
  try{
   const {data,error}=await reader.rpc("billing_read_public_test_offer",{p_plan_version_id:offer.versionId});
   const qualified=!error && data?.ok===true ? evaluatePublicOffer(data.data,offer.versionId):null;
   return {...offer,testCheckoutReady:!!qualified && qualified.plan_id===offer.planId && qualified.amount_baisa===offer.amountBaisa};
  }catch{return offer;}
 }));
 return {...view,offers};
}

