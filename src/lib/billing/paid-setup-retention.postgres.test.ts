import { beforeAll, afterAll, beforeEach, afterEach, expect, it as nativeIt } from "vitest";
import { readFileSync } from "node:fs";
import { runSetupFileDeletion, type SetupFileDeletionClaim } from "@/lib/tenancy/setup-file-worker";
// @ts-expect-error Guarded disposable native PostgreSQL fixture, no cloud/provider client.
import { bootstrap, cleanup, file, sql, lit, session } from "../../../scripts/instagram-connection/postgres.mjs";
const it = (name: string, fn: () => Promise<void>) => nativeIt(name, fn, 20000);
const id = (n: number) => `d1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = `set role authenticated;set request.jwt.claims=${lit(JSON.stringify({ sub: id(1), session_id: id(101), role: "authenticated" }))};`;
const rpc = async (name: string, args = "") => JSON.parse(await sql(`set role service_role;select coalesce(to_json(public.${name}(${args})),'null'::json);`));
const nativeSource = readFileSync("supabase/migrations/20261013200416_subscription_lifecycle_v2.sql", "utf8");
async function nativeFunction(name: string) { const start = nativeSource.indexOf(`create function ${name}(`); if (start < 0) throw Error(`NATIVE_KERNEL_MISSING:${name}`); await sql(nativeSource.slice(start, nativeSource.indexOf("$$;", start) + 3)); }
type Held = { child: { stdin: { end: (input: string) => void } }; done: Promise<unknown>; output: () => string };
const held = new Set<Held>();
const hold = (query: string) => { const h = session(query, { keepOpen: true }) as Held; held.add(h); void h.done.then(() => held.delete(h), () => held.delete(h)); return h; };
afterEach(async () => { for (const h of held) { h.child.stdin.end("rollback;\n"); await h.done.catch(() => {}); } held.clear(); });
beforeAll(async () => {
 await bootstrap("supabase/migrations/20261013225246_vel_setup_drafts.sql");
 await sql(`alter table auth.users add column deleted_at timestamptz,add column banned_until timestamptz;
 alter table public.companies add column created_by uuid,add column country text default 'OM',add column business_type text default 'other',add column reply_language text default 'both',add column city text default '',add column hours text default '',add column contact_phone text default '',add column contact_email text default '';
 create function public.is_platform_admin() returns boolean language sql as $$select false$$;
 create function private.user_has_company_capability(uuid,uuid,text) returns boolean language sql as $$select true$$;
 create function public.has_company_capability(uuid,text) returns boolean language sql security definer as $$select true$$;
 -- Synthetic financial proof projection; native receipt/expiry kernels below are genuine source bodies.
 create table public.billing_subscriptions(id uuid primary key,company_id uuid references public.companies,status text default 'active',environment text,paid_through timestamptz,plan_version_id uuid);
 create table private.billing_proven_entitlement_grants(id uuid primary key,company_id uuid,subscription_id uuid,provider_environment text,applied_paid_through timestamptz,applied_at timestamptz,plan_version_id uuid);
 create function private.billing_service_receipt_eligible(uuid) returns boolean language sql as $$select true$$;
 create table public.billing_settlement_outcomes(id uuid primary key,company_id uuid,outcome text,provider_environment text);
 create table public.fixture_invoices(id uuid primary key,company_id uuid references public.companies on delete restrict,total integer);
 create table public.knowledge_sources(id uuid primary key default gen_random_uuid(),company_id uuid,kind text,title text,content text default '',file_name text,content_type text,byte_size bigint,storage_path text,status text,failure_code text,created_by uuid,created_at timestamptz default clock_timestamp(),updated_at timestamptz default clock_timestamp(),content_version integer default 1,approved_for_answers boolean default false,approved_version integer,approved_at timestamptz,approved_by uuid);
 create schema storage;create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,updated_at timestamptz default clock_timestamp(),unique(bucket_id,name));
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;grant usage on schema storage to authenticated;create policy fixture_legacy_storage on storage.objects for all to authenticated using(true) with check(true);
 alter table public.knowledge_sources enable row level security;grant select,insert,update,delete on public.knowledge_sources to authenticated;create policy fixture_legacy_knowledge on public.knowledge_sources for all to authenticated using(true) with check(true);
 create table private.instagram_company_links(company_id uuid,status text);create table private.instagram_company_generations(company_id uuid,generation bigint,attempt_generation bigint);create table private.instagram_oauth_attempts(company_id uuid,status text);
 create table public.whatsapp_company_links(company_id uuid,status text,updated_at timestamptz);
 create table public.whatsapp_conversations(id uuid primary key,company_id uuid);create table public.whatsapp_messages(id uuid primary key,company_id uuid,conversation_id uuid,body text);create table public.whatsapp_inbound_jobs(id uuid,company_id uuid);create table public.whatsapp_send_intents(id uuid,company_id uuid);
 create table private.instagram_conversations(id uuid primary key,company_id uuid);create table private.instagram_messages(id uuid primary key,company_id uuid);create table public.ai_usage_ledger(id uuid primary key,company_id uuid,worker_job_id uuid,cost_baisa integer,response_text text,response_redacted_at timestamptz);
 insert into auth.users(id,email,email_confirmed_at) values('${id(1)}','owner@test.invalid',clock_timestamp());insert into auth.sessions(id,user_id) values('${id(101)}','${id(1)}');`);
 await nativeFunction("private.billing_lifecycle_deadline");
 const tableStart=nativeSource.indexOf("create table private.billing_expiry_episodes(");await sql(nativeSource.slice(tableStart,nativeSource.indexOf("alter table private.billing_expiry_episodes",tableStart)));
 for (const name of ["private.billing_lifecycle_receipt","private.billing_cancel_old_expiry","private.billing_purge_chat","public.billing_run_expiry_company","public.billing_expiry_candidates"]) await nativeFunction(name);
 await file("supabase/migrations/20261014015933_master_setup_draft_lifecycle.sql");
 await file("supabase/migrations/20261014033002_master_setup_file_lifecycle.sql");
 await file("supabase/migrations/20261014033005_master_paid_setup_retention.sql");
}, 30000);
afterAll(cleanup);
beforeEach(async () => { await sql(`truncate private.master_paid_retention_notifications,private.master_paid_setup_retention,private.master_paid_retention_checks,private.master_paid_retention_policy,private.master_setup_file_jobs,private.master_setup_file_obligations,private.master_setup_file_intents,private.master_setup_file_policy,private.master_setup_draft_confirmations,private.master_setup_draft_outbox,public.company_setup_drafts,private.billing_expiry_email_outbox,private.billing_expiry_episodes,public.billing_settlement_outcomes,private.billing_proven_entitlement_grants,public.billing_subscriptions,public.fixture_invoices,public.knowledge_sources,storage.objects,public.ai_usage_ledger,public.whatsapp_messages,public.whatsapp_conversations,private.instagram_messages,private.instagram_conversations,private.instagram_company_links,private.instagram_company_generations,private.instagram_oauth_attempts,public.whatsapp_company_links,public.company_members,public.companies cascade;`); });
async function expired(days = 90, company = 201, receipt = 501, country = "OM") {
 await sql(`insert into public.companies(id,display_name,status,created_by,country,city,contact_email) values('${id(company)}','Paid shop','active','${id(1)}',${lit(country)},'Muscat','business@test.invalid');insert into public.billing_subscriptions(id,company_id,environment,paid_through,plan_version_id) values('${id(company+1000)}','${id(company)}','live',clock_timestamp()-interval '${days} days','${id(901)}');insert into private.billing_proven_entitlement_grants select '${id(receipt)}',company_id,id,'live',paid_through,clock_timestamp(),'${id(901)}' from public.billing_subscriptions where company_id='${id(company)}';insert into public.fixture_invoices values('${id(company+2000)}','${id(company)}',45000);`);
}
async function approved(country = "OM", chat = true) { await sql(`insert into private.master_paid_retention_policy values(${lit(country)},${chat ? "'synthetic-chat'" : "null"},'synthetic-setup');insert into private.master_setup_file_policy values(${lit(country)},'APPROVED','synthetic-fixture-only');`); }
const run = (company = 201) => rpc("billing_run_expiry_company", `'${id(company)}'`);
it("unconfigured legal policies block day60 chat and day90 setup destruction", async () => {
 await expired();await sql(`insert into public.whatsapp_conversations values('${id(701)}','${id(201)}');insert into public.whatsapp_messages values('${id(702)}','${id(201)}','${id(701)}','Customer transcript');insert into public.knowledge_sources(id,company_id,kind,title,content,created_by) values('${id(601)}','${id(201)}','text','Facts','Keep these facts','${id(1)}');`);
 expect((await run()).setupRetention).toBe("LEGAL_POLICY_UNCONFIGURED");expect(await sql("select body from public.whatsapp_messages")).toBe("Customer transcript");expect(await sql("select content from public.knowledge_sources")).toBe("Keep these facts");expect(await sql("select (setup_file_destruction_at is null)::text from public.companies")).toBe("true");
});
it("native day60 chat purge requires its own policy and preserves financial usage", async () => {
 await expired(60);await approved();await sql(`insert into public.whatsapp_conversations values('${id(701)}','${id(201)}');insert into public.whatsapp_messages values('${id(702)}','${id(201)}','${id(701)}','Customer transcript');insert into public.ai_usage_ledger values('${id(703)}','${id(201)}','${id(704)}',7,'AI content',null);`);
 expect((await run()).setupRetention).toBe("RETAINED");expect(await sql("select count(*) from public.whatsapp_messages")).toBe("0");expect(await sql("select cost_baisa from public.ai_usage_ledger")).toBe("7");expect(await sql("select total from public.fixture_invoices")).toBe("45000");
});
it("day90 prepares text and proven legacy/orphan files while retaining financial identity", async () => {
 await expired();await expired(1,202,502,"AE");await approved();await sql(`insert into public.knowledge_sources(id,company_id,kind,title,content,created_by) values('${id(601)}','${id(201)}','text','Facts','Private setup text','${id(1)}');insert into public.knowledge_sources(id,company_id,kind,title,file_name,content_type,byte_size,storage_path,created_by) values('${id(602)}','${id(201)}','file','Legacy','guide.pdf','application/pdf',12,'${id(201)}/${id(602)}/guide.pdf','${id(1)}');insert into storage.objects(bucket_id,name) values('company-knowledge','${id(201)}/${id(602)}/guide.pdf'),('company-knowledge','${id(201)}/${id(603)}/orphan.pdf'),('company-knowledge','${id(202)}/${id(604)}/untouched.pdf');`);
 expect((await run()).setupRetention).toBe("DELETION_PENDING");expect(await sql("select count(*) from private.master_setup_file_jobs where reason='paid_retention'")).toBe("2");expect(await sql("select count(*) from public.knowledge_sources where kind='text'")).toBe("0");expect(await sql(actor + "select count(*) from storage.objects")).toBe("1");expect(await sql("select count(*) from auth.users")).toBe("1");expect(await sql("select count(*) from public.fixture_invoices where total=45000")).toBe("2");expect(await sql(`select count(*) from private.master_setup_file_intents where company_id='${id(202)}'`)).toBe("0");
});
it("attested legacy jobs reach durable absence through an offline Storage port", async () => {
 await expired();await approved();await sql(`insert into storage.objects(bucket_id,name) values('company-knowledge','${id(201)}/${id(603)}/orphan.pdf');`);await run();
 const ports = { inspect: async (path: string) => { const value=await rpc("master_inspect_setup_file_object",lit(path));return value as {id:string;updatedAt:string}|null; },remove:async(path:string)=>{await sql(`delete from storage.objects where name=${lit(path)} and bucket_id='company-knowledge'`);} };
 const result=await runSetupFileDeletion({claim:async()=>await rpc("master_claim_setup_file_deletion") as {ok:true;claim:SetupFileDeletionClaim|null},finish:async(job,token,outcome)=>await rpc("master_finish_setup_file_deletion",`'${job}','${token}',${lit(outcome)}`)},ports);
 expect(result).toMatchObject({ok:true,deleted:true});expect((await run()).setupRetention).toBe("DELETED");expect(await sql("select count(*) from public.billing_subscriptions")).toBe("1");expect(await sql("select count(*) from public.companies")).toBe("1");
});
it("payment holding the canonical company lock wins before day90 destruction", async () => {
 await expired();await approved();const h=hold(`begin;select id from public.companies where id='${id(201)}' for update;update public.billing_subscriptions set paid_through=clock_timestamp()+interval '30 days' where company_id='${id(201)}';insert into private.billing_proven_entitlement_grants select '${id(502)}',company_id,id,'live',paid_through,clock_timestamp(),plan_version_id from public.billing_subscriptions where company_id='${id(201)}';select 'READY';`);
 const deadline=Date.now()+6000;while(!h.output().includes('READY')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));expect(h.output()).toContain('READY');const pending=run();h.child.stdin.end('commit;\n');await h.done;expect((await pending).setupRetention).toBe("ACTIVE_OR_AWAITING_ACTIVATION");expect(await sql("select (setup_file_destruction_at is null)::text from public.companies")).toBe("true");
});
it("delete-first late payment preserves the obligation and does not cancel committed file cleanup", async () => {
 await expired();await approved();await sql(`insert into storage.objects(bucket_id,name) values('company-knowledge','${id(201)}/${id(603)}/orphan.pdf');`);await run();
 await sql(`update public.billing_subscriptions set paid_through=clock_timestamp()+interval '30 days';insert into private.billing_proven_entitlement_grants select '${id(502)}',company_id,id,'live',paid_through,clock_timestamp(),plan_version_id from public.billing_subscriptions;insert into public.billing_settlement_outcomes values('${id(801)}','${id(201)}','granted','live');`);
 expect(await sql("select count(*) from private.master_setup_file_obligations")).toBe("1");expect((await rpc("master_claim_setup_file_deletion")).claim).toBeTruthy();expect(await sql("select count(*) from private.master_setup_file_jobs where state='cancelled'")).toBe("0");expect(await sql(actor+`select public.has_company_capability('${id(201)}','wa.conversations.reply')`)).toBe("f");expect(await sql(actor+`select public.has_company_capability('${id(201)}','company.profile.read')`)).toBe("t");
});
it("approved cleanup is not starved by an earlier unconfigured country", async () => {
 await expired(90,201,501,"OM");await expired(90,202,502,"AE");await approved("AE");
 // Existing blocked cleanup from an earlier draft must not monopolize the worker.
 await sql(`insert into public.company_setup_drafts(draft_id,user_id,company_id,state,payload,last_meaningful_activity_at,expires_at,paid_protected_at) values('${id(401)}','${id(1)}','${id(201)}','completed',jsonb_build_object('business',jsonb_build_object('name','Legacy','type','other','replyLanguage','both','country','OM','city','','hours','','contactPhone','','contactEmail',''),'setupStep',0),clock_timestamp(),null,clock_timestamp());insert into private.master_setup_file_intents(id,draft_id,company_id,user_id,draft_generation,source_id,path,file_name,content_type,byte_size,state,upload_until) values('${id(402)}','${id(401)}','${id(201)}','${id(1)}',1,'${id(604)}','${id(201)}/${id(604)}/prior.pdf','prior.pdf','application/pdf',0,'deletion_pending',clock_timestamp());select private.master_setup_enqueue_file('${id(402)}','paid_retention');`);
 await sql(`insert into storage.objects(bucket_id,name) values('company-knowledge','${id(202)}/${id(603)}/orphan.pdf');`);await run(201);await run(202);
 expect(await sql("select count(*) from private.master_setup_file_jobs where state='blocked'")).toBe("1");const c=(await rpc("master_claim_setup_file_deletion")).claim;expect(c.companyId).toBe(id(202));
});
it("ambiguous orphan traversal is escalated before setup data or identity is changed", async () => {
 await expired();await approved();await sql(`insert into storage.objects(bucket_id,name) values('company-knowledge','${id(201)}/${id(603)}/../secret');`);
 expect((await run()).setupRetention).toBe("FILE_SCOPE_REVIEW_REQUIRED");expect(await sql("select city from public.companies")).toBe("Muscat");expect(await sql("select (setup_file_destruction_at is null)::text from public.companies")).toBe("true");expect(await sql("select count(*) from private.master_setup_file_jobs")).toBe("0");
});
it("retention candidate fairness continues after native chat purge without deleting financial shells", async () => {
 await expired(70,201,501);await expired(70,202,502);await approved();await run(201);await run(202);
 const first=await rpc("billing_expiry_candidates","1");expect(first).toHaveLength(1);await run(Number(first[0].slice(-3)));const second=await rpc("billing_expiry_candidates","1");expect(second).toHaveLength(1);expect(second[0]).not.toBe(first[0]);expect(await sql("select count(*) from public.fixture_invoices")).toBe("2");
});
