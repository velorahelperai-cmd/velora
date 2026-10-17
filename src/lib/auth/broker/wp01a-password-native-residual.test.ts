import {randomUUID,randomBytes} from 'node:crypto';
import {beforeAll,afterAll,afterEach,describe,it,expect,vi} from 'vitest';
import {createClient,type Session} from '@supabase/supabase-js';
import type {Client} from 'pg';
const fault=vi.hoisted(()=>({app:'' as string,cleanup:'' as string,mutations:0,appCalls:0}));
// Fault injection only: delegate every authority call to the real admin client;
// replace only the named app-revoke reply AFTER its real RPC effect; no authority mock.
vi.mock('@/lib/supabase/admin',async original=>{const real=await original<typeof import('@/lib/supabase/admin')>();return {createAdminClient:()=>{const c=real.createAdminClient();if(!c)return c;const rpc=c.rpc.bind(c);c.rpc=(async(name:string,args:unknown)=>{if(name==='vel_broker_revoke_sessions_at'){fault.appCalls++;if(fault.app){const actual=await rpc(name as never,args as never);if(actual.error||actual.data!==true)throw Error('REAL_APP_REVOKE_PREREQUISITE_FAILED');}if(fault.app==='throw')return Promise.reject(Error('INJECTED_APP_REVOKE_TRANSPORT'));if(fault.app)return Promise.resolve(fault.app==='false'?{data:false,error:null}:fault.app==='error'?{data:null,error:{code:'INJECTED_TRANSPORT'}}:fault.app==='missing'?{}:{data:{ok:true},error:null});}return rpc(name as never,args as never);}) as unknown as typeof c.rpc;return c;}};});
import {encryptSecret} from './crypto';
import {brokerUpdatePassword} from './password';
import {resumeBrokerOperation} from './recovery';
import {loadBrokerOperation,probeBrokerCapability} from './registry';
import type {BrokerResolveResult} from './types';
const enabled=process.env.VELORA_PASSWORD_NATIVE_RESIDUAL==='1';
const url=process.env.NEXT_PUBLIC_SUPABASE_URL||'';
const anon=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||'';
const service=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const opts={auth:{persistSession:false,autoRefreshToken:false}};
type Resolved=Extract<BrokerResolveResult,{ok:true}>;
type PasswordInput=Parameters<typeof brokerUpdatePassword>[0]&{
  operationKey:string;expectedUserId:string;expectedBoundaryFingerprint:string;
};
type JsonBag={ok?:boolean;intent_id?:string;claimed?:boolean;registry_id?:string};
type QueryRow=Record<string,unknown>&{j?:JsonBag;ok?:boolean;barrier_active?:boolean;status?:string;id?:string;browser_lineage_id?:string};
/** Real admitted vel_broker_sessions (+ lineage tip) columns used for Resolved envelope. */
type AdmittedSessionRow={
  id:string;
  cookie_name:string;
  generation:string;
  auth_ordinal:number|string;
  lineage_generation:number|string|null;
  browser_lineage_id:string|null;
  token_expires_at:Date|string;
  refresh_revision:number|string;
  handle_hash:string;
  user_id:string;
  native_session_id:string;
};
type PasswordFixture={
  email:string;password:string;user:string;session:Session;
  row:AdmittedSessionRow;
  resolved:Resolved;
};
let db!:Client;let originalFetch:typeof fetch;
const sid=(s:Pick<Session,'access_token'>)=>JSON.parse(Buffer.from(s.access_token.split('.')[1]!,'base64url').toString()).session_id;
const enc=(s:string)=>encryptSecret(s)!.toString('base64');
function asIso(value:Date|string):string{
  if(value instanceof Date)return value.toISOString();
  return String(value);
}
function asNumber(value:number|string):number{
  const n=typeof value==='number'?value:Number(value);
  if(!Number.isFinite(n))throw new Error('ADMITTED_NUMERIC_FIELD');
  return n;
}
function requireAdmittedRow(value:Record<string,unknown>):AdmittedSessionRow{
  const id=value.id;const cookie_name=value.cookie_name;const generation=value.generation;
  const handle_hash=value.handle_hash;const user_id=value.user_id;const native_session_id=value.native_session_id;
  const token_expires_at=value.token_expires_at;const refresh_revision=value.refresh_revision;
  const auth_ordinal=value.auth_ordinal;
  if(typeof id!=='string'||typeof cookie_name!=='string'||typeof generation!=='string')throw new Error('ADMITTED_SESSION_ROW_IDENTITY');
  if(typeof handle_hash!=='string'||typeof user_id!=='string'||typeof native_session_id!=='string')throw new Error('ADMITTED_SESSION_ROW_BINDINGS');
  if(!(token_expires_at instanceof Date)&&typeof token_expires_at!=='string')throw new Error('ADMITTED_SESSION_ROW_EXPIRES');
  if(typeof refresh_revision!=='number'&&typeof refresh_revision!=='string')throw new Error('ADMITTED_SESSION_ROW_REVISION');
  if(typeof auth_ordinal!=='number'&&typeof auth_ordinal!=='string')throw new Error('ADMITTED_SESSION_ROW_ORDINAL');
  const lineage_generation=value.lineage_generation;
  if(lineage_generation!=null&&typeof lineage_generation!=='number'&&typeof lineage_generation!=='string')throw new Error('ADMITTED_SESSION_ROW_LINEAGE');
  const browser_lineage_id=value.browser_lineage_id;
  if(browser_lineage_id!=null&&typeof browser_lineage_id!=='string')throw new Error('ADMITTED_SESSION_ROW_LINEAGE_ID');
  return{id,cookie_name,generation,auth_ordinal,lineage_generation:lineage_generation??null,browser_lineage_id:browser_lineage_id??null,token_expires_at,refresh_revision,handle_hash,user_id,native_session_id};
}
/** Map resolve.ts 156-171 shape from the actual admitted DB row + live session tokens. */
function resolvedFromAdmitted(row:AdmittedSessionRow,session:Session):Resolved{
  const authOrdinal=asNumber(row.auth_ordinal);
  return{
    ok:true,
    boundary:{
      boundaryFingerprint:'synthetic-exact-fingerprint',
      userId:row.user_id,
      nativeSessionId:row.native_session_id,
      cookieName:row.cookie_name,
      generation:row.generation,
      authOrdinal,
      contextGeneration:asNumber(row.lineage_generation??authOrdinal),
      browserLineageId:row.browser_lineage_id,
    },
    accessToken:session.access_token,
    refreshToken:session.refresh_token,
    expiresAt:asIso(row.token_expires_at),
    refreshRevision:asNumber(row.refresh_revision),
    registryId:row.id,
    authOrdinal,
    handleHash:row.handle_hash,
  };
}
async function login(email:string,password:string){const c=createClient(url,anon,opts);const r=await c.auth.signInWithPassword({email,password});expect(r.error?.message).toBeUndefined();expect(r.data.session).toBeTruthy();return r.data.session!;}
async function fixture(){const email='wp01a-password-'+randomUUID()+'@example.invalid',password=randomBytes(24).toString('base64url')+'aA7!';const a=createClient(url,service,opts);const r=await a.auth.admin.createUser({email,password,email_confirm:true});expect(r.error).toBeNull();const session=await login(email,password);const admitted=await admit(r.data.user!.id,session);return {email,password,user:r.data.user!.id,session,...admitted};}
async function admit(user:string,session:Session){await db.query('set role service_role');try{const hash=randomBytes(32).toString('hex'),generation=randomBytes(16).toString('hex');const q=async(sql:string,args:unknown[])=>{const r=await db.query(sql,args);return r.rows[0] as QueryRow;};
const bootstrap=randomBytes(32).toString('hex');const root=await q('select public.vel_broker_bind_browser_continuity($1) j',[bootstrap]);expect(root.j?.ok).toBe(true);
const r=await q("select public.vel_broker_reserve_bound_intent($1,$2::uuid,'password_login',null,600) j",[bootstrap,randomUUID()]);
// bind returns root id, while reserve takes the bootstrap hash supplied at bind.
return await finishAdmission(root,r,user,session,hash,generation);
}finally{await db.query('reset role');}}
async function finishAdmission(root:QueryRow,r:QueryRow,user:string,session:Session,hash:string,generation:string){expect(r.j?.ok).toBe(true);const intent=r.j!.intent_id!;const query=async(sql:string,args:unknown[])=> (await db.query(sql,args)).rows[0] as QueryRow;expect((await query('select public.vel_broker_claim_provider_attempt($1::uuid) j',[intent])).j?.claimed).toBe(true);const access=enc(session.access_token),refresh=enc(session.refresh_token);expect((await query("select public.vel_broker_record_provider_session($1::uuid,$2::uuid,$3::uuid,$4,$5,now()+interval '1 hour') ok",[intent,user,sid(session),access,refresh])).ok).toBe(true);const admitted=await query("select public.vel_broker_admit_bound_session($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,now()+interval '1 hour','app',null,$9) j",[intent,user,sid(session),hash,'vel_sh_'+generation,generation,access,refresh,enc('synthetic-handle-'+generation)]);expect(admitted.j?.ok).toBe(true);const raw=(await db.query(`select s.id, s.cookie_name, s.generation, s.auth_ordinal, s.token_expires_at, s.refresh_revision, s.browser_lineage_id, s.handle_hash, s.user_id, s.native_session_id, l.current_generation as lineage_generation from public.vel_broker_sessions s left join public.vel_broker_browser_lineages l on l.id = s.browser_lineage_id where s.id = $1`,[admitted.j!.registry_id])).rows[0];if(!raw)throw new Error('ADMITTED_SESSION_ROW_MISSING');const row=requireAdmittedRow(raw);return {row,resolved:resolvedFromAdmitted(row,session)};}
function input(f:PasswordFixture,key= randomUUID()):PasswordInput{return {resolved:f.resolved,password:randomBytes(24).toString('base64url')+'bB8!',operationKey:key,expectedUserId:f.user,expectedBoundaryFingerprint:'synthetic-exact-fingerprint',writer:{set:vi.fn()}};}
async function assertChanged(f:Pick<PasswordFixture,'email'|'password'>,password:string){const c=createClient(url,anon,opts);expect((await c.auth.signInWithPassword({email:f.email,password:f.password})).error).toBeTruthy();await login(f.email,password);}

describe.skipIf(!enabled)('WP01A M15/M16/M17 real local native password residuals',()=>{
beforeAll(async()=>{expect(new URL(url).hostname).toBe('127.0.0.1');expect(new URL(url).port).toBe('3430');const databaseUrl=process.env.VELORA_WP01A_DATABASE_URL!;expect(new URL(databaseUrl).hostname).toBe('127.0.0.1');expect(new URL(databaseUrl).pathname).toBe('/c1_ui_integration');const pg=await import('pg');db=new pg.default.Client({connectionString:databaseUrl});await db.connect();expect((await probeBrokerCapability()).ok).toBe(true);originalFetch=globalThis.fetch;vi.stubGlobal('fetch',async (request:RequestInfo|URL,init?:RequestInit)=>{const address=String(request instanceof Request?request.url:request);const method=init?.method||(request instanceof Request?request.method:undefined);if(address.includes('/auth/v1/user')&&method==='PUT')fault.mutations++;if(address.includes('/auth/v1/logout')&&fault.cleanup){if(fault.cleanup==='after')await originalFetch(request,init);return new Response(JSON.stringify({msg:'INJECTED_CLEANUP_TRANSPORT_UNKNOWN'}),{status:503,headers:{'Content-Type':'application/json'}});}return originalFetch(request,init);});},30000);
afterEach(()=>{fault.app='';fault.cleanup='';fault.mutations=0;fault.appCalls=0;});afterAll(async()=>{vi.unstubAllGlobals();await db?.end();});
it.each(['false','error','missing','malformed','throw'])('M15 native password changed, app reply %s remains durable pending and cannot replay',async mode=>{const f=await fixture(),i=input(f);fault.app=mode;const result=await brokerUpdatePassword(i);expect(result).toMatchObject({ok:false,message:'PASSWORD_CHANGED_SESSION_REVOCATION_PENDING',stages:{credentialMutation:'confirmed'}});const before=await loadBrokerOperation(i.operationKey);expect(before).toMatchObject({status:'pending',snapshotFrozen:true,stages:{credentialMutation:'confirmed'}});expect(before!.cutoff).toBe(before!.credentialMutatedAt);expect(before!.targetSnapshot).toHaveLength(1);expect(((await db.query('select barrier_active from public.vel_broker_admission where user_id=$1',[f.user])).rows[0] as QueryRow).barrier_active).toBe(true);await assertChanged(f,i.password);expect(fault.mutations).toBe(1);expect((await brokerUpdatePassword(i)).ok).toBe(false);expect(fault.mutations).toBe(1);if(mode!=='throw'){expect((await resumeBrokerOperation({operationKey:i.operationKey,actorUserId:f.user,writer:i.writer})).ok).toBe(false);expect(fault.mutations).toBe(1);}expect((await loadBrokerOperation(i.operationKey))!.cutoff).toBe(before!.cutoff);},30000);
it('M16 real epoch and cleanup UNKNOWN stays pending with native target present; exact absence permits original resume',async()=>{const f=await fixture(),i=input(f);fault.cleanup='before';const result=await brokerUpdatePassword(i);expect(result).toMatchObject({ok:false,stages:{credentialMutation:'confirmed',appRevocation:'confirmed',nativeRevocation:'unknown'}});const before=await loadBrokerOperation(i.operationKey);expect(before!.status).toBe('pending');expect((await db.query('select id from auth.sessions where id=$1',[sid(f.session)])).rows).toHaveLength(1);expect((await db.query('select revoked_before from private.master_account_session_revocations where user_id=$1',[f.user])).rows).toHaveLength(1);expect((await resumeBrokerOperation({operationKey:i.operationKey,actorUserId:f.user,writer:i.writer})).ok).toBe(false);expect((await loadBrokerOperation(i.operationKey))!.status).toBe('pending');fault.cleanup='';const cleanup=await createClient(url,service,opts).auth.admin.signOut(f.session.access_token,'local');expect(cleanup.error).toBeNull();expect((await db.query('select id from auth.sessions where id=$1',[sid(f.session)])).rows).toHaveLength(0);const done=await resumeBrokerOperation({operationKey:i.operationKey,actorUserId:f.user,writer:i.writer});expect(done).toMatchObject({ok:true,status:'confirmed'});expect(fault.mutations).toBe(1);},30000);
it('M17 original operation resume after same-user post-barrier B preserves B, cutoff and frozen targets',async()=>{const f=await fixture(),i=input(f);fault.app='false';expect((await brokerUpdatePassword(i)).ok).toBe(false);const frozen=await loadBrokerOperation(i.operationKey);fault.app='';expect((await resumeBrokerOperation({operationKey:i.operationKey,actorUserId:f.user,writer:i.writer})).ok).toBe(true);const b=await login(f.email,i.password);const admitted=await admit(f.user,b);expect(((await db.query('select barrier_active from public.vel_broker_admission where user_id=$1',[f.user])).rows[0] as QueryRow).barrier_active).toBe(false);expect((await resumeBrokerOperation({operationKey:i.operationKey,actorUserId:f.user,writer:i.writer})).ok).toBe(true);const after=await loadBrokerOperation(i.operationKey);expect(after!.cutoff).toBe(frozen!.cutoff);expect(after!.targetSnapshot).toEqual(frozen!.targetSnapshot);expect(((await db.query('select status from public.vel_broker_sessions where id=$1',[admitted.row.id])).rows[0] as QueryRow).status).toBe('active');expect((await db.query('select id from auth.sessions where id=$1',[sid(b)])).rows).toHaveLength(1);expect((await createClient(url,anon,opts).auth.getUser(b.access_token)).error).toBeNull();expect(fault.mutations).toBe(1);},30000);
});
