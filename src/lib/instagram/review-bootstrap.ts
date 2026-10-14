import type {InstagramWebhookPersistenceBatch} from './webhook-route';
import {readInstagramWebhookBody} from './webhook-route';
import {createHash} from 'node:crypto';
import {verifyAndParseInstagramWebhook} from './webhook-parse';
type Ports={enabled:boolean;secret:string;readScope:()=>Promise<{accountId:string;nonceSha256:string;expiresAt:string}|null>;observe:(batch:InstagramWebhookPersistenceBatch)=>Promise<{status:string}>;onRejected?:(code:string,raw:Uint8Array,signature:string)=>void};
export async function tryInstagramReviewBootstrap(request:Request,ports:Ports):Promise<Response|null>{
 if(!ports.enabled)return null;
 try{
  const scope=await ports.readScope();if(!scope)return null;
  if(!/^\d{1,64}$/.test(scope.accountId)||!(/^[a-f0-9]{64}$/).test(scope.nonceSha256)||!Number.isFinite(Date.parse(scope.expiresAt))||Date.parse(scope.expiresAt)<=Date.now()
   ||request.method!=='POST'||!/^application\/json(?:\s*;\s*charset=(?:utf-8|"utf-8"))?$/i.test(request.headers.get('content-type')??'')||!ports.secret||ports.secret!==ports.secret.trim())return new Response('review bootstrap unavailable',{status:503});
  const read=await readInstagramWebhookBody(request);if('failure' in read)return read.failure;
  const parsed=verifyAndParseInstagramWebhook(read.raw,[request.headers.get('x-hub-signature-256')??''],{source:'parent_webhook_app',value:ports.secret});
  if(!parsed.ok){ports.onRejected?.(parsed.code,read.raw,request.headers.get('x-hub-signature-256')??'');return new Response('invalid signed event',{status:parsed.code==='INVALID_SIGNATURE'?401:400});}
  const now=Date.now();
  const matches=parsed.events.filter(e=>e.kind==='message'&&e.direction==='inbound'&&e.isEcho!==true&&e.professionalAccountId===scope.accountId
   &&e.content.kind==='text'&&createHash('sha256').update(e.content.text).digest('hex')===scope.nonceSha256
   &&typeof e.rawTimestamp==='number'&&Number.isSafeInteger(e.rawTimestamp)&&e.rawTimestamp<=now&&e.rawTimestamp>now-30*60000);
  if(matches.length!==1||parsed.events.some(e=>e.professionalAccountId!==scope.accountId)){ports.onRejected?.('CHALLENGE_MISMATCH',read.raw,request.headers.get('x-hub-signature-256')??'');return new Response('review challenge not matched',{status:503});}
  const batch:InstagramWebhookPersistenceBatch={events:parsed.events,rawBodySha256:createHash('sha256').update(read.raw).digest('hex'),localReceivedAt:new Date().toISOString()};
  const result=await ports.observe(batch);
  if(result.status!=='committed')ports.onRejected?.('PERSISTENCE_UNPROVEN',read.raw,request.headers.get('x-hub-signature-256')??'');
  return new Response(result.status==='committed'?'ok':'review proof unavailable',{status:result.status==='committed'?200:503,headers:{'cache-control':'no-store'}});
 }catch{return new Response('review proof unavailable',{status:503});}
}
