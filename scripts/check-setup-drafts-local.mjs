// Offline PostgreSQL fixture; pass an externally installed PGlite module entry.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
if (!process.argv[2]) throw Error("Pass an absolute local PGlite module path.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const owner = "f1000000-0000-4000-8000-000000000001";
const other = "f1000000-0000-4000-8000-000000000002";
const unverified = "f1000000-0000-4000-8000-000000000003";
const staff = "f1000000-0000-4000-8000-000000000004";
const company = "f2000000-0000-4000-8000-000000000001";
const second = "f2000000-0000-4000-8000-000000000002";
const business = { name: "", type: "other", replyLanguage: "both", country: "OM", city: "Muscat", hours: "", contactPhone: "", contactEmail: "" };
const payload = { business, setupStep: 0 };
let checks = 0;
const eq = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
async function call(actor, sql, args = [], validSession = true) {
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: actor, session_id: validSession ? actor.replace("f1", "f3") : "00000000-0000-0000-0000-000000000000" })]);
  await db.exec("set role authenticated");
  try { return await db.query(sql, args); } finally { await db.exec("reset role"); }
}
async function save(actor, scope, revision, data = payload, expectedActor = actor, validSession = true) {
  return (await call(actor, "select public.save_company_setup_draft($1,$2,$3,$4::jsonb) result", [expectedActor, scope, revision, JSON.stringify(data)], validSession)).rows[0].result;
}
try {
  await db.exec(`
    create role anon; create role authenticated; create schema auth; create schema private;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.jwt(),auth.uid() to authenticated;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz,phone_confirmed_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users);
    create function public.app_session_is_valid() returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=auth.uid()) $$;
    create table public.companies(id uuid primary key,status text,created_by uuid references auth.users);
    create table public.company_members(company_id uuid references public.companies,user_id uuid references auth.users,role text,status text,primary key(company_id,user_id));
    insert into auth.users values('${owner}',clock_timestamp(),null),('${other}',clock_timestamp(),null),('${unverified}',null,null),('${staff}',clock_timestamp(),null);
    insert into auth.sessions select replace(id::text,'f1','f3')::uuid,id from auth.users;
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/20261013225246_vel_setup_drafts.sql", import.meta.url), "utf8"));
  const first = await save(owner, null, 0);
  eq(first.ok, true); eq(first.data.revision, 1); eq(first.data.company_id, null);
  eq((await save(owner, null, 0)).data.revision, 1); // lost-response retry
  eq((await save(owner, null, 0, { ...payload, setupStep: 1 })).code, "CONFLICT");
  eq((await save(other, null, 1, payload, owner)).code, "FORBIDDEN");
  eq((await save(unverified, null, 0)).code, "FORBIDDEN");
  eq((await save(owner, null, 1, payload, owner, false)).code, "UNAUTHENTICATED");
  eq((await call(other, "select * from public.company_setup_drafts")).rows.length, 0);
  eq((await save(other, null, 0, { ...payload, business: { ...business, city: "Salalah" } })).ok, true);
  const ownRows = (await call(other, "select * from public.company_setup_drafts")).rows;
  eq(ownRows.length, 1); eq(ownRows[0].user_id, other);
  eq((await save(owner, null, 1, { ...payload, setupStep: 8 })).code, "INVALID_INPUT");
  eq((await save(owner, null, 1, { ...payload, business: { ...business, contactEmail: "bad" } })).code, "INVALID_INPUT");
  eq((await save(owner, null, 1, { ...payload, setupDone: [true] })).code, "INVALID_INPUT");
  eq((await save(owner, null, 1, { ...payload, business: { ...business, password: "must-not-persist" } })).code, "INVALID_INPUT");
  eq((await save(owner, null, 1, { ...payload, businessBaseline: { ...business, token: "must-not-persist" } })).code, "INVALID_INPUT");
  await assert.rejects(call(owner, "update public.company_setup_drafts set revision=99"), /permission denied/); checks++;
  await assert.rejects(call(owner, "insert into public.company_setup_drafts(user_id,payload) values($1,$2)", [other, payload]), /permission denied/); checks++;
  await assert.rejects(db.query("update public.company_setup_drafts set payload=$1::jsonb", [JSON.stringify({ ...payload, business: { ...business, password: "secret" } })]), /check constraint/); checks++;
  await db.exec(`insert into public.companies values('${company}','setup','${owner}'),('${second}','setup','${other}');
    insert into public.company_members values('${company}','${owner}','owner','active'),('${company}','${staff}','staff','active'),('${second}','${other}','owner','active');`);
  const moved = (await call(owner, "select * from public.company_setup_drafts")).rows[0];
  eq(moved.company_id, company); eq(moved.revision, 2); eq(moved.payload, payload);
  eq((await save(owner, null, 1)).code, "FORBIDDEN"); // old pre-company tab
  eq((await save(owner, second, 0)).code, "FORBIDDEN");
  eq((await save(staff, company, 0)).code, "FORBIDDEN");
  eq((await save(owner, company, 1, { ...payload, setupStep: 4 })).code, "CONFLICT");
  const newer = await save(owner, company, 2, { ...payload, setupStep: 4 });
  eq(newer.ok, true); eq(newer.data.revision, 3);
  eq((await save(owner, company, 2, { ...payload, setupStep: 4 })).data.revision, 3);
  eq((await save(owner, company, 2, payload)).code, "CONFLICT"); // replay cannot reset progress
  await db.exec(`update public.company_members set status='disabled' where user_id='${owner}'`);
  eq((await save(owner, company, 3)).code, "FORBIDDEN");
  await db.exec("create or replace function public.app_session_is_valid() returns boolean language sql stable as $$ select true $$");
  eq((await save(other, second, 2, payload, other, false)).code, "FORBIDDEN");
  await db.exec("set role anon");
  await assert.rejects(db.query("select * from public.company_setup_drafts"), /permission denied/); checks++;
  await assert.rejects(db.query("select public.save_company_setup_draft(null,null,0,'{}')"), /permission denied/); checks++;
  await db.exec("reset role");
  console.log(`Setup draft SQL: ${checks} offline assertions passed.`);
} finally { await db.close(); }
