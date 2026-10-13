import 'server-only';
import type {AttemptBinding,ConnectionFailure,ConnectionFailureCode} from './connection-contracts';
import type {InstagramRpcClient} from './connection-store';
import {instagramConfig} from './config';
import {subscribeInstagramMessages,type InstagramSubscriptionInput,type InstagramSubscriptionOutcome} from './subscription-meta';

type Result=Readonly<{ok:true}>|ConnectionFailure;
type State='unstarted'|'claimed'|'verified'|'rejected'|'unknown';
type Checkpoint=Readonly<{state:State;binding:AttemptBinding;stageReceipt:string;accountId:string;fields:readonly ['messages']}>;
type Claim=Checkpoint&Readonly<{kind:'claimed';committed:true;claimReceipt:string;accessToken:string;notAfter:string}>;
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const fail=(code:ConnectionFailureCode):ConnectionFailure=>({ok:false,code});
const review=():ConnectionFailure=>fail('RECONCILIATION_REQUIRED');
function denial(v:unknown):ConnectionFailure|null{
 if(!object(v)||v.ok!==false)return null;
 switch(v.code){case 'FORBIDDEN':case 'EXPIRED':case 'CONSUMED':case 'INVALID_INPUT':case 'UNAVAILABLE':case 'RECONCILIATION_REQUIRED':return fail(v.code);default:return review();}
}
function checkpoint(v:unknown,b:AttemptBinding,receipt:string):Checkpoint|null{
 if(!object(v)||!object(v.binding))return null;
 const got=v.binding;
 if(!['unstarted','claimed','verified','rejected','unknown'].includes(String(v.state))
  ||Object.keys(b).some(key=>got[key]!==b[key as keyof AttemptBinding])
  ||v.stageReceipt!==receipt||typeof v.accountId!=='string'||!/^\d{1,64}$/.test(v.accountId)
  ||!Array.isArray(v.fields)||v.fields.length!==1||v.fields[0]!=='messages')return null;
 return Object.freeze({state:v.state as State,binding:b,stageReceipt:receipt,accountId:v.accountId,fields:Object.freeze(['messages'] as const)});
}
function result(v:Checkpoint|null):Result{return v?.state==='verified'?{ok:true}:v?.state==='rejected'?fail('CONSUMED'):review();}
async function rpc(server:InstagramRpcClient,name:string,args:Record<string,unknown>):Promise<unknown>{
 const {data,error}=await server.rpc(name,args);if(error)throw Error('INSTAGRAM_SUBSCRIPTION_STORE_UNAVAILABLE');return data;
}
/** Server-internal only: committed single-use subscription claim; Vault token is
 * never returned by this module. Unknown/claimed requires review, never another
 * POST. A lost SQL response permits only one durable checkpoint read. No GET
 * recovery is implemented without a reviewed primary response contract. */
export async function ensureInstagramSubscription(supplied:AttemptBinding,stageReceipt:string,server:InstagramRpcClient,dependencies:{transport?:(input:InstagramSubscriptionInput)=>Promise<InstagramSubscriptionOutcome>;now?:()=>number}={}):Promise<Result>{
 try{
  if(!object(supplied)||![supplied.companyId,supplied.userId,supplied.sessionId,supplied.attemptId].every(uuid)
   ||typeof supplied.appId!=='string'||!/^\d{1,64}$/.test(supplied.appId)||typeof supplied.contractId!=='string'||!supplied.contractId||supplied.contractId.length>128
   ||!Number.isSafeInteger(supplied.generation)||supplied.generation<1||!uuid(stageReceipt))return fail('INVALID_INPUT');
  const b:AttemptBinding=Object.freeze({companyId:supplied.companyId,userId:supplied.userId,sessionId:supplied.sessionId,attemptId:supplied.attemptId,generation:supplied.generation,appId:supplied.appId,contractId:supplied.contractId});
  const args={p_binding:b,p_stage_receipt:stageReceipt};
  async function read():Promise<Result>{try{const data=await rpc(server,'instagram_read_subscription',args);return denial(data)??result(checkpoint(data,b,stageReceipt));}catch{return review();}}
  let raw:unknown;
  try{raw=await rpc(server,'instagram_claim_subscription',args);}catch{return read();}
  const denied=denial(raw);if(denied)return denied;
  if(!object(raw))return read();
  const proof=checkpoint(raw,b,stageReceipt);
  if(!proof)return review();
  if(raw.kind==='existing')return result(proof);
  if(raw.kind!=='claimed'||raw.committed!==true||proof.state!=='claimed'||!uuid(raw.claimReceipt)
   ||typeof raw.accessToken!=='string'||!raw.accessToken||raw.accessToken.length>16384||/[\s\x00-\x1f\x7f]/.test(raw.accessToken)
   ||typeof raw.notAfter!=='string'||!Number.isFinite(Date.parse(raw.notAfter)))return review();
  const claim:Claim=Object.freeze({...proof,kind:'claimed',committed:true,claimReceipt:raw.claimReceipt,accessToken:raw.accessToken,notAfter:raw.notAfter});
  let outcome:InstagramSubscriptionOutcome='unknown';
  try{
   const now=dependencies.now?.()??Date.now();
   if(Number.isFinite(now)&&now<Date.parse(claim.notAfter)&&instagramConfig().connectEnabled){
    outcome=await(dependencies.transport??subscribeInstagramMessages)({accountId:claim.accountId,accessToken:claim.accessToken});
   }
  }catch{outcome='unknown';}
  if(!['verified','rejected','unknown'].includes(outcome))outcome='unknown';
  try{
   const data=await rpc(server,'instagram_settle_subscription',{...args,p_claim_receipt:claim.claimReceipt,p_outcome:outcome});
   return denial(data)??result(checkpoint(data,b,stageReceipt));
  }catch{return read();}
 }catch{return review();}
}
