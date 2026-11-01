import {recoverOwnedBranchAssistantTrialAction} from '@/lib/tenancy/paid-assistant-trial-actions';
import {readSessionIdentity} from '@/lib/auth/server-identity';
import {createAdminClient} from '@/lib/supabase/admin';
import {getAnswerProvider} from '@/lib/answers/provider';
import type {TrialProviderHandle} from '@/lib/answers/types';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie','X-Content-Type-Options':'nosniff','Content-Type':'application/x-ndjson; charset=utf-8'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** The existing /setup trial's read transport. Never starts or settles a generation. */
export async function GET(request:Request){
 const fail=(status:number)=>Response.json({error:'UNAVAILABLE'},{status,headers});
 const url=new URL(request.url),q=url.searchParams;
 const input={operationId:q.get('operationId')??'',expectedAccountId:q.get('expectedAccountId')??'',companyId:q.get('companyId')??'',branchId:q.get('branchId')??''};
 if(Object.values(input).some(id=>!uuid.test(id))||[...q.keys()].some(key=>q.getAll(key).length!==1))return fail(400);
 if(request.headers.get('sec-fetch-site')==='cross-site')return fail(403);
 const pinned=process.env.VELORA_TRIAL_PINNED_BRANCH_ID?.trim();
 const restricted=process.env.VELORA_LOCAL_CUSTOMER_MODE==='live'||Boolean(pinned);
 const cap=Number(process.env.VELORA_TRIAL_BUDGET_CAP_BAISA);
 if(restricted&&(!pinned||input.branchId!==pinned||!Number.isFinite(cap)||cap<=0||cap>2))return fail(403);
 try{
  const identity=await readSessionIdentity();
  if(!identity.ok)return fail(401);
  if(identity.userId!==input.expectedAccountId||!uuid.test(identity.nativeSessionId??'')||identity.boundaryFingerprint!==request.headers.get('x-velora-boundary'))return fail(403);
  const writer=createAdminClient();if(!writer)return fail(503);
  const result=await writer.rpc('es02_read_trial_stream' as never,{p_operation_id:input.operationId,p_account_id:identity.userId,p_session_id:identity.nativeSessionId,p_company_id:input.companyId,p_branch_id:input.branchId} as never);
  const data=result.data as unknown as {ok?:boolean;handle?:TrialProviderHandle|null};
  if(result.error||data?.ok!==true)return fail(403);
  const provider=getAnswerProvider();
  if(!data.handle||!provider?.streamTrial)return new Response(null,{status:204,headers});
  const abort=new AbortController();const signal=AbortSignal.any([request.signal,abort.signal]);
  const timer=setTimeout(()=>abort.abort(),25_000);
  const iterator=provider.streamTrial(data.handle,signal)[Symbol.asyncIterator]();
  const encoder=new TextEncoder();
  const stream=new ReadableStream<Uint8Array>({
   async pull(controller){
    try{const item=await iterator.next();if(item.done){clearTimeout(timer);controller.close();return;}controller.enqueue(encoder.encode(JSON.stringify({text:item.value})+'\n'));}
    catch{clearTimeout(timer);controller.close();}
   },
   async cancel(){clearTimeout(timer);abort.abort();await iterator.return?.();}
  });
  return new Response(stream,{headers});
 }catch{return fail(503);}
}

/** Recover/checkpoint/settle the existing request through the established guarded action only. */
export async function POST(request:Request){
 const jsonHeaders={...headers,'Content-Type':'application/json; charset=utf-8'};
 const fail=(status:number)=>Response.json({error:'UNAVAILABLE'},{status,headers:jsonHeaders});
 const url=new URL(request.url),q=url.searchParams;
 const input={operationId:q.get('operationId')??'',expectedAccountId:q.get('expectedAccountId')??'',companyId:q.get('companyId')??'',branchId:q.get('branchId')??''};
 if(Object.values(input).some(id=>!uuid.test(id))||[...q.keys()].some(key=>q.getAll(key).length!==1))return fail(400);
 if(request.headers.get('sec-fetch-site')==='cross-site'||(request.headers.get('origin')&&request.headers.get('origin')!==url.origin))return fail(403);
 try{
  const identity=await readSessionIdentity();
  if(!identity.ok)return fail(401);
  if(identity.userId!==input.expectedAccountId||identity.boundaryFingerprint!==request.headers.get('x-velora-boundary'))return fail(403);
  // Action independently checks native session, pinned scope, DB ownership and original pricing.
  return Response.json(await recoverOwnedBranchAssistantTrialAction(input),{headers:jsonHeaders});
 }catch{return fail(503);}
}
