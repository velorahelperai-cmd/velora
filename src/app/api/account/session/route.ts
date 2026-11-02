import {readAccountSession} from '@/lib/auth/account-session-read';
import {readAuthCorrelationHeaders} from '@/lib/diagnostics/correlation.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
export async function GET(request:Request){
 const failure=(code:string,status:number)=>Response.json({ok:false,code},{status,headers});
 const url=new URL(request.url),origin=request.headers.get('origin');
 if(request.headers.get('sec-fetch-site')==='cross-site'||(origin&&origin!==url.origin))return failure('FORBIDDEN',403);
 if(url.search)return failure('INVALID_INPUT',400);
 try{
  const result=await readAccountSession(readAuthCorrelationHeaders(request.headers));
  return Response.json(result,{status:result.ok?200:result.code==='UNAUTHENTICATED'?401:result.code==='CONFLICT'?409:503,headers});
 }catch{return failure('UNAVAILABLE',503);}
}
