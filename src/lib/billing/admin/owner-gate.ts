import "server-only";
import {requireVerifiedUser} from "@/lib/tenancy/access";
import {createClient} from "@/lib/supabase/server";
import {billingUuid} from "../wiring/public-offer-policy";
import type {OwnerBinding} from "./cursor";
export type BillingOwnerGate={ok:true;binding:OwnerBinding;client:Awaited<ReturnType<typeof createClient>>}|{ok:false;code:"forbidden"|"unavailable"};
export type RecheckBillingOwnerResult={ok:true}|{ok:false;code:"forbidden"|"unavailable"};
export async function billingOwnerGate():Promise<BillingOwnerGate>{
 try{
  const verified=await requireVerifiedUser();
  if(!verified.ok)return {ok:false,code:verified.code==="UNAVAILABLE"?"unavailable":"forbidden"};
  const client=await createClient();
  const {data,error}=await client.auth.getClaims();
  if(error)return {ok:false,code:"unavailable"};
  const claims=data?.claims;
  if(!claims||claims.sub!==verified.context.userId||!billingUuid(claims.session_id))return {ok:false,code:"forbidden"};
  const allowed=await client.rpc("billing_admin_authorized_session");
  if(allowed.error)return {ok:false,code:"unavailable"};
  if(allowed.data!==true)return {ok:false,code:"forbidden"};
  return {ok:true,binding:{actorId:verified.context.userId,sessionId:claims.session_id},client};
 }catch{
  return {ok:false,code:"unavailable"};
 }
}
export async function recheckBillingOwner(binding:OwnerBinding):Promise<RecheckBillingOwnerResult>{
 const now=await billingOwnerGate();
 if(!now.ok)return now;
 if(now.binding.actorId!==binding.actorId||now.binding.sessionId!==binding.sessionId){
  return {ok:false,code:"forbidden"};
 }
 return {ok:true};
}
