import {createBrokerBoundClient} from '@/lib/supabase/server';
import {branchInboxEventStream,validBranchWatchScope} from '@/lib/tenancy/branch-inbox-events';
import type {SupabaseClient} from '@supabase/supabase-js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const refused=(status:number)=>Response.json({ok:false,code:status===401?'UNAUTHENTICATED':status===403?'FORBIDDEN':status===400?'INVALID_INPUT':'UNAVAILABLE'},{status,headers:{'Cache-Control':'private, no-store'}});

export async function GET(request:Request){
 const url=new URL(request.url),origin=request.headers.get('origin');
 if(request.headers.get('sec-fetch-site')==='cross-site'||(origin&&origin!==url.origin))return refused(403);
 const scope={companyId:url.searchParams.get('company')??'',branchId:url.searchParams.get('branch')??'',channel:url.searchParams.get('channel')??''};
 if(!validBranchWatchScope(scope))return refused(400);
 try{
  const initial=await createBrokerBoundClient({fresh:true});
  if(!initial.bound.ok)return refused(initial.bound.code==='UNAVAILABLE'?503:401);
  const {client,resolve}=initial.bound;
  const allowed=async(userClient:SupabaseClient)=>{
   const {data,error}=await userClient.rpc('es02_can_watch_branch_inbox',{cid:scope.companyId,bid:scope.branchId,ch:scope.channel});
   if(error)throw new Error('BRANCH_WATCH_UNAVAILABLE');
   return data===true;
  };
  if(!await allowed(client))return refused(403);
  await client.realtime.setAuth(resolve.accessToken);
  return branchInboxEventStream({client,scope,signal:request.signal,authorize:async()=>{
   const fresh=await createBrokerBoundClient({fresh:true});
   if(!fresh.bound.ok&&fresh.bound.code==='UNAVAILABLE')throw new Error('BRANCH_WATCH_UNAVAILABLE');
   return fresh.bound.ok&&fresh.bound.resolve.boundary.boundaryFingerprint===resolve.boundary.boundaryFingerprint
    &&await allowed(fresh.bound.client);
  }});
 }catch{return refused(503);}
}
