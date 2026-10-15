'use server';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createClient} from '@/lib/supabase/server';
import {readCompanyChannelContract} from '@/lib/channels/read';
import {getCompanyAccess} from './access';
import {parseSmartBranchSetup,setupUuid,type SmartBranchSetup} from './smart-onboarding';
import type {ChannelContract} from '@/lib/channels/contract';
import type {Business} from '@/lib/demo-state';
import {validDraftBusiness} from './setup-draft';

type Scope={expectedUserId:string;expectedCompanyId:string};
type Code='UNAUTHENTICATED'|'UNVERIFIED'|'FORBIDDEN'|'INVALID_INPUT'|'CONFLICT'|'UNCONFIGURED'|'UNAVAILABLE'|'REVIEW_REQUIRED';
type Result<T>={ok:true;data:T}|{ok:false;code:Code};
export type SmartSetupRead={branchSetup:SmartBranchSetup;contract:ChannelContract|null;operationalChannels:string[];reviewPolicyEnabled:boolean};
async function authorize(input:Scope):Promise<Code|null>{
 const access=await getCompanyAccess();
 if(!access.ok)return ['UNAUTHENTICATED','UNVERIFIED','FORBIDDEN'].includes(access.code)?access.code as Code:'UNAVAILABLE';
 if(!input||input.expectedUserId!==access.context.userId)return 'UNAUTHENTICATED';
 if(!setupUuid(input.expectedCompanyId)||access.context.company?.id!==input.expectedCompanyId||access.context.membership?.role!=='owner'||access.context.needsCompanyContext)return 'FORBIDDEN';
 return null;
}
function receipt(data:unknown,companyId:string):Result<SmartBranchSetup>{
 if(!data||typeof data!=='object')return {ok:false,code:'UNAVAILABLE'};
 const row=data as {ok?:boolean;code?:Code;data?:unknown};
 if(row.ok===false&&(row.code as string)==='OPERATION_CONFLICT')return {ok:false,code:'CONFLICT'};
 if(row.ok===false)return {ok:false,code:row.code&&['FORBIDDEN','CONFLICT','INVALID_INPUT','UNCONFIGURED'].includes(row.code)?row.code:'UNAVAILABLE'};
 const value=row.ok===true?parseSmartBranchSetup(row.data,companyId):null;
 return value?{ok:true,data:value}:{ok:false,code:'UNAVAILABLE'};
}
export async function readSmartSetup(input:Scope):Promise<Result<SmartSetupRead>>{
 try{
  const denied=await authorize(input);if(denied)return {ok:false,code:denied};
  const client=await createClient() as unknown as SupabaseClient;
  const [saved,contract,policy]=await Promise.all([client.rpc('read_smart_branch_setup',{p_company_id:input.expectedCompanyId}),readCompanyChannelContract(input.expectedCompanyId),client.rpc('smart_review_configuration',{p_company_id:input.expectedCompanyId})]);
  if(saved.error)return {ok:false,code:['PGRST202','42883','42P01'].includes(saved.error.code)?'UNCONFIGURED':'UNAVAILABLE'};
  const parsed=receipt(saved.data,input.expectedCompanyId);if(!parsed.ok)return parsed;
  // Newer billing schemas supply independently proven per-channel operational facts.
  const operational=(contract?.companyId===input.expectedCompanyId?contract.subscription:null) as (ChannelContract['subscription']&{operationalReadyChannels?:unknown})|null;
  const operationalChannels=Array.isArray(operational?.operationalReadyChannels)?operational.operationalReadyChannels.filter((ch):ch is 'whatsapp'|'instagram'=>ch==='whatsapp'||ch==='instagram'):[];
  const reviewPolicyEnabled=!policy.error&&policy.data?.ok===true&&policy.data?.companyId===input.expectedCompanyId&&policy.data?.enabled===true;
  return {ok:true,data:{branchSetup:parsed.data,contract,operationalChannels,reviewPolicyEnabled}};
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}
export async function saveSmartBranchSetup(input:Scope&{expectedRevision:number;mode:'single'|'multiple';primaryName:string;expectedPrimaryName:string}):Promise<Result<SmartBranchSetup>>{
 try{
  const denied=await authorize(input);if(denied)return {ok:false,code:denied};
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||!['single','multiple'].includes(input.mode)
   ||[input.primaryName,input.expectedPrimaryName].some(name=>typeof name!=='string'||!name.trim()||name.trim().length>120||/[\u0000-\u001f\u007f]/.test(name)))return {ok:false,code:'INVALID_INPUT'};
  const client=await createClient() as unknown as SupabaseClient;
  const {data,error}=await client.rpc('save_smart_branch_setup',{p_company_id:input.expectedCompanyId,p_expected_revision:input.expectedRevision,p_mode:input.mode,p_primary_name:input.primaryName.trim(),p_expected_primary_name:input.expectedPrimaryName});
  if(error)return {ok:false,code:['PGRST202','42883','42P01'].includes(error.code)?'UNCONFIGURED':'UNAVAILABLE'};
  return receipt(data,input.expectedCompanyId);
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}
export type SmartCompanySettings={companyId:string;revision:number;profileDigest:string;profile:Business;companyVersion?:number|null;updatedAt?:string|null};
const digestValid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function settingsReceipt(data:unknown,scope:Scope,attemptId?:string):Result<SmartCompanySettings>{
 const row=data as {ok?:boolean;code?:Code;data?:SmartCompanySettings&{userId?:string;attemptId?:string}}|null;
 if(row?.ok===false&&(row.code as string)==='OPERATION_CONFLICT')return {ok:false,code:'CONFLICT'};
 if(row?.ok===false)return {ok:false,code:row.code&&['FORBIDDEN','UNAUTHENTICATED','UNVERIFIED','CONFLICT','INVALID_INPUT','UNCONFIGURED','REVIEW_REQUIRED'].includes(row.code)?row.code:'UNAVAILABLE'};
 const r=row?.ok===true?row.data:null;
 if(!r||r.companyId!==scope.expectedCompanyId||!Number.isSafeInteger(r.revision)||r.revision<0||!digestValid(r.profileDigest)||!validDraftBusiness(r.profile)
  ||attemptId&&(r.userId!==scope.expectedUserId||r.attemptId!==attemptId))return {ok:false,code:'UNAVAILABLE'};
 return {ok:true,data:{companyId:r.companyId,revision:r.revision,profileDigest:r.profileDigest,profile:r.profile,...(Number.isSafeInteger(r.companyVersion)&&Number(r.companyVersion)>0?{companyVersion:r.companyVersion}:{}),...(typeof r.updatedAt==='string'?{updatedAt:r.updatedAt}:{})}};
}
export async function readSmartCompanySettings(input:Scope):Promise<Result<SmartCompanySettings>>{
 try{
  if(!input||!setupUuid(input.expectedUserId)||!setupUuid(input.expectedCompanyId))return {ok:false,code:'INVALID_INPUT'};
  const denied=await authorize(input);if(denied)return {ok:false,code:denied};
  const client=await createClient() as unknown as SupabaseClient;
  const {data,error}=await client.rpc('read_smart_profile',{p_company_id:input.expectedCompanyId});
  if(error)return {ok:false,code:['PGRST202','42883','42P01'].includes(error.code)?'UNCONFIGURED':'UNAVAILABLE'};
  return settingsReceipt(data,input);
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}
export async function saveSmartCompanySettings(input:Scope&{attemptId:string;expectedRevision:number;expectedProfileDigest:string;profile:Business}):Promise<Result<SmartCompanySettings>>{
 try{
  if(!input||!setupUuid(input.expectedUserId)||!setupUuid(input.expectedCompanyId)||!setupUuid(input.attemptId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||!digestValid(input.expectedProfileDigest)||!validDraftBusiness(input.profile)||!input.profile.name.trim()||!input.profile.type.trim()||!input.profile.country.trim())return {ok:false,code:'INVALID_INPUT'};
  const denied=await authorize(input);if(denied)return {ok:false,code:denied};
  const client=await createClient() as unknown as SupabaseClient;
  const {data,error}=await client.rpc('save_smart_profile',{p_expected_user_id:input.expectedUserId,p_company_id:input.expectedCompanyId,p_attempt_id:input.attemptId,p_expected_revision:input.expectedRevision,p_expected_profile_digest:input.expectedProfileDigest,p_payload:input.profile});
  if(error)return {ok:false,code:['PGRST202','42883','42P01'].includes(error.code)?'UNCONFIGURED':'UNAVAILABLE'};
  return settingsReceipt(data,input,input.attemptId);
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}
export async function saveSmartBranchSettings(input:Scope&{attemptId:string;expectedPrimaryBranchId:string;expectedRevision:number;mode:'single'|'multiple';primaryName:string;expectedPrimaryName:string}):Promise<Result<SmartBranchSetup>>{
 try{
  if(!input||![input.expectedUserId,input.expectedCompanyId,input.attemptId,input.expectedPrimaryBranchId].every(setupUuid)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||!['single','multiple'].includes(input.mode)||[input.primaryName,input.expectedPrimaryName].some(n=>typeof n!=='string'||!n.trim()||n.length>120||/[\u0000-\u001f\u007f]/.test(n)))return {ok:false,code:'INVALID_INPUT'};
  const denied=await authorize(input);if(denied)return {ok:false,code:denied};
  const client=await createClient() as unknown as SupabaseClient;
  const {data,error}=await client.rpc('save_smart_branch_setup_v2',{p_expected_user_id:input.expectedUserId,p_company_id:input.expectedCompanyId,p_attempt_id:input.attemptId,p_expected_primary_branch_id:input.expectedPrimaryBranchId,p_expected_revision:input.expectedRevision,p_mode:input.mode,p_primary_name:input.primaryName,p_expected_primary_name:input.expectedPrimaryName});
  if(error)return {ok:false,code:['PGRST202','42883','42P01'].includes(error.code)?'UNCONFIGURED':'UNAVAILABLE'};
  if(data?.ok===true&&(data.data?.userId!==input.expectedUserId||data.data?.attemptId!==input.attemptId))return {ok:false,code:'UNAVAILABLE'};
  const parsed=receipt(data,input.expectedCompanyId);
  if(parsed.ok&&parsed.data.branches.find(b=>b.primary)?.id!==input.expectedPrimaryBranchId)return {ok:false,code:'UNAVAILABLE'};
  return parsed;
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}
export type SmartBranchMutation={companyId:string;userId:string;attemptId:string;branchId:string;name?:string};
async function mutateBranch(input:Scope&{attemptId:string;name:string;timezone?:string;branchId?:string;expectedName?:string},rename:boolean):Promise<Result<SmartBranchMutation>>{
 try{
  if(!input||![input.expectedUserId,input.expectedCompanyId,input.attemptId].every(setupUuid)||typeof input.name!=='string'||!input.name.trim()||input.name.length>120||/[\u0000-\u001f\u007f]/.test(input.name)||rename&&(!setupUuid(input.branchId)||typeof input.expectedName!=='string'||!input.expectedName.trim())||!rename&&(typeof input.timezone!=='string'||input.timezone.length>80))return {ok:false,code:'INVALID_INPUT'};
  const denied=await authorize(input);if(denied)return {ok:false,code:denied};const client=await createClient() as unknown as SupabaseClient;
  const {data,error}=await client.rpc(rename?'rename_smart_branch':'create_smart_branch',{p_expected_user_id:input.expectedUserId,p_company_id:input.expectedCompanyId,p_attempt_id:input.attemptId,p_name:input.name,...(rename?{p_branch_id:input.branchId,p_expected_name:input.expectedName}:{p_timezone:input.timezone})});
  if(error)return {ok:false,code:['PGRST202','42883','42P01'].includes(error.code)?'UNCONFIGURED':'UNAVAILABLE'};
  if(data?.ok===false)return {ok:false,code:data.code==='OPERATION_CONFLICT'?'CONFLICT':['FORBIDDEN','CONFLICT','INVALID_INPUT','UNAUTHENTICATED','UNVERIFIED'].includes(data.code)?data.code:'UNAVAILABLE'};
  const r=data?.ok===true?data.data:null;
  if(!r||r.userId!==input.expectedUserId||r.companyId!==input.expectedCompanyId||r.attemptId!==input.attemptId||!setupUuid(r.branchId)||rename&&(r.branchId!==input.branchId||typeof r.name!=='string'||!r.name.trim()))return {ok:false,code:'UNAVAILABLE'};
  return {ok:true,data:r};
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}
export async function createSmartBranch(input:Scope&{attemptId:string;name:string;timezone:string}):Promise<Result<SmartBranchMutation>>{return mutateBranch(input,false);}
export async function renameSmartBranch(input:Scope&{attemptId:string;branchId:string;expectedName:string;name:string}):Promise<Result<SmartBranchMutation>>{return mutateBranch(input,true);}
