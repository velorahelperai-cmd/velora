'use server';
import {revalidatePath} from 'next/cache';
import {getCompanyAccess} from './access';
import {createClient} from '@/lib/supabase/server';
import {masterJourneyEnabled} from '@/lib/master-journey/rollout';
import {importReceipt,importUuid,type ImportResult,type ImportRpc} from '@/lib/knowledge/knowledge-import';
import {isBusinessLifecycle,type BusinessLifecycle} from './business-archive';
import {businessFinancialHistory,type BusinessFinancialHistory} from './business-financial-history';
async function actor(expectedUserId:string):Promise<ImportResult<ImportRpc>>{if(!masterJourneyEnabled())return {ok:false,code:'UNCONFIGURED'};const a=await getCompanyAccess();if(!a.ok)return {ok:false,code:a.code};if(expectedUserId!==a.context.userId)return {ok:false,code:'UNAUTHENTICATED'};return {ok:true,data:await createClient() as unknown as ImportRpc};}
export async function readBusinessLifecycle(expectedUserId:string):Promise<ImportResult<BusinessLifecycle[]>>{try{const c=await actor(expectedUserId);if(!c.ok)return c;const r=await c.data.rpc('master_list_owned_businesses',{p_expected_user_id:expectedUserId});return r.error?{ok:false,code:'UNAVAILABLE'}:importReceipt(r.data,(v):v is BusinessLifecycle[]=>Array.isArray(v)&&v.every(isBusinessLifecycle));}catch{return {ok:false,code:'UNAVAILABLE'};}}
export async function readBusinessFinancialHistory(input:{expectedUserId:string;companyId:string}):Promise<ImportResult<BusinessFinancialHistory>>{
 try{const c=await actor(input.expectedUserId);if(!c.ok)return c;if(!importUuid(input.companyId))return {ok:false,code:'INVALID_INPUT'};
 const owns=async()=>{const r=await c.data.rpc('master_list_owned_businesses',{p_expected_user_id:input.expectedUserId});if(r.error)return {ok:false as const,code:'UNAVAILABLE'};const parsed=importReceipt(r.data,(v):v is BusinessLifecycle[]=>Array.isArray(v)&&v.every(isBusinessLifecycle));return !parsed.ok?parsed:parsed.data.some(b=>b.id===input.companyId)?{ok:true as const,data:true}:{ok:false as const,code:'FORBIDDEN'};};
 const before=await owns();if(!before.ok)return before;
 const [display,journey]=await Promise.all([c.data.rpc('billing_read_company_display_evidence',{p_company_id:input.companyId}),c.data.rpc('billing_read_company_journey',{p_company_id:input.companyId})]);if(display.error||journey.error)return {ok:false,code:'UNAVAILABLE'};
 // A blocked native session or revoked ownership during either read never releases financial data.
 const after=await owns();if(!after.ok)return after;const parsed=businessFinancialHistory(input.companyId,display.data,journey.data);return parsed?{ok:true,data:parsed}:{ok:false,code:'UNAVAILABLE'};
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}
export async function setBusinessArchive(input:{expectedUserId:string;companyId:string;expectedVersion:number;archived:boolean}):Promise<ImportResult<BusinessLifecycle>>{
 try{const c=await actor(input.expectedUserId);if(!c.ok)return c;if(!importUuid(input.companyId)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1||typeof input.archived!=='boolean')return {ok:false,code:'INVALID_INPUT'};
 const r=await c.data.rpc('master_set_business_archive',{p_expected_user_id:input.expectedUserId,p_company_id:input.companyId,p_expected_version:input.expectedVersion,p_archived:input.archived});const result=r.error?{ok:false as const,code:'UNAVAILABLE'}:importReceipt(r.data,isBusinessLifecycle);if(result.ok){for(const p of ['/account','/account/businesses/manage','/app','/setup'])try{revalidatePath(p);}catch{/* committed receipt survives cache failure */}}return result;
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}
export async function requestBusinessDeletion(input:{expectedUserId:string;companyId:string;expectedVersion:number;attemptId:string;reason:string}):Promise<ImportResult<{id:string;state:'awaiting_stepup_policy';legalPolicy:'UNCONFIGURED'}>>{
 try{const c=await actor(input.expectedUserId);if(!c.ok)return c;if(!importUuid(input.companyId)||!importUuid(input.attemptId)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1000)return {ok:false,code:'INVALID_INPUT'};
 const r=await c.data.rpc('master_request_business_deletion',{p_expected_user_id:input.expectedUserId,p_company_id:input.companyId,p_expected_version:input.expectedVersion,p_attempt_id:input.attemptId,p_reason:input.reason});return r.error?{ok:false,code:'UNAVAILABLE'}:importReceipt(r.data,(v):v is {id:string;state:'awaiting_stepup_policy';legalPolicy:'UNCONFIGURED'}=>!!v&&typeof v==='object'&&importUuid((v as {id:string}).id)&&(v as {state:string}).state==='awaiting_stepup_policy'&&(v as {legalPolicy:string}).legalPolicy==='UNCONFIGURED');
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}
