/**
 * WP01B / ES01 E04 — durable recovery review with real native JWT (opt-in).
 *
 * Fixture contract (explicit):
 * - Owned local-http-stack loopback (migrationScope `wp01a-auth` includes
 *   `20261014033009_master_identity_recovery.sql` and `20261016*` tip-fence
 *   corrective migration) OR an equivalent owned loopback GoTrue+PostgREST+Postgres.
 * - Native users A/B and two real Auth sessions for A are created in-memory;
 *   JWTs never logged. Admin/postgres SQL is only a positive count control —
 *   not JWT/RLS proof.
 * - Outcome classes:
 *   - disabled gate → Skip (not Pass)
 *   - enabled incomplete/unsafe config → Fail (fixture invalid)
 *   - timeout / unmet hold prerequisite → InvalidFixture (not ApplicationDefect)
 *   - real denial/effect assertions → Pass/Fail product evidence
 *
 * Gate:
 *   VELORA_WP01B_RECOVERY_FIXTURES=1
 * Optional attach-to-owned-stack (all or none):
 *   VELORA_WP01B_STACK_URL, VELORA_WP01B_ANON_KEY, VELORA_WP01B_SERVICE_ROLE_KEY,
 *   VELORA_WP01B_DATABASE_URL (loopback host via URL parser)
 * Optional owned ports when auto-starting stack:
 *   VELORA_WP01B_GATEWAY_PORT (default 3730), AUTH/REST/DB +1/+2/+3
 *
 * Codex (Cursor does not run):
 *   npx vitest run src/lib/tenancy/identity-recovery.test.ts \
 *     src/lib/tenancy/identity-recovery-actions.test.ts \
 *     src/components/app/identity-recovery-ui.test.tsx
 *   VELORA_WP01B_RECOVERY_FIXTURES=1 npx vitest run \
 *     src/lib/tenancy/identity-recovery.wp01b.integration.test.ts
 *
 * No Production / hosted Supabase / SMS / OAuth / WP01A redefinition.
 */
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import {createClient,type SupabaseClient} from "@supabase/supabase-js";

const ENABLED=process.env.VELORA_WP01B_RECOVERY_FIXTURES==="1";
const STACK_URL=process.env.VELORA_WP01B_STACK_URL?.trim()||"";
const ANON=process.env.VELORA_WP01B_ANON_KEY?.trim()||"";
const SERVICE=process.env.VELORA_WP01B_SERVICE_ROLE_KEY?.trim()||"";
const DATABASE_URL=process.env.VELORA_WP01B_DATABASE_URL?.trim()||"";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bounded waits — not free-RAM gates. Hold must establish within this window. */
const HOLD_ESTABLISH_MS=8_000;
const RACE_OPEN_MS=20_000;

type StackHandle={
 url:string;
 anonKey:string;
 serviceRoleKey:string;
 databaseUrl?:string;
 close:()=>Promise<void>;
 sql:(text:string)=>Promise<string>;
 rows:(text:string)=>Promise<Record<string,unknown>[]>;
 adminCreateUser:(input:{email:string;password?:string})=>Promise<{id:string;email:string;password:string}>;
};

class InvalidFixtureError extends Error{
 constructor(message:string){
  super(`CI_WP01B_INVALID_FIXTURE:${message}`);
  this.name="InvalidFixtureError";
 }
}

function loopbackHostname(urlString:string,kind:"http"|"postgres"):string|null{
 try{
  const normalized=kind==="postgres"&&urlString.startsWith("postgres")
   ?urlString.replace(/^postgres(ql)?:/i,"http:")
   :urlString;
  const host=new URL(normalized).hostname.toLowerCase();
  if(host==="127.0.0.1"||host==="localhost"||host==="[::1]"||host==="::1")return host;
  return null;
 }catch{
  return null;
 }
}

function attachConfigError():string{
 const any=Boolean(STACK_URL||ANON||SERVICE||DATABASE_URL);
 if(!any)return "";
 if(!STACK_URL||!ANON||!SERVICE||!DATABASE_URL){
  return "attach mode requires STACK_URL+ANON+SERVICE+DATABASE_URL together";
 }
 if(!loopbackHostname(STACK_URL,"http"))return "STACK_URL host must be loopback";
 if(!loopbackHostname(DATABASE_URL,"postgres"))return "DATABASE_URL host must be loopback";
 if(/supabase\.co|pooler\.supabase/i.test(STACK_URL+DATABASE_URL))return "hosted URL refused";
 return "";
}

function sessionIdFromAccessToken(token:string):string{
 const payload=JSON.parse(Buffer.from(token.split(".")[1]??"","base64url").toString("utf8"));
 if(!UUID.test(String(payload.session_id)))throw new InvalidFixtureError("JWT_MISSING_SESSION");
 return payload.session_id;
}

describe.skipIf(ENABLED)("WP01B recovery fixtures (offline)",()=>{
 it.skip("requires VELORA_WP01B_RECOVERY_FIXTURES=1 with owned loopback JWT stack",()=>{
  expect(ENABLED).toBe(false);
 });
});

describe.skipIf(!ENABLED)("WP01B identity recovery durable reconcile (native JWT)",()=>{
 let stack:StackHandle;
 let owned=false;
 let fixtureDatabaseUrl="";
 let userA:{id:string;email:string;password:string};
 let userB:{id:string;email:string;password:string};
 let clientA:SupabaseClient;
 let clientA2:SupabaseClient;
 let clientB:SupabaseClient;
 let sessionA:string;
 let sessionA2:string;
 let tipA:{registryId:string;lineageId:string};
 let tipA2:{registryId:string;lineageId:string};
 let tipB:{registryId:string;lineageId:string};
 const tokens=new Set<string>();

 /** Seed active broker tip for a native session (fixture-owned; not browser admit). */
 async function seedBrokerTip(input:{
  userId:string;
  nativeSessionId:string;
  lineageId?:string;
  makeCurrent?:boolean;
 }):Promise<{registryId:string;lineageId:string}>{
  const lineageId=input.lineageId??randomUUID();
  const registryId=randomUUID();
  const suffix=registryId.replaceAll("-","").slice(0,16);
  if(!input.lineageId){
   await stack.sql(`
    insert into public.vel_broker_browser_lineages(id,bootstrap_hash,latest_reserved_generation,current_generation,state,valid_until)
    values ('${lineageId}','boot-${suffix}',1,1,'active',clock_timestamp()+interval '30 days')`);
  }
  await stack.sql(`
   insert into public.vel_broker_sessions(
    id,handle_hash,cookie_name,generation,user_id,native_session_id,
    access_token_enc,refresh_token_enc,token_expires_at,status,browser_lineage_id,refresh_state,last_seen_at
   ) values (
    '${registryId}',
    'hh-${suffix}',
    'vel_sh_${suffix}',
    'gen-${suffix}',
    '${input.userId}',
    '${input.nativeSessionId}',
    'enc-access','enc-refresh',clock_timestamp()+interval '1 hour','active','${lineageId}','idle',clock_timestamp()
   )`);
  if(input.makeCurrent!==false){
   await stack.sql(`
    update public.vel_broker_browser_lineages
    set current_registry_id='${registryId}',
        current_generation=coalesce(current_generation,0)+1,
        updated_at=clock_timestamp()
    where id='${lineageId}'`);
  }
  return {registryId,lineageId};
 }

 async function advanceTip(lineageId:string,fromRegistryId:string,to:{registryId:string}){
  await stack.sql(`update public.vel_broker_sessions set status='tombstoned',updated_at=clock_timestamp() where id='${fromRegistryId}'`);
  await stack.sql(`update public.vel_broker_sessions set status='active',updated_at=clock_timestamp() where id='${to.registryId}'`);
  await stack.sql(`
   update public.vel_broker_browser_lineages
   set current_registry_id='${to.registryId}',
       current_generation=current_generation+1,
       updated_at=clock_timestamp()
   where id='${lineageId}'`);
 }

 /** Real SDK observation: status/statusText are top-level (503 often has no error.status). */
 async function rpc(
  client:SupabaseClient,
  name:string,
  args:Record<string,unknown>,
 ):Promise<{status:number;statusText:string;data:unknown;error:unknown}>{
  const observation=await client.rpc(name as never,args as never) as {
   data:unknown;
   error:unknown;
   status?:number;
   statusText?:string;
  };
  const {data,error}=observation;
  let status=typeof observation.status==="number"?observation.status:NaN;
  let statusText=typeof observation.statusText==="string"?observation.statusText:"";
  if(!Number.isFinite(status)){
   if(typeof error==="object"&&error&&"status" in error&&typeof (error as {status?:unknown}).status==="number"){
    status=(error as {status:number}).status;
   }else if(error&&typeof error==="object"&&"code" in error&&(error as {code?:string}).code==="42501"){
    status=403;
   }else if(error){
    status=400;
   }else{
    status=200;
   }
  }
  if(!statusText&&typeof error==="object"&&error&&"message" in error){
   statusText=String((error as {message?:unknown}).message??"");
  }
  return {status,statusText,data,error};
}

 beforeAll(async()=>{
  const attachErr=attachConfigError();
  if(attachErr)throw new InvalidFixtureError(attachErr);

  if(STACK_URL){
   const {default:Pg}=await import("pg");
   const pg=new Pg.Client({connectionString:DATABASE_URL});
   await pg.connect();
   fixtureDatabaseUrl=DATABASE_URL;
   stack={
    url:STACK_URL,
    anonKey:ANON,
    serviceRoleKey:SERVICE,
    databaseUrl:DATABASE_URL,
    close:async()=>{await pg.end();},
    sql:async(text)=>{await pg.query(text);return "";},
    rows:async(text)=>(await pg.query(text)).rows as Record<string,unknown>[],
    adminCreateUser:async()=>{throw new InvalidFixtureError("ATTACH_MODE_USES_AUTH_ADMIN_VIA_SERVICE");},
   };
   const create=async(label:string)=>{
    const email=`wp01b-${label}-${randomUUID()}@example.invalid`;
    const password=`Wp01b-${randomUUID()}!`;
    const response=await fetch(`${STACK_URL}/auth/v1/admin/users`,{
     method:"POST",
     headers:{
      apikey:SERVICE,
      Authorization:`Bearer ${SERVICE}`,
      "Content-Type":"application/json",
     },
     body:JSON.stringify({email,password,email_confirm:true}),
    });
    if(!response.ok)throw new InvalidFixtureError(`USER_CREATE_${response.status}`);
    const body=await response.json() as {id?:string};
    if(!body.id||!UUID.test(body.id))throw new InvalidFixtureError("USER_ID");
    return {id:body.id,email,password};
   };
   userA=await create("a");
   userB=await create("b");
  }else{
   const gateway=Number(process.env.VELORA_WP01B_GATEWAY_PORT||3730);
   const authPort=Number(process.env.VELORA_WP01B_AUTH_PORT||gateway+10);
   const restPort=Number(process.env.VELORA_WP01B_REST_PORT||gateway+11);
   const databasePort=Number(process.env.VELORA_WP01B_DATABASE_PORT||gateway+12);
   if(![gateway,authPort,restPort,databasePort].every((n)=>Number.isInteger(n)&&n>0&&n<65536)){
    throw new InvalidFixtureError("ports");
   }
   const fixtureModule=new URL("../../../scripts/integration/local-http-stack.mjs",import.meta.url).href;
   const {startStack}=await import(/* @vite-ignore */ fixtureModule) as {
    startStack:(opts:Record<string,unknown>)=>Promise<StackHandle>;
   };
   stack=await startStack({
    gatewayPort:gateway,
    authPort,
    restPort,
    databasePort,
    migrationScope:"wp01a-auth",
    canonicalSqlLineEndings:true,
    reuseUpstreamConnections:true,
    progress:()=>{},
   });
   if(!loopbackHostname(stack.url,"http"))throw new InvalidFixtureError("stack host");
   owned=true;
   fixtureDatabaseUrl=stack.databaseUrl||"";
   if(!fixtureDatabaseUrl||!loopbackHostname(fixtureDatabaseUrl,"postgres")){
    throw new InvalidFixtureError("owned_stack_missing_loopback_databaseUrl");
   }
   userA=await stack.adminCreateUser({email:`wp01b-a-${randomUUID()}@example.invalid`});
   userB=await stack.adminCreateUser({email:`wp01b-b-${randomUUID()}@example.invalid`});
  }

  const login=async(user:{email:string;password:string})=>{
   const client=createClient(stack.url,stack.anonKey,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
   });
   const result=await client.auth.signInWithPassword({email:user.email,password:user.password});
   if(result.error||!result.data.session?.access_token)throw new InvalidFixtureError("LOGIN");
   tokens.add(result.data.session.access_token);
   tokens.add(result.data.session.refresh_token);
   return {client,session:result.data.session};
  };

  const a1=await login(userA);
  const a2=await login(userA);
  const b1=await login(userB);
  clientA=a1.client;
  clientA2=a2.client;
  clientB=b1.client;
  sessionA=sessionIdFromAccessToken(a1.session.access_token);
  sessionA2=sessionIdFromAccessToken(a2.session.access_token);
  if(sessionA===sessionA2)throw new InvalidFixtureError("SESSIONS_NOT_DISTINCT");
  if(userA.id===userB.id)throw new InvalidFixtureError("USERS_NOT_DISTINCT");

  // Tip-fence migration footprint must exist (E05) — fail closed if unknown.
  const tipFn=await stack.rows(`
   select p.pronargs::int as n
   from pg_proc p
   join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='private' and p.proname='master_open_recovery_case_tip'`);
  if(!tipFn.some((r)=>r.n===6)){
   throw new InvalidFixtureError("tip_fence_6arg_missing_apply_20261016180000");
  }

  // Same lineage for A→A2 tip advance; independent lineage for B (must survive).
  tipA=await seedBrokerTip({userId:userA.id,nativeSessionId:sessionA});
  tipA2=await seedBrokerTip({
   userId:userA.id,
   nativeSessionId:sessionA2,
   lineageId:tipA.lineageId,
   makeCurrent:false,
  });
  tipB=await seedBrokerTip({userId:userB.id,nativeSessionId:sessionIdFromAccessToken(b1.session.access_token)});
 },600_000);

 afterAll(async()=>{
  tokens.clear();
  try{
   if(stack)await stack.close();
  }finally{
   // Owned cleanup only in finally — never touch prior environments.
   void owned;
  }
 },120_000);

 it("open once + same requestKey replay + JWT read keep one case (strict ok/id/count)",async()=>{
  const requestKey=randomUUID();
  const first=await rpc(clientA,"master_open_identity_recovery_review",{
   p_expected_user_id:userA.id,
   p_reason:"lost_phone",
   p_request_key:requestKey,
   p_expected_native_session_id:sessionA,
   p_expected_registry_id:tipA.registryId,
   p_expected_browser_lineage_id:tipA.lineageId,
  });
  expect(first.error).toBeNull();
  expect(first.status).toBe(200);
  const firstBody=first.data as {ok?:boolean;data?:{id?:string;state?:string}};
  expect(firstBody.ok).toBe(true);
  expect(typeof firstBody.data?.id).toBe("string");
  expect(UUID.test(firstBody.data!.id!)).toBe(true);
  expect(firstBody.data?.state).toBe("review");

  const replay=await rpc(clientA,"master_open_identity_recovery_review",{
   p_expected_user_id:userA.id,
   p_reason:"lost_phone",
   p_request_key:requestKey,
   p_expected_native_session_id:sessionA,
   p_expected_registry_id:tipA.registryId,
   p_expected_browser_lineage_id:tipA.lineageId,
  });
  expect(replay.error).toBeNull();
  const replayBody=replay.data as {ok?:boolean;data?:{id?:string;state?:string}};
  expect(replayBody.ok).toBe(true);
  expect(replayBody.data?.id).toBe(firstBody.data!.id);
  expect(replayBody.data?.state).toBe(firstBody.data!.state);

  const read=await rpc(clientA,"master_read_identity_recovery_reviews",{
   p_expected_native_session_id:sessionA,
   p_expected_registry_id:tipA.registryId,
   p_expected_browser_lineage_id:tipA.lineageId,
  });
  expect(read.error).toBeNull();
  const view=read.data as {
   ok?:boolean;
   data?:{userId?:string;configuration?:string;cases?:Array<{id?:string;state?:string}>};
  };
  expect(view.ok).toBe(true);
  expect(view.data?.userId).toBe(userA.id);
  expect(view.data?.configuration).toBe("UNCONFIGURED");
  expect(view.data?.cases?.some((c)=>c.id===firstBody.data!.id&&c.state==="review")).toBe(true);

  const countRows=await stack.rows(
   `select count(*)::int as n from private.master_identity_recovery_cases where user_id='${userA.id}' and request_key='${requestKey}'`,
  );
  expect(countRows[0]?.n).toBe(1);
 });

 it("new requestKey while open reconciles to the original open case id",async()=>{
  const k1=randomUUID();
  const k2=randomUUID();
  const first=await rpc(clientA,"master_open_identity_recovery_review",{
   p_expected_user_id:userA.id,
   p_reason:"lost_phone",
   p_request_key:k1,
   p_expected_native_session_id:sessionA,
   p_expected_registry_id:tipA.registryId,
   p_expected_browser_lineage_id:tipA.lineageId,
  });
  const second=await rpc(clientA,"master_open_identity_recovery_review",{
   p_expected_user_id:userA.id,
   p_reason:"lost_phone",
   p_request_key:k2,
   p_expected_native_session_id:sessionA,
   p_expected_registry_id:tipA.registryId,
   p_expected_browser_lineage_id:tipA.lineageId,
  });
  const a=(first.data as {ok?:boolean;data?:{id?:string}});
  const b=(second.data as {ok?:boolean;data?:{id?:string}});
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  expect(typeof a.data?.id).toBe("string");
  expect(b.data?.id).toBe(a.data?.id);
 });

 it("stale p_expected_native_session_id (same user, foreign tip) denies without insert",async()=>{
  const before=await stack.rows(
   `select count(*)::int as n from private.master_identity_recovery_cases where user_id='${userA.id}'`,
  );
  const beforeN=before[0]?.n;
  const requestKey=randomUUID();
  // clientA JWT is sessionA; supply sessionA2 as expected tip → insufficient_privilege.
  const open=await rpc(clientA,"master_open_identity_recovery_review",{
   p_expected_user_id:userA.id,
   p_reason:"lost_phone",
   p_request_key:requestKey,
   p_expected_native_session_id:sessionA2,
   p_expected_registry_id:tipA2.registryId,
   p_expected_browser_lineage_id:tipA2.lineageId,
  });
  expect((open.data as {ok?:boolean}|null)?.ok===true).toBe(false);
  expect(open.status===403||Boolean(open.error)).toBe(true);
  const after=await stack.rows(
   `select count(*)::int as n from private.master_identity_recovery_cases where user_id='${userA.id}'`,
  );
  expect(after[0]?.n).toBe(beforeN);
  const keyed=await stack.rows(
   `select count(*)::int as n from private.master_identity_recovery_cases where request_key='${requestKey}'`,
  );
  expect(keyed[0]?.n).toBe(0);
 });

 it("foreign B JWT cannot open A's subject or read A's cases",async()=>{
  const before=await stack.rows(
   `select count(*)::int as n from private.master_identity_recovery_cases where user_id='${userA.id}'`,
  );
  const beforeN=before[0]?.n;
  expect(typeof beforeN).toBe("number");

  const open=await rpc(clientB,"master_open_identity_recovery_review",{
   p_expected_user_id:userA.id,
   p_reason:"lost_phone",
   p_request_key:randomUUID(),
   p_expected_native_session_id:sessionA,
   p_expected_registry_id:tipA.registryId,
   p_expected_browser_lineage_id:tipA.lineageId,
  });
  const openedOk=(open.data as {ok?:boolean}|null)?.ok===true;
  expect(openedOk).toBe(false);
  expect(open.status===403||Boolean(open.error)).toBe(true);

  const read=await rpc(clientB,"master_read_identity_recovery_reviews",{});
  const view=read.data as {ok?:boolean;data?:{userId?:string;cases?:Array<{userId?:string}>}}|null;
  if(view&&view.ok===true){
   expect(view.data?.userId).toBe(userB.id);
   expect(view.data?.cases?.some((c)=>c.userId===userA.id)).toBe(false);
  }

  const after=await stack.rows(
   `select count(*)::int as n from private.master_identity_recovery_cases where user_id='${userA.id}'`,
  );
  expect(after[0]?.n).toBe(beforeN);
 });

 /**
  * C01: tip B commits on the same lineage while old open waits on root lock → old deny, no case.
  * Both native sessions remain valid (not expiry). Hold = lineage advisory (admit/open order).
  */
 it("authority race: tip B commit under held root lock denies old captured open",async()=>{
  const {default:Pg}=await import("pg");
  if(!fixtureDatabaseUrl||!loopbackHostname(fixtureDatabaseUrl,"postgres")){
   throw new InvalidFixtureError("race_requires_loopback_DATABASE_URL_for_lock_hold");
  }
  // Ensure tip A is current and both natives valid before race.
  await stack.sql(`
   update public.vel_broker_sessions set status='active',updated_at=clock_timestamp()
   where id in ('${tipA.registryId}','${tipA2.registryId}');
   update public.vel_broker_browser_lineages
   set current_registry_id='${tipA.registryId}',updated_at=clock_timestamp()
   where id='${tipA.lineageId}';
   update auth.sessions set not_after=null where id in ('${sessionA}','${sessionA2}');
  `);

  const holdClient=new Pg.Client({connectionString:fixtureDatabaseUrl});
  await holdClient.connect();
  let holdReleased=false;
  try{
   await holdClient.query("begin");
   const establish=holdClient.query(
    `select pg_advisory_xact_lock(hashtextextended($1::text, 0)) as locked`,
    [tipA.lineageId],
   );
   const established=await Promise.race([
    establish.then(()=>true as const),
    new Promise<false>((resolve)=>setTimeout(()=>resolve(false),HOLD_ESTABLISH_MS)),
   ]);
   if(!established){
    throw new InvalidFixtureError(`root_lineage_lock_hold_not_established_within_${HOLD_ESTABLISH_MS}ms`);
   }

   const before=await stack.rows(
    `select count(*)::int as n from private.master_identity_recovery_cases where user_id='${userA.id}'`,
   );
   const beforeN=Number(before[0]?.n??0);
   const staleKey=randomUUID();

   // Old open waits on lineage root lock (same key as admit/open).
   const staleOpen=rpc(clientA,"master_open_identity_recovery_review",{
    p_expected_user_id:userA.id,
    p_reason:"lost_phone",
    p_request_key:staleKey,
    p_expected_native_session_id:sessionA,
    p_expected_registry_id:tipA.registryId,
    p_expected_browser_lineage_id:tipA.lineageId,
   });

   // While old waits: commit tip B on same lineage (holder connection).
   await holdClient.query(
    `update public.vel_broker_sessions set status='tombstoned',updated_at=clock_timestamp() where id=$1`,
    [tipA.registryId],
   );
   await holdClient.query(
    `update public.vel_broker_sessions set status='active',updated_at=clock_timestamp() where id=$1`,
    [tipA2.registryId],
   );
   await holdClient.query(
    `update public.vel_broker_browser_lineages
     set current_registry_id=$1,current_generation=current_generation+1,updated_at=clock_timestamp()
     where id=$2`,
    [tipA2.registryId,tipA.lineageId],
   );
   const tipRow=await holdClient.query(
    `select current_registry_id::text as id from public.vel_broker_browser_lineages where id=$1`,
    [tipA.lineageId],
   );
   if(tipRow.rows[0]?.id!==tipA2.registryId){
    throw new InvalidFixtureError("tip_B_not_committed_under_hold");
   }
   const natives=await holdClient.query(
    `select count(*)::int as n from auth.sessions
     where id=any($1::uuid[]) and (not_after is null or not_after>clock_timestamp())`,
    [[sessionA,sessionA2]],
   );
   if(Number(natives.rows[0]?.n)!==2){
    throw new InvalidFixtureError("both_native_sessions_must_remain_valid_for_tip_race");
   }

   await holdClient.query("commit");
   holdReleased=true;

   const stale=await Promise.race([
    staleOpen,
    new Promise<"timeout">((resolve)=>setTimeout(()=>resolve("timeout"),RACE_OPEN_MS)),
   ]);
   if(stale==="timeout")throw new InvalidFixtureError(`old_open_timeout_${RACE_OPEN_MS}ms`);
   expect((stale.data as {ok?:boolean}|null)?.ok===true).toBe(false);
   expect(stale.status===403||Boolean(stale.error)).toBe(true);

   const staleRows=await stack.rows(
    `select count(*)::int as n from private.master_identity_recovery_cases where request_key='${staleKey}'`,
   );
   expect(staleRows[0]?.n).toBe(0);
   const after=await stack.rows(
    `select count(*)::int as n from private.master_identity_recovery_cases where user_id='${userA.id}'`,
   );
   expect(after[0]?.n).toBe(beforeN);

   // Positive control: current tip A2 can still open/reconcile under same delay/lock class.
   const freshKey=randomUUID();
   const fresh=await rpc(clientA2,"master_open_identity_recovery_review",{
    p_expected_user_id:userA.id,
    p_reason:"lost_phone",
    p_request_key:freshKey,
    p_expected_native_session_id:sessionA2,
    p_expected_registry_id:tipA2.registryId,
    p_expected_browser_lineage_id:tipA2.lineageId,
   });
   const freshBody=fresh.data as {ok?:boolean;data?:{id?:string}}|null;
   if(freshBody?.ok!==true||!UUID.test(String(freshBody.data?.id??""))){
    throw new InvalidFixtureError(
     `positive_control_no_durable_case:status=${fresh.status};ok=${String(freshBody?.ok)}`,
    );
   }
   // Independent lineage B tip survives tip-A advance.
   const bTip=await stack.rows(
    `select current_registry_id::text as id from public.vel_broker_browser_lineages where id='${tipB.lineageId}'`,
   );
   expect(bTip[0]?.id).toBe(tipB.registryId);
  }finally{
   if(!holdReleased){
    try{await holdClient.query("rollback");}catch{/* */}
   }
   await holdClient.end().catch(()=>{});
  }
 },60_000);

 it("A2 tip (same lineage) can read original case after tip advance; policy UNCONFIGURED",async()=>{
  await advanceTip(tipA.lineageId,tipA.registryId,tipA2);
  const read=await rpc(clientA2,"master_read_identity_recovery_reviews",{
   p_expected_native_session_id:sessionA2,
   p_expected_registry_id:tipA2.registryId,
   p_expected_browser_lineage_id:tipA2.lineageId,
  });
  expect(read.error).toBeNull();
  const view=read.data as {
   ok?:boolean;
   data?:{userId?:string;configuration?:string;cases?:Array<{id?:string}>};
  };
  expect(view.ok).toBe(true);
  expect(view.data?.userId).toBe(userA.id);
  expect(view.data?.configuration).toBe("UNCONFIGURED");
  expect((view.data?.cases?.length??0)>0).toBe(true);
  expect(sessionA).not.toBe(sessionA2);
 });

 it("expired native session A rejects open; audit unchanged; tip A2 still reads",async()=>{
  const eventsBefore=await stack.rows(
   `select count(*)::int as n from private.master_identity_recovery_events e
    join private.master_identity_recovery_cases c on c.id=e.case_id
    where c.user_id='${userA.id}'`,
  );
  const n0=eventsBefore[0]?.n;
  expect(typeof n0).toBe("number");

  await stack.sql(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${sessionA}'`);

  // Re-activate tip A capture against expired native — must deny (expiry path, not tip race).
  await stack.sql(`
   update public.vel_broker_sessions set status='active' where id='${tipA.registryId}';
   update public.vel_broker_browser_lineages
   set current_registry_id='${tipA.registryId}' where id='${tipA.lineageId}'`);

  const open=await rpc(clientA,"master_open_identity_recovery_review",{
   p_expected_user_id:userA.id,
   p_reason:"lost_phone",
   p_request_key:randomUUID(),
   p_expected_native_session_id:sessionA,
   p_expected_registry_id:tipA.registryId,
   p_expected_browser_lineage_id:tipA.lineageId,
  });
  expect((open.data as {ok?:boolean}|null)?.ok===true).toBe(false);

  const eventsAfter=await stack.rows(
   `select count(*)::int as n from private.master_identity_recovery_events e
    join private.master_identity_recovery_cases c on c.id=e.case_id
    where c.user_id='${userA.id}'`,
  );
  expect(eventsAfter[0]?.n).toBe(n0);

  await advanceTip(tipA.lineageId,tipA.registryId,tipA2);
  const readA2=await rpc(clientA2,"master_read_identity_recovery_reviews",{
   p_expected_native_session_id:sessionA2,
   p_expected_registry_id:tipA2.registryId,
   p_expected_browser_lineage_id:tipA2.lineageId,
  });
  expect((readA2.data as {ok?:boolean})?.ok).toBe(true);
 });

 it("private recovery tables deny SELECT to anon/authenticated (grant control)",async()=>{
  for(const table of [
   "private.master_identity_recovery_cases",
   "private.master_identity_recovery_evidence",
   "private.master_identity_recovery_events",
  ]){
   const denied=await stack.rows(`
    select count(*)::int as n
    from information_schema.role_table_grants
    where table_schema='private'
      and table_name='${table.split(".")[1]}'
      and grantee in ('anon','authenticated')
      and privilege_type='SELECT'`);
   expect(denied[0]?.n).toBe(0);
  }
 });

 it("legacy 3-arg open resolves tip from JWT; superseded native A denies; tip A2 may succeed",async()=>{
  // A native is expired/tombstoned tip after prior tests — 3-arg must not invent authority.
  const stale=await rpc(clientA,"master_open_identity_recovery_review",{
   p_expected_user_id:userA.id,
   p_reason:"lost_phone",
   p_request_key:randomUUID(),
  });
  expect((stale.data as {ok?:boolean}|null)?.ok===true).toBe(false);

  const open=await rpc(clientA2,"master_open_identity_recovery_review",{
   p_expected_user_id:userA.id,
   p_reason:"lost_phone",
   p_request_key:randomUUID(),
  });
  // Tip A2 JWT → server tip resolve may open/reconcile; never foreign-user success.
  if((open.data as {ok?:boolean}|null)?.ok===true){
   expect(open.status).toBe(200);
  }else{
   expect(open.status===403||Boolean(open.error)).toBe(true);
  }
 });

 it("sid-only 4-arg / 1-arg tip overloads are deny-closed (no EXECUTE grant bypass)",async()=>{
  const open4=await rpc(clientA2,"master_open_identity_recovery_review",{
   p_expected_user_id:userA.id,
   p_reason:"lost_phone",
   p_request_key:randomUUID(),
   p_expected_native_session_id:sessionA2,
  });
  expect((open4.data as {ok?:boolean}|null)?.ok===true).toBe(false);

  const read1=await rpc(clientA2,"master_read_identity_recovery_reviews",{
   p_expected_native_session_id:sessionA2,
  });
  expect((read1.data as {ok?:boolean}|null)?.ok===true).toBe(false);
 });
});
