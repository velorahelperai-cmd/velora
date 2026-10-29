'use server';
import {createClient} from '@/lib/supabase/server';
import {getCompanyAccess,requirePlatformOwner} from './access';
import {canUseQaSetupSimulation} from './qa-setup-simulation';
import {validatePreparation,type Preparation} from './prepayment-preparation';
import {normalizeOfferSelection,resolveEs02Offer,type Es02OfferSelection} from '@/lib/billing/es02/commercial-offer';
import {es02Uuid} from '@/lib/billing/es02/contracts';

export async function grantQaBusiness(input:{accountId:string;operationId:string;preparation:Preparation;selection:Es02OfferSelection}):Promise<{ok:true;companyId:string}|{ok:false;code:string}>{
 const access=await getCompanyAccess();
 if(!access.ok||access.context.userId!==input?.accountId||!canUseQaSetupSimulation(access.context))return {ok:false,code:'FORBIDDEN'};
 const selection=normalizeOfferSelection(input.selection);
 try{
  if(!es02Uuid(input.operationId)||!selection||!resolveEs02Offer(selection).ok||validatePreparation(input.preparation).length||input.preparation.name.trim()!=='VELORA QA'||selection.slots.length!==input.preparation.branches.length)return {ok:false,code:'INVALID_INPUT'};
  const p=input.preparation;
  const client=await createClient();
  const {data,error}=await client.rpc('es02_grant_qa_setup' as never,{
   p_expected_account_id:input.accountId,p_client_op_id:input.operationId,p_term:selection.term,p_slots:selection.slots,
   p_business:{name:p.name.trim(),type:p.type,country:p.country,city:p.city,phone:p.phone,replyLanguage:'both'},
   p_branches:p.branches.map(b=>({name:b.name,city:b.city,contact_phone:b.contactPhone||null})),
  } as never);
  const result=data as {ok?:boolean;companyId?:string;code?:string}|null;
  if(error||!result?.ok||!es02Uuid(result.companyId))return {ok:false,code:result?.code??'UNKNOWN'};
  return {ok:true,companyId:result.companyId};
 }catch{return {ok:false,code:'UNKNOWN'};}
}

export async function resetQaBusiness(companyId:string,confirmation?:string):Promise<Record<string,unknown>>{
 const owner=await requirePlatformOwner();
 if(!owner.ok||!es02Uuid(companyId))return {ok:false,code:'FORBIDDEN'};
 const client=await createClient();
 const {data,error}=await client.rpc('es02_admin_reset_qa_setup' as never,{p_company_id:companyId,p_confirm:confirmation??null} as never);
 return error?{ok:false,code:'UNKNOWN'}:(data as Record<string,unknown>??{ok:false,code:'UNKNOWN'});
}
