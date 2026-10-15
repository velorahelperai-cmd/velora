import { beforeAll, afterAll, beforeEach, expect, it as nativeIt } from "vitest";
// @ts-expect-error Guarded disposable local PostgreSQL only.
import { bootstrap, cleanup, file, sql, lit } from "../../../scripts/instagram-connection/postgres.mjs";
const it = (name: string, fn: () => Promise<void>) => nativeIt(name, fn, 15000);
const id = (n: number) => `e1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = `set role authenticated;set request.jwt.claims=${lit(JSON.stringify({ sub: id(1), session_id: id(101), role: "authenticated" }))};`;
const server = "set role service_role;";
const rpc = async (name: string, args = "", service = false) => JSON.parse(await sql((service ? server : actor) + `select to_json(public.${name}(${args}));`));
const payload = { business: { name: "Shop", type: "other", replyLanguage: "both", country: "OM", city: "", hours: "", contactPhone: "", contactEmail: "" }, setupStep: 0 };
beforeAll(async () => {
 await bootstrap("supabase/migrations/20261013225246_vel_setup_drafts.sql");
 await sql(`alter table public.companies add column created_by uuid,add column country text default 'OM';alter table auth.users add column deleted_at timestamptz,add column banned_until timestamptz;
 create function public.is_platform_admin() returns boolean language sql as $$select false$$;
 create function private.user_has_company_capability(uuid,uuid,text) returns boolean language sql as $$select true$$;
 create function public.has_company_capability(uuid,text) returns boolean language sql security definer as $$select true$$;
 create table private.fixture_capability_oids as select 'public.has_company_capability(uuid,text)'::regprocedure::oid public_oid,'private.user_has_company_capability(uuid,uuid,text)'::regprocedure::oid private_oid;
 create table public.fixture_retained_policy(company_id uuid);insert into public.fixture_retained_policy values('${id(201)}');alter table public.fixture_retained_policy enable row level security;grant select on public.fixture_retained_policy to authenticated;create policy fixture_capability_read on public.fixture_retained_policy for select to authenticated using(public.has_company_capability(company_id,'knowledge.write'));
 create table private.billing_proven_entitlement_grants(id uuid primary key,company_id uuid,provider_environment text,applied_paid_through timestamptz,applied_at timestamptz);
 create function private.billing_service_receipt_eligible(uuid) returns boolean language sql as $$select true$$;
 create table public.billing_settlement_outcomes(id uuid primary key,company_id uuid,outcome text,provider_environment text);
 create table public.knowledge_sources(id uuid primary key default gen_random_uuid(),company_id uuid,kind text,title text,content text default '',file_name text,content_type text,byte_size bigint,storage_path text,status text,failure_code text,created_by uuid,created_at timestamptz default clock_timestamp(),updated_at timestamptz default clock_timestamp(),content_version integer default 1,approved_for_answers boolean default false,approved_version integer,approved_at timestamptz,approved_by uuid);
 create schema storage;create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,updated_at timestamptz default clock_timestamp(),unique(bucket_id,name));
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;grant usage on schema storage to authenticated;
 create policy fixture_legacy_objects on storage.objects for all to authenticated using(true) with check(true);
 alter table public.knowledge_sources enable row level security;grant select,insert,update,delete on public.knowledge_sources to authenticated;create policy fixture_legacy_knowledge on public.knowledge_sources for all to authenticated using(true) with check(true);
 insert into auth.users(id,email,email_confirmed_at) values('${id(1)}','owner@test.invalid',clock_timestamp());insert into auth.sessions(id,user_id) values('${id(101)}','${id(1)}');insert into public.companies values('${id(201)}','Shop','setup','${id(1)}','OM');insert into public.company_members(company_id,user_id,role) values('${id(201)}','${id(1)}','owner');`);
 await file("supabase/migrations/20261014015933_master_setup_draft_lifecycle.sql");
 await file("supabase/migrations/20261014033002_master_setup_file_lifecycle.sql");
}, 30000);
afterAll(cleanup);
beforeEach(async () => { await sql(`do $$begin if to_regclass('private.master_setup_file_jobs') is not null then truncate private.master_setup_file_jobs,private.master_setup_file_obligations,private.master_setup_file_intents,private.master_setup_file_policy cascade;end if;end;$$;delete from private.master_setup_draft_confirmations;delete from private.master_setup_draft_outbox;delete from public.company_setup_drafts;truncate public.knowledge_sources,storage.objects,private.billing_proven_entitlement_grants,public.billing_settlement_outcomes;update public.companies set setup_file_destruction_at=null;`); });
const draft = async () => (await rpc("save_company_setup_draft", `'${id(1)}','${id(201)}',0,${lit(JSON.stringify(payload))}::jsonb`)).data;
const reserve = (d: { draft_id: string; generation: number }, attempt = 301) => rpc("master_reserve_setup_file", `'${id(1)}','${id(201)}','${d.draft_id}',${d.generation},'${id(attempt)}','guide.pdf','application/pdf',12`);
async function close(d: { draft_id: string; generation: number; revision: number }) {
 const args = `'${id(1)}','${d.draft_id}',${d.revision},${d.generation}`;
 const preview = await rpc("master_setup_draft_action", `${args},'preview_cancel',null`);
 return { preview, closed: await rpc("master_setup_draft_action", `${args},'confirm_cancel','${preview.data.confirmationToken}'`) };
}
it("reserves immutable draft-owned upload intents and returns the same retry receipt", async () => {
 const d = await draft();const first = await reserve(d);expect(first.ok).toBe(true);expect(first.data.path).toContain(`/setup/${id(301)}/`);
 expect(await reserve(d)).toEqual(first);
});
it("scoped Storage objects cannot be read, overwritten or signed through authenticated access", async () => {
 const r = (await reserve(await draft())).data;
 await sql(actor + `insert into storage.objects(bucket_id,name) values('company-knowledge',${lit(r.path)});`);
 expect(await sql(actor + `select count(*) from storage.objects where name=${lit(r.path)}`)).toBe("0");
 expect(await sql(actor + `with changes as (update storage.objects set updated_at=clock_timestamp() where name=${lit(r.path)} returning id) select count(*) from changes`)).toBe("0");
 await sql(`insert into storage.objects(bucket_id,name) values('company-knowledge','legacy/file.pdf');`);
 expect(await sql(actor + "select count(*) from storage.objects where name='legacy/file.pdf'" )).toBe("1");
});
it("owners cannot detach scoped metadata or bypass intents with a new unscoped setup source", async () => {
 const r = (await reserve(await draft())).data;
 await expect(sql(actor + `update public.knowledge_sources set storage_path='legacy/unscoped.pdf' where id='${r.sourceId}'`)).rejects.toThrow(/IMMUTABLE_SETUP_FILE_SCOPE/);
 await expect(sql(actor + `insert into public.knowledge_sources(company_id,kind,storage_path) values('${id(201)}','file','legacy/unscoped.pdf')`)).rejects.toThrow(/SETUP_UPLOAD_INTENT_REQUIRED/);
 await expect(sql(actor + `delete from public.knowledge_sources where id='${r.sourceId}'`)).rejects.toThrow(/DURABLE_DELETION/);
});
it("original capability OIDs and preexisting RLS policies observe the destruction fence", async () => {
 expect(await sql("select (public_oid='public.has_company_capability(uuid,text)'::regprocedure::oid and private_oid='private.user_has_company_capability(uuid,uuid,text)'::regprocedure::oid)::text from private.fixture_capability_oids")).toBe("true");
 expect(await sql(actor + "select count(*) from public.fixture_retained_policy")).toBe("1");
 await sql(`update public.companies set setup_file_destruction_at=clock_timestamp() where id='${id(201)}'`);
 expect(await sql(actor + "select count(*) from public.fixture_retained_policy")).toBe("0");
});
it("adopted legacy files and new paths in a destroyed company cannot be read or changed", async () => {
 const d = await draft();const source=id(601);const path=`${id(201)}/${source}/legacy.pdf`;
 await sql(`insert into private.master_setup_file_intents(id,draft_id,company_id,user_id,draft_generation,source_id,path,file_name,content_type,byte_size,state) values('${id(602)}','${d.draft_id}','${id(201)}','${id(1)}',1,'${source}',${lit(path)},'legacy.pdf','application/pdf',12,'deletion_pending');insert into storage.objects(bucket_id,name) values('company-knowledge',${lit(path)});update public.companies set setup_file_destruction_at=clock_timestamp() where id='${id(201)}';`);
 expect(await sql(actor + `select count(*) from storage.objects where name=${lit(path)}`)).toBe("0");
 expect(await sql(actor + `with x as(update storage.objects set updated_at=clock_timestamp() where name=${lit(path)} returning id) select count(*) from x`)).toBe("0");
 await expect(sql(actor + `insert into storage.objects(bucket_id,name) values('company-knowledge','${id(201)}/${id(603)}/other.pdf')`)).rejects.toThrow(/row-level security/);
});
it("preview counts reserved uploads and excludes legacy files; closure prevents finalize and proxy access", async () => {
 const r = (await reserve(await draft())).data;
 const d = (await rpc("read_active_company_setup_draft", `'${id(1)}'`)).data;
 const closed = await close(d);expect(closed.preview.data.scopedFileCount).toBe(1);expect(closed.preview.data.unscopedFilesIncluded).toBe(false);
 expect((await rpc("master_finalize_setup_file", `'${id(1)}','${id(301)}'`)).code).toBe("DRAFT_CLOSED");
 expect((await rpc("master_authorize_setup_file", `'${id(1)}','${id(201)}','${r.sourceId}'`)).code).toBe("FORBIDDEN");
 expect(await sql("select count(*) from private.master_setup_file_jobs where state='blocked'" )).toBe("1");
 expect((await rpc("master_claim_setup_file_deletion", "", true)).code).toBe("LEGAL_POLICY_UNCONFIGURED");
});
it("an object arriving after closure is swept and cannot regain authenticated access", async () => {
 const r = (await reserve(await draft())).data;const d = (await rpc("read_active_company_setup_draft", `'${id(1)}'`)).data;await close(d);
 await expect(sql(actor + `insert into storage.objects(bucket_id,name) values('company-knowledge',${lit(r.path)})`)).rejects.toThrow(/row-level security/);
 // Labelled Storage completion port: metadata arriving from an already accepted upload.
 await sql(`insert into storage.objects(bucket_id,name) values('company-knowledge',${lit(r.path)})`);
 expect(await sql("select (object_id is not null)::text||':'||state from private.master_setup_file_intents")).toBe("true:deletion_pending");
 expect(await sql("select count(*) from private.master_setup_file_jobs where state='blocked'")).toBe("1");
 expect(await sql(actor + `select count(*) from storage.objects where name=${lit(r.path)}`)).toBe("0");
 expect((await rpc("master_authorize_setup_file", `'${id(1)}','${id(201)}','${r.sourceId}'`)).code).toBe("FORBIDDEN");
});
it("actual upload completion captures object generation while completed setup files remain usable", async () => {
 const r = (await reserve(await draft())).data;
 await sql(actor + `insert into storage.objects(bucket_id,name) values('company-knowledge',${lit(r.path)});`);
 expect((await rpc("master_finalize_setup_file", `'${id(1)}','${id(301)}'`)).ok).toBe(true);
 const d = (await rpc("read_active_company_setup_draft", `'${id(1)}'`)).data;
 await rpc("master_setup_draft_action", `'${id(1)}','${d.draft_id}',${d.revision},${d.generation},'complete',null`);
 expect((await rpc("master_authorize_setup_file", `'${id(1)}','${id(201)}','${r.sourceId}'`)).ok).toBe(true);
});
it("trusted payment before destructive claim cancels stale cleanup", async () => {
 const r = (await reserve(await draft())).data;const d = (await rpc("read_active_company_setup_draft", `'${id(1)}'`)).data;await close(d);
 await sql(`insert into private.master_setup_file_policy values('OM','APPROVED','synthetic-fixture-only');insert into private.billing_proven_entitlement_grants values('${id(501)}','${id(201)}','live',clock_timestamp()+interval '720 hours',clock_timestamp());insert into public.billing_settlement_outcomes values('${id(502)}','${id(201)}','granted','live');`);
 expect((await rpc("master_claim_setup_file_deletion", "", true)).claim).toBeNull();expect(await sql(`select state from private.master_setup_file_jobs where intent_id='${id(301)}'`)).toBe("cancelled");expect(r.sourceId).toBeTruthy();
});
it("paid retention safely requeues payment-cancelled unstarted jobs with the current receipt", async () => {
 await reserve(await draft());const d=(await rpc("read_active_company_setup_draft",`'${id(1)}'`)).data;await close(d);
 await sql(`insert into private.master_setup_file_policy values('OM','APPROVED','synthetic-fixture-only');insert into private.billing_proven_entitlement_grants values('${id(501)}','${id(201)}','live',clock_timestamp()+interval '720 hours',clock_timestamp());`);
 await rpc("master_claim_setup_file_deletion","",true);expect(await sql("select state from private.master_setup_file_jobs")).toBe("cancelled");
 await sql(`select private.master_setup_enqueue_file('${id(301)}','paid_retention')`);
 expect(await sql("select state||':'||reason||':'||(claim_token is null)::text||':'||(lease_until is null)::text from private.master_setup_file_jobs")).toBe("queued:paid_retention:true:true");expect(await sql("select payment_receipt_id::text from private.master_setup_file_jobs")).toBe(id(501));
});
it("destruction commits before dispatch, retries have backoff, and late payment records an obligation", async () => {
 await sql(`insert into storage.objects(bucket_id,name) values('company-knowledge','${id(201)}/${id(701)}/prior.pdf');`);
 await reserve(await draft());const d = (await rpc("read_active_company_setup_draft", `'${id(1)}'`)).data;await close(d);
 await sql("insert into private.master_setup_file_policy values('OM','APPROVED','synthetic-fixture-only');update private.master_setup_file_intents set upload_until=clock_timestamp()");
 const c = (await rpc("master_claim_setup_file_deletion", "", true)).claim;
 expect(c).toBeTruthy();expect(await sql(`select (file_deletion_started_at is not null)::text from public.company_setup_drafts where draft_id='${d.draft_id}'`)).toBe("true");
 expect(await sql(actor + `select public.has_company_capability('${id(201)}','wa.conversations.reply')`)).toBe("t");
 expect(await sql(actor + `select count(*) from storage.objects where name='${id(201)}/${id(701)}/prior.pdf'`)).toBe("1");
 expect(await sql(`select (setup_file_destruction_at is null)::text from public.companies where id='${id(201)}'`)).toBe("true");
 await rpc("master_finish_setup_file_deletion", `'${c.jobId}','${c.claimToken}','retry'`, true);
 expect((await rpc("master_claim_setup_file_deletion", "", true)).claim).toBeNull();
 await sql(`insert into private.billing_proven_entitlement_grants values('${id(501)}','${id(201)}','live',clock_timestamp()+interval '720 hours',clock_timestamp());insert into public.billing_settlement_outcomes values('${id(502)}','${id(201)}','granted','live');`);
 expect(await sql("select count(*) from private.master_setup_file_obligations")).toBe("1");expect(await sql(`select state from public.company_setup_drafts where draft_id='${d.draft_id}'`)).toBe("cancelled");
});
it("expired claims are recovered while stale receipts cannot report deletion complete", async () => {
 const r = (await reserve(await draft())).data;const d = (await rpc("read_active_company_setup_draft", `'${id(1)}'`)).data;await close(d);
 await sql("insert into private.master_setup_file_policy values('OM','APPROVED','synthetic-fixture-only');update private.master_setup_file_intents set upload_until=clock_timestamp()");
 const first = (await rpc("master_claim_setup_file_deletion", "", true)).claim;
 await sql("update private.master_setup_file_jobs set lease_until=clock_timestamp()-interval '1 second'");
 const second = (await rpc("master_claim_setup_file_deletion", "", true)).claim;
 expect(second.claimToken).not.toBe(first.claimToken);
 expect(await rpc("master_finish_setup_file_deletion", `'${first.jobId}','${first.claimToken}','absent'`, true)).toBe(false);
 expect(await rpc("master_finish_setup_file_deletion", `'${second.jobId}','${second.claimToken}','absent'`, true)).toBe(true);
 expect(await sql(`select count(*) from public.knowledge_sources where id='${r.sourceId}'`)).toBe("0");
 expect(await sql(`select count(*) from public.companies where id='${id(201)}'`)).toBe("1");
});
