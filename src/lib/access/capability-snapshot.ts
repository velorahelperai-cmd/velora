import 'server-only';
import {createClient} from '@/lib/supabase/server';
import type {CompanyCapability} from './capabilities';

/** Read-only UI snapshot. Writers still recheck their own native authority.
 * No cached grants, caller-supplied client, actor override or legacy fallback. */
export async function readCompanyCapabilitySnapshot<T extends CompanyCapability>(companyId:string,capabilities:readonly T[]):Promise<{ok:true;capabilities:Record<T,boolean>}|{ok:false}>{
 try{
  const client=await createClient();
  const {data,error}=await (client as unknown as {rpc(name:string,args:Record<string,unknown>):Promise<{data:unknown;error:unknown}>}).rpc('company_capability_snapshot',{p_company_id:companyId,p_capabilities:[...capabilities]});
  if(error||!data||typeof data!=='object'||Array.isArray(data))return {ok:false};
  const row=data as Record<string,unknown>,values=row.capabilities;
  if(row.company_id!==companyId||!values||typeof values!=='object'||Array.isArray(values))return {ok:false};
  const source=values as Record<string,unknown>;
  if(capabilities.some(cap=>typeof source[cap]!=='boolean'))return {ok:false};
  return {ok:true,capabilities:Object.fromEntries(capabilities.map(cap=>[cap,source[cap]])) as Record<T,boolean>};
 }catch{return {ok:false};}
}
