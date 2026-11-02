import {createBrokerBoundClient} from '@/lib/supabase/server';
import {getCompanyAccess} from '@/lib/tenancy/access';
import {branchInboxEventStream} from '@/lib/tenancy/branch-inbox-events';
import type {SupabaseClient} from '@supabase/supabase-js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const refused=(status:number,stage:string)=>{console.warn('inbox_event_refused',{status,stage});return Response.json({ok:false},{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});};
/** Subscribe to existing metadata only, under the user's token and native branch
 * RLS. Never publish messages, credentials or customer identifiers to the browser. */
export async function GET(request:Request){
 const url=new URL(request.url),q=url.searchParams,companyId=q.get('companyId')??'',actorId=q.get('actorId')??'';
 if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return refused(403,'origin');
 if(!uuid.test(companyId)||!uuid.test(actorId)||[...q.keys()].some(k=>!['companyId','actorId'].includes(k)||q.getAll(k).length!==1))return refused(400,'input');
 let stage='access';
 try{
  const access=await getCompanyAccess();
  if(!access.ok)return refused(access.code==='UNAVAILABLE'?503:401,'access');
  if(access.context.userId!==actorId||access.context.company?.id!==companyId)return refused(403,'scope');
  stage='session';
  const initial=await createBrokerBoundClient({fresh:true});
  if(!initial.bound.ok)return refused(initial.bound.code==='UNAVAILABLE'?503:401,'session');
  const {client,resolve}=initial.bound;
  if(resolve.boundary.userId!==actorId)return refused(403,'actor');
  stage='capabilities';
  const allowed=async(c:SupabaseClient,ch:'whatsapp'|'instagram')=>{
   const {data,error}=await c.rpc('has_company_capability',{p_company_id:companyId,p_capability:ch==='whatsapp'?'wa.conversations.read':'ig.conversations.read'});
   if(error||typeof data!=='boolean')throw new Error('INBOX_WATCH_UNAVAILABLE');
   return data;
  };
  const names=['whatsapp','instagram'] as const;
  const permissions=await Promise.all(names.map(ch=>allowed(client,ch)));
  const channels=names.filter((_,i)=>permissions[i]);
  if(!channels.length)return refused(403,'capabilities');
  stage='realtime';
  await client.realtime.setAuth(resolve.accessToken);
  return branchInboxEventStream({client,scope:{companyId,channels},signal:request.signal,authorize:async()=>{
   const fresh=await createBrokerBoundClient({fresh:true});
   if(!fresh.bound.ok&&fresh.bound.code==='UNAVAILABLE')throw new Error('INBOX_WATCH_UNAVAILABLE');
   if(!fresh.bound.ok||fresh.bound.resolve.boundary.userId!==actorId||fresh.bound.resolve.boundary.boundaryFingerprint!==resolve.boundary.boundaryFingerprint)return false;
   const currentClient=fresh.bound.client;
   return (await Promise.all(channels.map(ch=>allowed(currentClient,ch)))).every(Boolean);
  }});
 }catch{return refused(503,stage);}
}
