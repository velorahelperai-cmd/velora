import {readAccountSession} from '@/lib/auth/account-session-read';
import {runAccountReadRequest} from '@/lib/supabase/account-read-request';
import {readAuthCorrelationHeaders} from '@/lib/diagnostics/correlation.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
export async function GET(request:Request){
 const failure=(code:string,status:number)=>Response.json({ok:false,code},{status,headers});
 const url=new URL(request.url),origin=request.headers.get('origin');
 if(request.headers.get('sec-fetch-site')==='cross-site'||(origin&&origin!==url.origin))return failure('FORBIDDEN',403);
 if(url.search)return failure('INVALID_INPUT',400);
 const activity=request.headers.get('x-velora-document-activity');
 if(activity&&activity!=='setup')return failure('INVALID_INPUT',400);
 if(activity){
  try{const referer=new URL(request.headers.get('referer')??'');if(referer.origin!==url.origin||referer.pathname!=='/setup')return failure('FORBIDDEN',403);}
  catch{return failure('FORBIDDEN',403);}
 }
 try{
  const result=await runAccountReadRequest(request.signal,()=>activity?readAccountSession(readAuthCorrelationHeaders(request.headers),true):readAccountSession(readAuthCorrelationHeaders(request.headers)));
  return Response.json(result,{status:result.ok?200:result.code==='UNAUTHENTICATED'?401:result.code==='CONFLICT'?409:503,headers});
 }catch{return failure('UNAVAILABLE',503);}
}
