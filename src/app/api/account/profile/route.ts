import {readAttestedAccountProfile} from '@/lib/tenancy/account-profile-read';
import {runAccountReadRequest} from '@/lib/supabase/account-read-request';
import {readAuthCorrelationHeaders} from '@/lib/diagnostics/correlation.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
const token=/^[A-Za-z0-9_-]{1,128}$/;
export async function GET(request:Request){
 const failure=(code:string,status:number)=>Response.json({ok:false,code},{status,headers});
 const origin=request.headers.get('origin');
 if(request.headers.get('sec-fetch-site')==='cross-site'||(origin&&origin!==new URL(request.url).origin))return failure('FORBIDDEN',403);
 const expected={userId:request.headers.get('x-velora-account')??'',boundaryFingerprint:request.headers.get('x-velora-boundary')??'',generation:request.headers.get('x-velora-generation')??''};
 if(new URL(request.url).search||Object.values(expected).some(value=>!token.test(value)))return failure('INVALID_INPUT',400);
 try{
  const result=await runAccountReadRequest(request.signal,()=>readAttestedAccountProfile(expected,readAuthCorrelationHeaders(request.headers)));
  return Response.json(result,{status:result.ok?200:result.code==='UNAUTHENTICATED'?401:result.code==='CONFLICT'?409:503,headers});
 }catch{return failure('UNAVAILABLE',503);}
}
