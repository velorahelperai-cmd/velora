import 'server-only';
import {createClient} from '@/lib/supabase/server';
import type {SupabaseClient} from '@supabase/supabase-js';
import {parseChannelContract,type ChannelContract} from './contract';

export type ChannelContractResult =
 | { ok: true; contract: ChannelContract }
 | { ok: false; code: 'UNAVAILABLE' | 'FORBIDDEN' };

export async function readCompanyChannelContractResult(companyId:string):Promise<ChannelContractResult>{
 try{const client=await createClient() as unknown as SupabaseClient;
  const {data,error}=await client.rpc('read_company_channel_contract',{p_company_id:companyId});
  if(error){
   if(['PGRST202','42883'].includes(String(error.code))){
    return {ok:true,contract:{companyId,planVersionId:null,plan_entitlements:{status:'UNCONFIGURED'},selected_channels:{planVersionId:null,revision:0,channels:[]},subscription:{state:'unverified',expiresAt:null}}};
   }
   if(['42501','PGRST301'].includes(String(error.code))){
    return {ok:false,code:'FORBIDDEN'};
   }
   return {ok:false,code:'UNAVAILABLE'};
  }
  const contract=parseChannelContract(data,companyId);
  if(!contract)return {ok:false,code:'UNAVAILABLE'};
  return {ok:true,contract};
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}

export async function readCompanyChannelContract(companyId:string):Promise<ChannelContract|null>{
 const result=await readCompanyChannelContractResult(companyId);
 return result.ok?result.contract:null;
}
