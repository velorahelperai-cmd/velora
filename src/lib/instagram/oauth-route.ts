import type {ConnectionResult} from './connection-contracts';
import {validDiagnostic,type DiagnosticDetail} from '@/lib/diagnostics/contract';
export const INSTAGRAM_ATTEMPT_COOKIE='velora_instagram_attempt';
type Ports=Readonly<{readAttempt():Promise<string|undefined>;complete(input:{attemptId:string;state:string;code:string}):Promise<ConnectionResult|{ok:false;code:string}>;clearAttempt():Promise<void>;appOrigin:string}>;
/** Pure route adapter: opaque HttpOnly attempt lookup; no code/state in redirects,
 * response bodies, logs or persisted diagnostics. Invalid callbacks do not erase
 * a legitimate pending cookie; ambiguous outcomes retain recovery identity. */
export async function handleInstagramOAuthCallback(request:Request,ports:Ports):Promise<Response>{
 let status='not_authorized',diagnostic:DiagnosticDetail|undefined;
 try{
  const u=new URL(request.url),codes=u.searchParams.getAll('code'),states=u.searchParams.getAll('state');
  if(request.method==='GET'&&codes.length===1&&states.length===1&&codes[0].length>0&&codes[0].length<=16384&&!/[\x00-\x1f\x7f]/.test(codes[0])&&/^[a-f0-9]{64}$/.test(states[0])&&!u.searchParams.has('error')){
   const attemptId=await ports.readAttempt();
   if(attemptId&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(attemptId)){
    const result=await ports.complete({attemptId,state:states[0],code:codes[0]});
    if(!result.ok&&'diagnostic' in result&&validDiagnostic(result.diagnostic)&&result.diagnostic.operation==='instagram_connect')diagnostic=result.diagnostic;
    if(result.ok){status='connected';await ports.clearAttempt();}
    else if(['RECONCILIATION_REQUIRED','UNAVAILABLE'].includes(result.code))status='needs_review';
    else if(['CONNECT_DISABLED','SETUP_REQUIRED','SCHEMA_UNAVAILABLE'].includes(result.code))status='setup_required';
   }
  }
 }catch{status='needs_review';}
 const redirect=new URL('/app/instagram',ports.appOrigin);redirect.searchParams.set('connection',status);
 if(diagnostic){redirect.searchParams.set('support',diagnostic.reference);redirect.searchParams.set('phase',diagnostic.stage);}
 return new Response(null,{status:303,headers:{Location:redirect.href,'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer'}});
}
