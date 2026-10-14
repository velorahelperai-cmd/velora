'use server';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createClient} from '@/lib/supabase/server';
import {readCompanyChannelContract} from '@/lib/channels/read';
import {getCompanyAccess} from './access';
import {parseSmartBranchSetup,setupUuid,type SmartBranchSetup} from './smart-onboarding';
import type {ChannelContract} from '@/lib/channels/contract';

type Scope={expectedUserId:string;expectedCompanyId:string};
type Code='UNAUTHENTICATED'|'UNVERIFIED'|'FORBIDDEN'|'INVALID_INPUT'|'CONFLICT'|'UNCONFIGURED'|'UNAVAILABLE';
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
