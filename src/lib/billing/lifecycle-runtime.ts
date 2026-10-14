import 'server-only';
import {createAdminClient} from '@/lib/supabase/admin';
type Rpc={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
/** Bounded native worker. Disabled until separately configured; never calls Meta or AI. */
export async function runSubscriptionLifecycle(enabled:boolean,client?:Rpc|null){
 if(!enabled)return {ok:false,code:'LIFECYCLE_DISABLED'};
 const db=client??createAdminClient() as unknown as Rpc|null;if(!db)return {ok:false,code:'UNAVAILABLE'};
 try{const candidates=await db.rpc('billing_expiry_candidates',{p_limit:10});
  if(candidates.error||!Array.isArray(candidates.data)||candidates.data.length>10||!candidates.data.every(uuid))return {ok:false,code:'UNAVAILABLE'};
  let processed=0;for(const companyId of candidates.data){const result=await db.rpc('billing_run_expiry_company',{p_company_id:companyId});
   if(result.error||!result.data||typeof result.data!=='object'||!('ok' in result.data)||result.data.ok!==true)return {ok:false,code:'LIFECYCLE_REQUIRES_REVIEW',processed};processed++;
  }return {ok:true,processed};
 }catch{return {ok:false,code:'LIFECYCLE_REQUIRES_REVIEW'};}
}
