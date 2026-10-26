'use server';
import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformOwner } from '@/lib/tenancy/access';
import { RejectedEffect, runDeletionStep, type ClaimedStep } from './runner';
import type { DeletionReceipt, DeletionResponse } from './types';

type RpcClient={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:{message?:string;code?:string}|null}>};
type Authority={actor:string;session:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeCodes=['FORBIDDEN','PROTECTED_OWNER','NOT_FOUND','PROTECTED_DEPENDENCY','PREVIEW_EXPIRED','CONFIRMATION_MISMATCH','OPERATION_ACTOR_MISMATCH','SCHEMA_CHANGED_REVIEW_REQUIRED','SCOPE_TOO_LARGE','ACCOUNT_DELETING','STALE_CLAIM','SCOPE_CHANGED','PROTECTED_RELATION_REQUIRES_REVIEW'];
function code(e:unknown){const message=e instanceof Error?e.message:'';return safeCodes.find(c=>message.includes(c))??'UNAVAILABLE';}
async function command(action:string,input:Record<string,unknown>={}){
 const client=await createClient() as unknown as RpcClient;
 const result=await client.rpc('account_deletion_command',{p_action:action,p_input:input});
 if(result.error)throw Error(result.error.message??'UNAVAILABLE');
 return result.data;
}
async function authorize():Promise<Authority>{
 const access=await requirePlatformOwner();if(!access.ok)throw Error(access.code);
 // Fresh database authority on every action/effect, independent of React request cache.
 return await command('authorize') as Authority;
}
function validInput(input:Record<string,unknown>){
 for(const key of ['id','target','requestId'])if(input[key]!==undefined&&(typeof input[key]!=='string'||!uuid.test(input[key])))throw Error('NOT_FOUND');
}
export async function accountDeletionAction(action:'preview'|'status'|'lookup'|'renew'|'start'|'classify',input:Record<string,unknown>):Promise<DeletionResponse>{
 try{
  if(!['preview','status','lookup','renew','start','classify'].includes(action))throw Error('FORBIDDEN');
  validInput(input);await authorize();
  if(action==='classify'&&typeof input.isTest!=='boolean')throw Error('FORBIDDEN');
  const data=await command(action,input) as DeletionReceipt & {code?:string;receipt?:DeletionReceipt;diff?:never[]};
  if(action==='classify')return {ok:true,data:null};
  if(data?.code)return {ok:true,data:data.receipt??null,code:data.code,diff:data.diff};
  return {ok:true,data};
 }catch(e){return {ok:false,code:code(e)};}
}

export async function advanceAccountDeletion(id:string):Promise<DeletionResponse>{
 try{
  if(!uuid.test(id))throw Error('NOT_FOUND');
  const admin=createAdminClient();if(!admin)throw Error('UNAVAILABLE');
  const rpcAdmin=admin as unknown as RpcClient;
  let authority:Authority;
  const fresh=async()=>{authority=await authorize();};
  const worker=async(step:ClaimedStep,action:string,outcome:string|null=null,errorCode:string|null=null)=>{
   await fresh();
   const r=await rpcAdmin.rpc('account_deletion_worker',{p_actor:authority.actor,p_session:authority.session,p_id:id,p_claim:step.claim,p_action:action,p_outcome:outcome,p_code:errorCode});
   if(r.error){
    if(action==='database'&&['23503','23514','P0001'].includes(r.error.code??''))throw new RejectedEffect((r.error.message??'').includes('SCOPE_CHANGED')?'SCOPE_CHANGED':'PROTECTED_RELATION_REQUIRES_REVIEW');
    throw Error(r.error.message??'UNAVAILABLE');
   }return r.data as {effect?:'ABSENT'|'PRESENT'|'UNKNOWN'|'CHANGED';absent?:boolean;presentObjects?:{bucket:string;path:string;version:string}[]};
  };
  await runDeletionStep({
   authorize:fresh,
   claim:async()=>await command('claim',{id}) as ClaimedStep|null,
   inspect:async step=>{
    if(step.stage==='AUTH'){
     await fresh();const r=await admin.auth.admin.getUserById(step.target);
     if(r.error){if(r.error.status===404&&r.error.code==='user_not_found')return 'ABSENT';return 'UNKNOWN';}
     return r.data.user?'PRESENT':'UNKNOWN';
    }
    const result=await worker(step,step.stage==='VERIFY'?'verify':'inspect');
    return step.stage==='VERIFY'?(result.absent?'ABSENT':'UNKNOWN'):(result.effect??'UNKNOWN');
   },
   remove:async step=>{
    if(step.stage==='AUTH'){
     await worker(step,'permit');const r=await admin.auth.admin.deleteUser(step.target,false);if(r.error){if(r.error.status&&r.error.status>=400&&r.error.status<500)throw new RejectedEffect('PROVIDER_REJECTED');throw Error('EFFECT_UNCONFIRMED');}
    }else if(step.stage==='STORAGE'){
     for(const bucket of new Set(step.objects.map(o=>o.bucket))){
      // Storage accepts at most 1000 paths per remove request. Reconcile the
      // exact confirmed object generations before every bounded batch.
      let pending=step.objects.filter(o=>o.bucket===bucket);
      while(pending.length){
       await fresh();const check=await worker(step,'inspect');if(check.effect==='CHANGED')throw new RejectedEffect('SCOPE_CHANGED');
       if(check.effect==='ABSENT')break;
       if(check.effect!=='PRESENT'||!check.presentObjects)throw Error('EFFECT_UNCONFIRMED');
       const remaining=pending.filter(o=>check.presentObjects?.some(p=>p.bucket===o.bucket&&p.path===o.path&&p.version===o.version));
       if(!remaining.length)break;
       const batch=remaining.slice(0,1000);
       await worker(step,'permit');
       const r=await admin.storage.from(bucket).remove(batch.map(o=>({path:o.path,versionId:o.version})));if(r.error){const status=Number((r.error as {statusCode?:string}).statusCode);if(status>=400&&status<500)throw new RejectedEffect('PROVIDER_REJECTED');throw Error('EFFECT_UNCONFIRMED');}
       pending=remaining;
      }
     }
    }else if(step.stage==='DATABASE'){await worker(step,'database');}
   },
   finish:async(outcome,errorCode,step)=>{await worker(step,'finish',outcome,errorCode);},
  });
  return {ok:true,data:await command('status',{id}) as DeletionReceipt};
 }catch(e){return {ok:false,code:code(e)};}
}
