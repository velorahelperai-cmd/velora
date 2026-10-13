'use server';
import {randomBytes,randomUUID} from 'node:crypto';
import {cookies} from 'next/headers';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';
import {getCompanyAccess} from '@/lib/tenancy/access';
import {instagramConfig} from './config';
import {instagramOwnerConnectScope} from './connect-scope';
import {exchangeInstagramCode,instagramAuthorizationUrl,readInstagramOAuthConfig} from './oauth-meta';
import {createInstagramConnectionStore,startInstagramConnection,type InstagramRpcClient} from './connection-store';
import {completeInstagramConnection} from './connection-flow';
import type {AttemptBinding,ConnectionResult} from './connection-contracts';
import {INSTAGRAM_ATTEMPT_COOKIE} from './oauth-route';
import {ensureInstagramSubscription} from './subscription';
type Failure={ok:false;code:'FORBIDDEN'|'INVALID_INPUT'|'WORKSPACE_CHANGED'|'UNAVAILABLE'|'SCHEMA_UNAVAILABLE'|'CONNECT_DISABLED'|'SETUP_REQUIRED'|'RECONCILIATION_REQUIRED'|'CONFLICT'|'EXPIRED'|'CONSUMED'};
type Status={ok:true;generation:number;link:{linkId:string;accountId:string;generation:number}|null;attemptKind:string|null;contractReady:boolean;connectEnabled:boolean};
const fail=(code:Failure['code']):Failure=>({ok:false,code});
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const generation=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0&&(v as number)<Number.MAX_SAFE_INTEGER;
function keys(v:unknown,fields:string[]):v is Record<string,unknown>{return object(v)&&Object.keys(v).length===fields.length&&fields.every(k=>k in v);}
async function native(companyId?:string){
 const access=await getCompanyAccess('owner');
 if(!access.ok||access.context.membership?.role!=='owner'||access.context.membership.status!=='active'||!uuid(access.context.company?.id)||!uuid(access.context.userId))return fail('FORBIDDEN');
 const company=access.context.company.id.toLowerCase(),user=access.context.userId.toLowerCase();
 if(companyId&&companyId!==company)return fail('WORKSPACE_CHANGED');
 const client=await createClient(),claims=await client.auth.getClaims();
 if(claims.error||claims.data?.claims.sub!==user||!uuid(claims.data.claims.session_id))return fail('FORBIDDEN');
 return {client:client as unknown as InstagramRpcClient,identity:{companyId:company,userId:user,sessionId:claims.data.claims.session_id.toLowerCase()}};
}
function denial(data:Record<string,unknown>):Failure|null{
 if(data.ok!==false)return null;
 const allowed=['FORBIDDEN','INVALID_INPUT','UNAVAILABLE','CONFLICT','RECONCILIATION_REQUIRED','EXPIRED','CONSUMED'];
 return fail(allowed.includes(String(data.code))?data.code as Failure['code']:'UNAVAILABLE');
}
async function rpc(client:InstagramRpcClient,name:string,args:Record<string,unknown>):Promise<Record<string,unknown>>{
 const {data,error}=await client.rpc(name,args);
 if(error)return fail(object(error)&&['PGRST202','42883'].includes(String(error.code))?'SCHEMA_UNAVAILABLE':'UNAVAILABLE');
 return object(data)?denial(data)??data:fail('UNAVAILABLE');
}
async function status(client:InstagramRpcClient,companyId:string,userId:string):Promise<Status|Failure>{
 const cfg=readInstagramOAuthConfig();
 const data=await rpc(client,'instagram_owner_connection',{p_company_id:companyId,p_app_id:cfg?.appId??null,p_contract_id:cfg?.contractId??null});
 if(data.ok===false)return data as Failure;
 if(data.ok!==true||!generation(data.generation)||typeof data.contractReady!=='boolean')return fail('UNAVAILABLE');
 let link:Status['link']=null;
 if(data.link!==null){const v=data.link;if(!object(v)||!uuid(v.linkId)||typeof v.accountId!=='string'||!/^\d{1,64}$/.test(v.accountId)||!generation(v.generation)||v.generation<1)return fail('UNAVAILABLE');link={linkId:v.linkId.toLowerCase(),accountId:v.accountId,generation:v.generation};}
 const kinds=['pending','claimed','vault_staged','bound','rejected','unknown','expired','cancelled'];
 if(data.attemptKind!==null&&!kinds.includes(String(data.attemptKind)))return fail('UNAVAILABLE');
 return {ok:true,generation:data.generation,link,attemptKind:data.attemptKind as string|null,contractReady:!!cfg&&data.contractReady,connectEnabled:instagramConfig().connectEnabled&&!!cfg&&instagramOwnerConnectScope(companyId,userId,cfg.appId)};
}
export async function loadInstagramOwnerConnection(input:{companyId:string}):Promise<Status|Failure>{
 if(!keys(input,['companyId'])||!uuid(input.companyId))return fail('INVALID_INPUT');
 const company=input.companyId.toLowerCase();
 try{const session=await native(company);return 'ok' in session?session:await status(session.client,company,session.identity.userId);}catch{return fail('UNAVAILABLE');}
}
export async function startInstagramOwnerConnection(input:{companyId:string}):Promise<{ok:true;authorizationUrl:string}|Failure>{
 if(!keys(input,['companyId'])||!uuid(input.companyId))return fail('INVALID_INPUT');
 const company=input.companyId.toLowerCase();
 try{
  const session=await native(company);if('ok' in session)return session;
  if(!instagramConfig().connectEnabled)return fail('CONNECT_DISABLED');
  const cfg=readInstagramOAuthConfig();if(!cfg)return fail('SETUP_REQUIRED');
  if(!instagramOwnerConnectScope(session.identity.companyId,session.identity.userId,cfg.appId))return fail('CONNECT_DISABLED');
  const current=await status(session.client,company,session.identity.userId);if(!current.ok)return current;
  if(!current.contractReady)return fail('SETUP_REQUIRED');
  if(['claimed','vault_staged','unknown'].includes(current.attemptKind??''))return fail('RECONCILIATION_REQUIRED');
  const attemptId=randomUUID(),state=randomBytes(32).toString('hex'),authorizationUrl=instagramAuthorizationUrl(cfg,state);
  if(!authorizationUrl)return fail('CONNECT_DISABLED');
  const started=await startInstagramConnection(session.client,{companyId:company,attemptId,state,appId:cfg.appId,contractId:cfg.contractId,expectedGeneration:current.generation});
  if(!started.ok)return started;
  if(started.binding.userId!==session.identity.userId||started.binding.sessionId!==session.identity.sessionId)return fail('FORBIDDEN');
  const maxAge=Math.min(600,Math.floor((Date.parse(started.expiresAt)-Date.now())/1000));if(maxAge<=0)return fail('EXPIRED');
  (await cookies()).set(INSTAGRAM_ATTEMPT_COOKIE,attemptId,{httpOnly:true,secure:new URL(cfg.redirectUri).protocol==='https:',sameSite:'lax',path:'/api/instagram/oauth/callback',maxAge});
  return {ok:true,authorizationUrl};
 }catch{return fail('RECONCILIATION_REQUIRED');}
}
function binding(v:unknown):v is AttemptBinding{
 return keys(v,['companyId','userId','sessionId','attemptId','generation','appId','contractId'])&&[v.companyId,v.userId,v.sessionId,v.attemptId].every(uuid)&&generation(v.generation)&&v.generation>0&&typeof v.appId==='string'&&v.appId.length>0&&typeof v.contractId==='string'&&v.contractId.length>0;
}
export async function completeInstagramOwnerOAuth(input:{attemptId:string;state:string;code:string}):Promise<ConnectionResult|Failure>{
 if(!keys(input,['attemptId','state','code'])||!uuid(input.attemptId)||typeof input.state!=='string'||! /^[a-f0-9]{64}$/.test(input.state)||typeof input.code!=='string'||!input.code||input.code.length>16384||/[\x00-\x1f\x7f]/.test(input.code))return fail('INVALID_INPUT');
 const captured={attemptId:input.attemptId.toLowerCase(),state:input.state,code:input.code};
 try{
  const session=await native();if('ok' in session)return session;
  if(!instagramConfig().connectEnabled)return fail('CONNECT_DISABLED');
  const cfg=readInstagramOAuthConfig();if(!cfg)return fail('SETUP_REQUIRED');
  if(!instagramOwnerConnectScope(session.identity.companyId,session.identity.userId,cfg.appId))return fail('CONNECT_DISABLED');
  const data=await rpc(session.client,'instagram_owner_attempt',{p_company_id:session.identity.companyId,p_attempt_id:captured.attemptId});
  if(data.ok===false)return data as Failure;
  if(data.ok!==true||!binding(data.binding))return fail('UNAVAILABLE');
  const b=Object.freeze({...data.binding});
  if(b.companyId!==session.identity.companyId||b.userId!==session.identity.userId||b.sessionId!==session.identity.sessionId||b.attemptId!==captured.attemptId||b.appId!==cfg.appId||b.contractId!==cfg.contractId)return fail('FORBIDDEN');
  const server=createAdminClient();if(!server)return fail('UNAVAILABLE');
  const store=createInstagramConnectionStore(session.client,server as unknown as InstagramRpcClient);
  const permitted=()=>instagramConfig().connectEnabled&&instagramOwnerConnectScope(b.companyId,b.userId,b.appId);
  return await completeInstagramConnection(session.identity,captured,b,{...store,
   stage:(ref,success)=>permitted()?store.stage(ref,success):Promise.resolve({ok:false,code:'FORBIDDEN'}),
   finalize:(ref,receipt)=>permitted()?store.finalize(ref,receipt):Promise.resolve({ok:false,code:'FORBIDDEN'}),
   exchange:(code,ref)=>exchangeInstagramCode(code,ref,cfg),
   subscribe:(ref,receipt)=>ensureInstagramSubscription(ref,receipt,server as unknown as InstagramRpcClient)});
 }catch{return fail('RECONCILIATION_REQUIRED');}
}
export async function disconnectInstagramOwnerConnection(input:{companyId:string;linkId:string;expectedGeneration:number}):Promise<{ok:true}|Failure>{
 if(!keys(input,['companyId','linkId','expectedGeneration'])||!uuid(input.companyId)||!uuid(input.linkId)||!generation(input.expectedGeneration))return fail('INVALID_INPUT');
 const captured={companyId:input.companyId.toLowerCase(),linkId:input.linkId.toLowerCase(),expectedGeneration:input.expectedGeneration};
 try{const session=await native(captured.companyId);if('ok' in session)return session;
  const data=await rpc(session.client,'instagram_disconnect_connection',{p_company_id:captured.companyId,p_link_id:captured.linkId,p_expected_generation:captured.expectedGeneration});
  if(data.ok===false)return data as Failure;
  return data.ok===true&&data.linkId===captured.linkId&&generation(data.generation)?{ok:true}:fail('UNAVAILABLE');
 }catch{return fail('UNAVAILABLE');}
}
