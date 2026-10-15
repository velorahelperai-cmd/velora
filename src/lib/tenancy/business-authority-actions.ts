'use server';
import {masterJourneyEnabled} from '@/lib/master-journey/rollout';
import {revalidatePath} from 'next/cache';
import {createClient} from '@/lib/supabase/server';
import {getCompanyAccess} from './access';
import {businessUuid,businessWriteCodes,businessWritePayload,type BusinessWriteResult} from './business-authority';
import type {CompanyRecord} from './types';
import type {Json} from '@/lib/database.types';
function receipt(value:unknown):BusinessWriteResult<CompanyRecord>{
 if(!value||typeof value!=='object')return {ok:false,code:'UNAVAILABLE'};
 const row=value as {ok?:boolean;data?:CompanyRecord;code?:string;currentVersion?:number};
 if(row.ok&&row.data&&businessUuid(row.data.id)&&Number.isSafeInteger(row.data.version)&&row.data.version!>0)return {ok:true,data:row.data};
 if(row.code&&businessWriteCodes.includes(row.code as typeof businessWriteCodes[number]))return {ok:false,code:row.code as typeof businessWriteCodes[number],...(Number.isSafeInteger(row.currentVersion)?{currentVersion:row.currentVersion}: {})};
 return {ok:false,code:'UNAVAILABLE'};
}
function refresh(){for(const path of ['/setup','/account','/app','/app/settings']){try{revalidatePath(path);}catch{/* committed receipt survives cache refresh failure */}}}
export async function createBusinessAttempt(input:{expectedUserId:string;idempotencyKey:string;business:unknown}):Promise<BusinessWriteResult<CompanyRecord>>{
 if(!masterJourneyEnabled())return {ok:false,code:'UNCONFIGURED'};
 try{
  const access=await getCompanyAccess();if(!access.ok)return {ok:false,code:access.code==='NO_COMPANY'?'FORBIDDEN':access.code};
  if(!input||input.expectedUserId!==access.context.userId)return {ok:false,code:'UNAUTHENTICATED'};
  const ctx=access.context,owns=(ctx.ownedBusinessCount??0)>0||ctx.membership?.role==='owner'||ctx.workspaceChoices.some(c=>c.role==='owner');
  if(ctx.isPlatformAdmin&&!owns||(ctx.membership?.role==='staff'||ctx.hasBusinessMemberships===true)&&!owns)return {ok:false,code:'FORBIDDEN'};
  const payload=businessWritePayload(input.business);
  if(!payload||!businessUuid(input.idempotencyKey))return {ok:false,code:'INVALID_INPUT'};
  const client=await createClient();const {data,error}=await client.rpc('create_owner_company_attempt',{p_expected_user_id:ctx.userId,p_idempotency_key:input.idempotencyKey,p_payload:payload as unknown as Json});
  if(error)return {ok:false,code:'UNAVAILABLE'};
  const result=receipt(data);if(result.ok)refresh();return result;
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}
export async function saveBusinessProfile(input:{expectedUserId:string;companyId:string;expectedVersion:number;business:unknown}):Promise<BusinessWriteResult<CompanyRecord>>{
 if(!masterJourneyEnabled())return {ok:false,code:'UNCONFIGURED'};
 try{
  const access=await getCompanyAccess();if(!access.ok)return {ok:false,code:access.code==='NO_COMPANY'?'FORBIDDEN':access.code};
  if(!input||input.expectedUserId!==access.context.userId)return {ok:false,code:'UNAUTHENTICATED'};
  if(input.companyId!==access.context.company?.id||access.context.membership?.role!=='owner')return {ok:false,code:'FORBIDDEN'};
  const payload=businessWritePayload(input.business);
  if(!payload||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)return {ok:false,code:'INVALID_INPUT'};
  const client=await createClient();const {data,error}=await client.rpc('update_owner_company_profile',{p_expected_user_id:input.expectedUserId,p_company_id:input.companyId,p_expected_version:input.expectedVersion,p_patch:payload as unknown as Json});
  if(error)return {ok:false,code:'UNAVAILABLE'};
  const result=receipt(data);if(result.ok)refresh();return result;
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}
