'use server';
import {revalidatePath} from 'next/cache';
import {createClient} from '@/lib/supabase/server';
import {getCompanyAccess} from './access';
import {smartOnboardingEnabled} from './smart-rollout';
import {setupUuid} from './smart-onboarding';
import type {CompanyRecord} from './types';

type Input={expectedUserId:string;attemptId:string;name:string;type:string;country:string};
type Result={ok:true;data:CompanyRecord}|{ok:false;code:string};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);

/** First creation only; native receipts resume a committed, lost response. */
export async function createSmartBusiness(input:Input):Promise<Result>{
  if(!smartOnboardingEnabled())return {ok:false,code:'UNCONFIGURED'};
  if(!object(input)||!setupUuid(input.expectedUserId)||!setupUuid(input.attemptId)
    ||[input.name,input.type,input.country].some(v=>typeof v!=='string'||!v.trim()||v.length>120||/[\u0000-\u001f\u007f]/.test(v)))return {ok:false,code:'INVALID_INPUT'};
  try{
    const access=await getCompanyAccess();
    if(!access.ok)return {ok:false,code:access.code};
    if(access.context.userId!==input.expectedUserId)return {ok:false,code:'UNAUTHENTICATED'};
    if(access.context.isPlatformAdmin||access.context.membership?.role==='staff')return {ok:false,code:'FORBIDDEN'};
    const client=await createClient();
    const rpc=client.rpc as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>;
    const {data,error}=await rpc.call(client,'create_smart_business',{p_expected_user_id:input.expectedUserId,p_attempt_id:input.attemptId,p_name:input.name.trim(),p_type:input.type.trim(),p_country:input.country.trim()});
    if(error)return {ok:false,code:['PGRST202','42883','42P01'].includes(error.code??'')?'UNCONFIGURED':'UNAVAILABLE'};
    if(!object(data))return {ok:false,code:'UNAVAILABLE'};
    if(data.ok!==true)return {ok:false,code:typeof data.code==='string'?data.code:'UNAVAILABLE'};
    const receipt=data.data;
    if(!object(receipt)||receipt.userId!==input.expectedUserId||receipt.attemptId!==input.attemptId||!setupUuid(receipt.companyId)
      ||!object(receipt.company)||receipt.company.id!==receipt.companyId)return {ok:false,code:'UNAVAILABLE'};
    const company=receipt.company;
    if(['display_name','business_type','country','city','hours','contact_phone','contact_email','created_by','created_at','updated_at'].some(k=>typeof company[k]!=='string')
      ||!['ar','en','both'].includes(String(company.reply_language))||!['setup','active','suspended'].includes(String(company.status)))return {ok:false,code:'UNAVAILABLE'};
    // The receipt is durable. A cache refresh failure must never invite a new create.
    try{revalidatePath('/setup');revalidatePath('/app');}catch{/* Reload can recover the same native receipt. */}
    return {ok:true,data:company as CompanyRecord};
  }catch{return {ok:false,code:'UNAVAILABLE'};}
}
