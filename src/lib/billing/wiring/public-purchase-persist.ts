import "server-only";
import {createClient} from "@/lib/supabase/server";
import {checkAppSession} from "@/lib/auth/session-guard";
import {getPaymobOmrConversionState} from "../paymob/config";
import {billingUuid} from "./public-offer-policy";
import {mapAtomicPurchasePersistPayload, type createAtomicPurchasePersistRpc, type AtomicPurchasePersistResult} from "./purchase-persist-rpc";
/** Verified session claims are read on the server; never accepted in action inputs. */
export async function readBillingActorSession(expectedUserId: string): Promise<string|null> {
 try {
  const client=await createClient(); const {data,error}=await client.auth.getClaims();
  const claims=data?.claims;
  if(error || claims?.sub!==expectedUserId || !billingUuid(claims?.session_id)) return null;
  const session=await checkAppSession(client); return session.ok ? claims.session_id : null;
 }catch{return null;}
}
type PurchaseInput = Parameters<ReturnType<typeof createAtomicPurchasePersistRpc>>[0];
type RpcClient = {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:{code?:string;message?:string}|null}>};
export async function persistPublicTestPurchase(admin:RpcClient,args:PurchaseInput,actorSessionId:string):Promise<AtomicPurchasePersistResult> {
 const conversion=getPaymobOmrConversionState();
 if(conversion.status!=="CONFIGURED") return {ok:false,code:"omr_conversion_not_configured"};
 const p_input={p_company_id:args.companyId,p_product_code:args.productCode,p_purchase_purpose:args.purchasePurpose,
 p_plan_version_id:args.planVersionId,p_requested_plan_id:args.requestedPlanId,p_client_op_id:args.clientOpId,
 p_input_fingerprint:args.inputFingerprint,p_special_reference:args.specialReference,p_amount_baisa:args.amountBaisa,
 p_currency:args.currency,p_period_days:args.periodDays,p_period_unit:args.periodUnit,p_period_count:args.periodCount,
 p_provider_account_ref:args.providerAccountRef,p_provider_environment:args.providerEnvironment,p_created_by:args.createdBy};
 try {
  const {data,error}=await admin.rpc("billing_create_public_test_subscription_order",{p_input,p_units_per_omr:conversion.unitsPerOmr,p_actor_session_id:actorSessionId});
  if(error) return {ok:false,code:["PGRST202","42883","42P01"].includes(error.code??"")?"schema_unavailable":error.code??"purchase_persist_rpc_failed"};
  return mapAtomicPurchasePersistPayload(data);
 }catch{return {ok:false,code:"purchase_persist_rpc_failed"};}
}
