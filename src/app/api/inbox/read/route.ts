import {readServiceInbox} from '@/lib/customer/service-inbox-actions';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Private read transport, outside the browser's mutation/Server Action queue.
 * Expected IDs are response fences, never authority. The native reader resolves
 * the session and enforces tenant, capability and final scope checks itself. */
export async function GET(request:Request){
 const started=performance.now(),query=new URL(request.url).searchParams;
 const companyId=query.get('companyId')??'',actorId=query.get('actorId')??'';
 const failure=(code:string,status:number)=>Response.json({ok:false,code},{status,headers});
 if(!uuid.test(companyId)||!uuid.test(actorId)||[...query.keys()].some(key=>!['companyId','actorId'].includes(key)||query.getAll(key).length!==1))return failure('INVALID_INPUT',400);
 try{
  const result=await readServiceInbox();
  if(result.ok&&(result.companyId!==companyId||result.actorId!==actorId))return failure('SCOPE_CHANGED',409);
  return Response.json(result,{headers:{...headers,'Server-Timing':`inbox-read;dur=${(performance.now()-started).toFixed(1)}`}});
 }catch{return failure('UNAVAILABLE',503);}
}
