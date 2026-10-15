'use server';
import {createClient} from '@/lib/supabase/server';
import {getCompanyAccess} from '@/lib/tenancy/access';
import type {SupabaseClient} from '@supabase/supabase-js';
import {CHANNELS,type Channel} from './contract';
/** Preparation for an explicitly confirmed owner selection. No catalog mutation,
 * checkout, provider request, disconnect, AI activation or deletion. */
export async function selectCompanyChannels(input:{companyId:string;planVersionId:string;expectedRevision:number;channels:Channel[]}){
 const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
 if(!input||!uuid(input.companyId)||!uuid(input.planVersionId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||!Array.isArray(input.channels)||!input.channels.length||input.channels.some(c=>!CHANNELS.includes(c))||new Set(input.channels).size!==input.channels.length)return {ok:false as const,code:'INVALID_INPUT'};
 try{const access=await getCompanyAccess('owner');
  if(!access.ok||access.context.company?.id!==input.companyId||access.context.membership?.role!=='owner')return {ok:false as const,code:'FORBIDDEN'};
  const client=await createClient() as unknown as SupabaseClient;
  // Canonical ordering is data normalization, never a new selection.
  const channels=CHANNELS.filter(c=>input.channels.includes(c));
  const {data,error}=await client.rpc('select_company_channels',{p_company_id:input.companyId,p_plan_version_id:input.planVersionId,p_expected_revision:input.expectedRevision,p_channels:channels});
  if(error||!data||typeof data!=='object')return {ok:false as const,code:'UNAVAILABLE'};
  if(data.ok===true&&Number.isSafeInteger(data.revision)&&data.revision>0)return {ok:true as const,revision:Number(data.revision)};
  const codes=['PLAN_CHANGED','SUBSCRIPTION_INACTIVE','CHANNEL_DISTRIBUTION_UNDEFINED','INVALID_SELECTION','CONFLICT','FORBIDDEN'];
  return {ok:false as const,code:codes.includes(data.code)?String(data.code):'UNAVAILABLE'};
 }catch{return {ok:false as const,code:'UNAVAILABLE'};}
}
