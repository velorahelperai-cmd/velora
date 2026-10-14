import {createAdminClient} from "@/lib/supabase/admin";
import {handlePersonalPhoneSmsHook} from "@/lib/tenancy/personal-phone-hook";
import {createApprovedPersonalPhoneSmsDeliveryPort,personalPhoneSmsRuntimeConfigured} from "@/lib/tenancy/personal-phone-hook-config";
import {personalPhoneReceipt} from "@/lib/tenancy/personal-phone";
export const runtime="nodejs";
export async function POST(request:Request){
 async function call(name:string,args:Record<string,unknown>){
  const client=createAdminClient();if(!client)return {ok:false as const,code:"UNCONFIGURED"};
  const rpc=client.rpc as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
  const {data,error}=await rpc.call(client,name,args);return error?{ok:false as const,code:"UNAVAILABLE"}:personalPhoneReceipt(data);
 }
 return handlePersonalPhoneSmsHook(request,{
  configured:personalPhoneSmsRuntimeConfigured(),signingSecret:process.env.VELORA_PERSONAL_PHONE_SMS_HOOK_SECRET?.trim()??"",
  delivery:createApprovedPersonalPhoneSmsDeliveryPort(),
  consume:input=>call("master_consume_personal_phone_sms",{p_user_id:input.userId,p_phone:input.phone,p_hook_id:input.hookId}),
  settle:input=>call("master_settle_personal_phone_sms",{p_intent_id:input.intentId,p_delivery_receipt:input.deliveryReceipt,p_accepted:input.accepted}),
 });
}
