'use server';
import {revalidatePath} from 'next/cache';
import {createClient} from '@/lib/supabase/server';
import {getCompanyAccess} from '@/lib/tenancy/access';
import {masterJourneyEnabled} from '@/lib/master-journey/rollout';
import {collectPublicKnowledge} from './public-import';
import {importUuid,importReceipt,isImportPreview,type ImportPreview,type ImportResult,type ImportRpc} from './knowledge-import';
async function context(input:{expectedUserId:string;companyId:string}):Promise<ImportResult<ImportRpc>>{
 if(!masterJourneyEnabled())return {ok:false,code:'UNCONFIGURED'};
 const a=await getCompanyAccess();if(!a.ok)return {ok:false,code:a.code};
 if(!input||input.expectedUserId!==a.context.userId)return {ok:false,code:'UNAUTHENTICATED'};
 if(!importUuid(input.companyId)||a.context.company?.id!==input.companyId)return {ok:false,code:'FORBIDDEN'};
 return {ok:true,data:await createClient() as unknown as ImportRpc};
}
export async function previewKnowledgeImport(input:{expectedUserId:string;companyId:string;url:string;rightsAttested:boolean;attemptId:string}):Promise<ImportResult<ImportPreview>>{
 try{const c=await context(input);if(!c.ok)return c;
 if(!importUuid(input.attemptId)||typeof input.url!=='string'||input.url.length>2048||input.rightsAttested!==true)return {ok:false,code:'INVALID_INPUT'};
 const access=await c.data.rpc('master_import_context',{p_expected_user_id:input.expectedUserId,p_company_id:input.companyId});if(access.error)return {ok:false,code:'UNAVAILABLE'};
 const trusted=importReceipt(access.data,(v):v is {companyVersion:number}=>!!v&&typeof v==='object'&&Number.isSafeInteger((v as {companyVersion:number}).companyVersion));if(!trusted.ok)return trusted;
 const {publicImportHttp}=await import('./public-import-http');const fetched=await collectPublicKnowledge(input.url,input.rightsAttested,publicImportHttp);if(!fetched.ok)return fetched;
 const r=await c.data.rpc('master_stage_knowledge_import',{p_expected_user_id:input.expectedUserId,p_company_id:input.companyId,p_attempt_id:input.attemptId,p_source_url:fetched.data.sourceUrl,p_text:fetched.data.text,p_rights_attested:true,p_expected_company_version:trusted.data.companyVersion});return r.error?{ok:false,code:'UNAVAILABLE'}:importReceipt(r.data,isImportPreview);
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}
export async function readKnowledgeImport(input:{expectedUserId:string;companyId:string;previewId:string}):Promise<ImportResult<ImportPreview>>{
 try{const c=await context(input);if(!c.ok)return c;if(!importUuid(input.previewId))return {ok:false,code:'INVALID_INPUT'};const r=await c.data.rpc('master_read_knowledge_import',{p_expected_user_id:input.expectedUserId,p_company_id:input.companyId,p_preview_id:input.previewId});return r.error?{ok:false,code:'UNAVAILABLE'}:importReceipt(r.data,isImportPreview);}catch{return {ok:false,code:'UNAVAILABLE'};}
}
export async function confirmKnowledgeImport(input:{expectedUserId:string;companyId:string;previewId:string;expectedRevision:number;contentHash:string}):Promise<ImportResult<{sourceId:string;approved:false}>>{
 try{const c=await context(input);if(!c.ok)return c;if(!importUuid(input.previewId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||typeof input.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(input.contentHash))return {ok:false,code:'INVALID_INPUT'};
 const r=await c.data.rpc('master_confirm_knowledge_import',{p_expected_user_id:input.expectedUserId,p_company_id:input.companyId,p_preview_id:input.previewId,p_expected_revision:input.expectedRevision,p_content_hash:input.contentHash});const result=r.error?{ok:false as const,code:'UNAVAILABLE'}:importReceipt(r.data,(v):v is {sourceId:string;approved:false}=>!!v&&typeof v==='object'&&importUuid((v as {sourceId:string}).sourceId)&&(v as {approved:unknown}).approved===false);
 if(result.ok){for(const p of ['/setup','/app/knowledge'])try{revalidatePath(p);}catch{/* persisted result remains authoritative */}}return result;
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}
