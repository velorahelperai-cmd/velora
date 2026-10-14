import 'server-only';
import {createClient} from '@/lib/supabase/server';
import type {SupabaseClient} from '@supabase/supabase-js';
import {parseChannelContract,type ChannelContract} from './contract';
export async function readCompanyChannelContract(companyId:string):Promise<ChannelContract|null>{
 try{const client=await createClient() as unknown as SupabaseClient;
  const {data,error}=await client.rpc('read_company_channel_contract',{p_company_id:companyId});
  if(error&&['PGRST202','42883'].includes(String(error.code)))return {companyId,planVersionId:null,plan_entitlements:{status:'UNCONFIGURED'},selected_channels:{planVersionId:null,revision:0,channels:[]},subscription:{state:'unverified',expiresAt:null}};
  return error?null:parseChannelContract(data,companyId);
 }catch{return null;}
}
