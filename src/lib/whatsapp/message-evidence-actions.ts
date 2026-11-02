'use server';
import {createClient,runWithVerifiedReadClient} from '@/lib/supabase/server';
import {getCompanyAccess} from '@/lib/tenancy/access';
import {parseWhatsappMessageEvidence,type WhatsappMessageEvidence} from './message-evidence';
type Result={ok:true;data:WhatsappMessageEvidence}|{ok:false;code:'FORBIDDEN'|'UNAVAILABLE'};
export async function readWhatsappMessageEvidence(input:{companyId:string;linkId:string}):Promise<Result>{
 if(!input||![input.companyId,input.linkId].every(v=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)))return {ok:false,code:'FORBIDDEN'};
 const scope={companyId:input.companyId,linkId:input.linkId};
 try{
  const result=await runWithVerifiedReadClient(async()=>{
   const before=await getCompanyAccess();
   if(!before.ok||before.context.company?.id!==scope.companyId||before.context.membership?.role!=='owner')return {ok:false as const,code:'FORBIDDEN' as const};
   const client=await createClient();
   const {data,error}=await (client as unknown as {rpc:(name:string,args:Record<string,string>)=>PromiseLike<{data:unknown;error:unknown}>}).rpc('whatsapp_read_message_evidence',{p_company_id:scope.companyId,p_link_id:scope.linkId});
   const after=await getCompanyAccess();
   if(!after.ok||after.context.userId!==before.context.userId||after.context.company?.id!==scope.companyId||after.context.membership?.role!=='owner')return {ok:false as const,code:'FORBIDDEN' as const};
   const evidence=error?null:parseWhatsappMessageEvidence(data,scope);
   return evidence?{ok:true as const,data:evidence,actorId:after.context.userId}:{ok:false as const,code:'UNAVAILABLE' as const};
  });
  if(!result.value.ok)return result.value;
  if(result.value.actorId!==result.actorId)return {ok:false,code:'FORBIDDEN'};
  return {ok:true,data:result.value.data};
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}
