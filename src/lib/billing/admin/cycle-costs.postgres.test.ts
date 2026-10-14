import {readFileSync} from "node:fs";
import {afterAll,beforeAll,beforeEach,expect,it} from "vitest";
// @ts-expect-error Guarded disposable networkless PostgreSQL, never cloud data.
import {bootstrap,cleanup,file,sql,lit} from "../../../../scripts/instagram-connection/postgres.mjs";
// Ledger/cycle data are labelled foundation ports. Real native session/owner and
// complete original cost-aggregate bodies execute; no model/provider/invoice test.
const id=(n:number)=>`b5000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const actor=(uid=1,sid=101,claims:Record<string,unknown>={})=>`set role authenticated;set request.jwt.claims=${lit(JSON.stringify({sub:id(uid),session_id:id(sid),role:"authenticated",...claims}))};`;
let originalOid:string;
beforeAll(async()=>{
 await bootstrap("supabase/migrations/20261013225246_vel_setup_drafts.sql");
 await sql(`alter table auth.users add column deleted_at timestamptz,add column banned_until timestamptz;
 create table public.platform_admins(user_id uuid primary key references auth.users(id),role text not null,status text not null);
 create table private.master_ai_cycles(id uuid primary key,company_id uuid not null references public.companies(id),starts_at timestamptz not null,expires_at timestamptz not null);
 create table public.ai_usage_ledger(id uuid primary key,company_id uuid not null,model_id text not null,cost_baisa numeric,usage_mode text not null,created_at timestamptz not null);
 create table private.master_ai_attempt_credit_binding(attempt_id uuid primary key,company_id uuid not null,job_id uuid not null,grant_id uuid not null);
 create table private.master_ai_reply_slots(job_id uuid primary key,company_id uuid not null,channel text not null);
 create table private.master_ai_credit_grants(id uuid primary key,kind text not null);
 alter table private.master_ai_cycles enable row level security;alter table public.ai_usage_ledger enable row level security;
 revoke all on private.master_ai_cycles,public.ai_usage_ledger,private.master_ai_attempt_credit_binding,private.master_ai_reply_slots,private.master_ai_credit_grants from public,anon,authenticated,service_role;`);
 await file("supabase/migrations/20261014033007_master_password_session_revocation.sql");
 const owner=readFileSync("supabase/migrations/20261007230212_vel_platform_owner_identity.sql","utf8").match(/create or replace function public\.is_platform_owner\(\)[\s\S]*?\$\$;/)?.[0];
 const aggregate=readFileSync("supabase/migrations/20261014033004_master_cycle_ai_credits.sql","utf8").match(/create function public\.master_ai_cycle_costs\([\s\S]*?\$\$;/)?.[0];
 if(!owner||!aggregate)throw Error("MISSING_NATIVE_ADMIN_COST_BODIES");
 await sql(owner+aggregate+`revoke all on function public.is_platform_owner() from public,anon;grant execute on function public.is_platform_owner() to authenticated;
 revoke all on function public.master_ai_cycle_costs(uuid,uuid) from public,anon,authenticated,service_role;grant execute on function public.master_ai_cycle_costs(uuid,uuid) to service_role;`);
 originalOid=await sql("select 'public.master_ai_cycle_costs(uuid,uuid)'::regprocedure::oid");
 await file("supabase/migrations/20261014033012_master_admin_cycle_costs.sql");
},30000);
afterAll(cleanup);
beforeEach(async()=>{
 await sql(`truncate private.master_account_session_revocations,private.app_session_activity,public.platform_admins,auth.sessions,auth.users,private.master_ai_cycles,public.ai_usage_ledger,private.master_ai_attempt_credit_binding,private.master_ai_reply_slots,private.master_ai_credit_grants,public.companies cascade;
 insert into auth.users(id,email_confirmed_at) values('${id(1)}',clock_timestamp()),('${id(2)}',clock_timestamp()),('${id(3)}',clock_timestamp());
 insert into auth.sessions(id,user_id) values('${id(101)}','${id(1)}'),('${id(102)}','${id(2)}'),('${id(103)}','${id(3)}');
 insert into public.platform_admins values('${id(1)}','owner','active'),('${id(2)}','delegated','active');
 insert into public.companies(id,display_name,status) values('${id(11)}','Business A','draft'),('${id(12)}','Business B','draft');
 insert into private.master_ai_cycles values('${id(21)}','${id(11)}','2026-10-01T00:00:00Z','2026-10-31T00:00:00Z'),('${id(22)}','${id(12)}','2026-10-01T00:00:00Z','2026-10-31T00:00:00Z');
 update private.app_session_settings set enabled=false;`);
});
it("preserves service aggregate OID/ACL and denies anon, private helper and raw ledger",async()=>{
 expect(await sql("select 'public.master_ai_cycle_costs(uuid,uuid)'::regprocedure::oid")).toBe(originalOid);
 expect(await sql(`select has_function_privilege('service_role','public.master_ai_cycle_costs(uuid,uuid)','EXECUTE')`)).toBe("t");
 expect(await sql(`select has_function_privilege('authenticated','public.master_ai_cycle_costs(uuid,uuid)','EXECUTE') or has_function_privilege('anon','public.master_admin_read_ai_cycle_costs(uuid,uuid)','EXECUTE') or has_function_privilege('authenticated','private.master_admin_ai_cycle_cost_aggregate(uuid,uuid)','EXECUTE') or has_table_privilege('authenticated','public.ai_usage_ledger','SELECT')`)).toBe("f");
});
it("native owner reads real cycles; delegated admin, customer and fabricated session are denied",async()=>{
 expect(JSON.parse(await sql(actor()+"select public.master_admin_ai_cost_companies()"))).toMatchObject({ok:true,data:{actorUserId:id(1),companies:[{id:id(11),name:"Business A"},{id:id(12),name:"Business B"}]}});
 for(const [u,s] of [[2,102],[3,103],[1,999]])expect(JSON.parse(await sql(actor(u,s,{user_metadata:{role:"owner"}})+`select public.master_admin_read_ai_cycle_costs('${id(11)}','${id(21)}')`))).toEqual({ok:false,code:"FORBIDDEN"});
 expect(JSON.parse(await sql(actor()+`select public.master_admin_read_ai_cycle_costs('${id(12)}','${id(21)}')`))).toEqual({ok:false,code:"CYCLE_UNAVAILABLE"});
});
it("native disabled owner, idle session, expired Auth session and revoked password epoch deny report",async()=>{
 await sql(`update public.platform_admins set status='disabled' where user_id='${id(1)}'`);
 expect(JSON.parse(await sql(actor()+"select public.master_admin_ai_cost_companies()"))).toEqual({ok:false,code:"FORBIDDEN"});
 await sql(`update public.platform_admins set status='active';update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${id(101)}'`);
 expect(JSON.parse(await sql(actor()+"select public.master_admin_ai_cost_companies()"))).toEqual({ok:false,code:"FORBIDDEN"});
 await sql(`update auth.sessions set not_after=null;update private.app_session_settings set enabled=true;insert into private.app_session_activity(session_id,user_id,last_activity_at) values('${id(101)}','${id(1)}',clock_timestamp()-interval '2 hours');`);
 expect(JSON.parse(await sql(actor()+"select public.master_admin_ai_cost_companies()"))).toEqual({ok:false,code:"FORBIDDEN"});
 await sql(`update private.app_session_settings set enabled=false;delete from private.app_session_activity;`);
 expect(await sql(actor()+`select public.master_revoke_account_sessions('${id(1)}')`)).toBe("t");
 expect(JSON.parse(await sql(actor()+"select public.master_admin_ai_cost_companies()"))).toEqual({ok:false,code:"FORBIDDEN"});
});
it("original native aggregate separates immutable categories/models and excludes other company, period and trial",async()=>{
 await sql(`insert into private.master_ai_credit_grants values('${id(31)}','base'),('${id(32)}','topup'),('${id(33)}','compensation');
 insert into private.master_ai_reply_slots values('${id(41)}','${id(11)}','whatsapp'),('${id(42)}','${id(11)}','whatsapp'),('${id(43)}','${id(11)}','whatsapp');
 insert into public.ai_usage_ledger values('${id(51)}','${id(11)}','gpt-6-luna',0.125,'company_live','2026-10-02T00:00:00Z'),('${id(52)}','${id(11)}','gpt-6-luna',0.25,'company_live','2026-10-03T00:00:00Z'),('${id(53)}','${id(11)}','gpt-6.1-sol',1.75,'company_live','2026-10-04T00:00:00Z'),('${id(54)}','${id(11)}','gpt-6.1-sol',null,'company_live','2026-10-05T00:00:00Z'),('${id(55)}','${id(12)}','gpt-6-luna',99,'company_live','2026-10-02T00:00:00Z'),('${id(56)}','${id(11)}','gpt-6-luna',98,'company_live','2026-10-31T00:00:00Z'),('${id(57)}','${id(11)}','gpt-6-luna',97,'owner_trial','2026-10-02T00:00:00Z');
 insert into private.master_ai_attempt_credit_binding values('${id(51)}','${id(11)}','${id(41)}','${id(31)}'),('${id(52)}','${id(11)}','${id(42)}','${id(32)}'),('${id(53)}','${id(11)}','${id(43)}','${id(33)}');`);
 const result=JSON.parse(await sql(actor()+`select public.master_admin_read_ai_cycle_costs('${id(11)}','${id(21)}')`));
 expect(result).toMatchObject({ok:true,data:{companyId:id(11),cycleId:id(21),basis:"native_usage_tariff_estimate",providerFinalCost:null,unsettledAttempts:1}});
 expect(result.data.groups).toEqual(expect.arrayContaining([{model:"gpt-6-luna",channel:"whatsapp",category:"base",attempts:1,estimated_baisa:0.125},{model:"gpt-6-luna",channel:"whatsapp",category:"topup",attempts:1,estimated_baisa:0.25},{model:"gpt-6.1-sol",channel:"whatsapp",category:"compensation",attempts:1,estimated_baisa:1.75},{model:"gpt-6.1-sol",channel:null,category:null,attempts:1,estimated_baisa:0}]));
 expect(result.data.groups).toHaveLength(4);
});
it("native selector pagination preserves exact company scope and deterministic equal-start cycle cursors",async()=>{
 await sql(`insert into private.master_ai_cycles select ('b5000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(11)}','2026-09-01T00:00:00Z','2026-10-01T00:00:00Z' from generate_series(1000,1050)n;`);
 const first=JSON.parse(await sql(actor()+`select public.master_admin_ai_cost_cycles('${id(11)}')`));expect(first.data.cycles).toHaveLength(50);expect(first.data.next).not.toBeNull();
 const next=first.data.next,second=JSON.parse(await sql(actor()+`select public.master_admin_ai_cost_cycles('${id(11)}',${lit(next.startsAt)},'${next.id}')`));expect(second.data.cycles).toHaveLength(2);expect(second.data.next).toBeNull();
 expect(first.data.cycles.every((c:{id:string})=>!second.data.cycles.some((s:{id:string})=>s.id===c.id))).toBe(true);
 expect(JSON.parse(await sql(actor()+`select public.master_admin_ai_cost_cycles('${id(11)}',null,'${id(21)}')`))).toEqual({ok:false,code:"INVALID_INPUT"});
});
