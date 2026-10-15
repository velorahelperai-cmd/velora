"use server";
import {getCompanyAccess} from "@/lib/tenancy/access";
import {createAdminClient} from "@/lib/supabase/admin";
import {readBillingActorSession} from "./public-purchase-persist";
import {billingUuid} from "./public-offer-policy";
import {masterJourneyEnabled} from "@/lib/master-journey/rollout";
type Charge={label:string;amountBaisa:number;currency:"OMR"};
type TermsResult={ok:true;termsVersion:string;termsText:string;featuresVersion:string;features:string[];disclosedCharges:Charge[]}|{ok:false;code:string};
type Rpc={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
export async function readCheckoutTermsAction(input:{planVersionId:string;expectedCompanyId:string}):Promise<TermsResult>{
 if(!masterJourneyEnabled())return {ok:false,code:"CHECKOUT_TERMS_UNCONFIGURED"};
 if(!input||Object.keys(input).some(k=>!["planVersionId","expectedCompanyId"].includes(k))||!billingUuid(input.planVersionId)||!billingUuid(input.expectedCompanyId))return {ok:false,code:"INVALID_INPUT"};
 const access=await getCompanyAccess("owner");
 if(!access.ok||access.context.company?.id!==input.expectedCompanyId||access.context.membership?.role!=="owner"||access.context.membership.status!=="active")return {ok:false,code:"FORBIDDEN"};
 const session=await readBillingActorSession(access.context.userId);const admin=createAdminClient();
 if(!session)return {ok:false,code:"FORBIDDEN"};if(!admin)return {ok:false,code:"CHECKOUT_TERMS_UNAVAILABLE"};
 try{
  const {data,error}=await (admin as unknown as Rpc).rpc("master_read_checkout_terms",{p_company_id:input.expectedCompanyId,p_plan_version_id:input.planVersionId,p_actor_id:access.context.userId,p_actor_session_id:session});
  const r=data as Partial<TermsResult>|null;
  if(error||!r||typeof r!=="object")return {ok:false,code:"CHECKOUT_TERMS_UNAVAILABLE"};
  if(r.ok!==true)return {ok:false,code:"code" in r&&typeof r.code==="string"?r.code:"CHECKOUT_TERMS_UNAVAILABLE"};
  if(typeof r.termsVersion!=="string"||typeof r.termsText!=="string"||typeof r.featuresVersion!=="string"
   ||!Array.isArray(r.features)||!r.features.every(feature=>typeof feature==="string"&&feature.trim().length>0)
   ||!Array.isArray(r.disclosedCharges)||!r.disclosedCharges.every(charge=>charge&&typeof charge.label==="string"&&charge.label.trim().length>0&&Number.isSafeInteger(charge.amountBaisa)&&charge.amountBaisa>=0&&charge.currency==="OMR"))return {ok:false,code:"CHECKOUT_TERMS_UNAVAILABLE"};
  return {ok:true,termsVersion:r.termsVersion,termsText:r.termsText,featuresVersion:r.featuresVersion,features:r.features,disclosedCharges:r.disclosedCharges};
 }catch{return {ok:false,code:"CHECKOUT_TERMS_UNAVAILABLE"};}
}
