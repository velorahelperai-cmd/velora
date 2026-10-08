// Offline, isolated PostgreSQL fixture. No environment secrets, cloud access, or providers.
// Install @electric-sql/pglite outside the repo and pass its absolute entry path as argv[2].
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

if (!process.argv[2]) throw Error("Pass the absolute path to a local @electric-sql/pglite module.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const owner = "f1000000-0000-4000-8000-000000000001";
const member = "f1000000-0000-4000-8000-000000000002";
const wrong = "f1000000-0000-4000-8000-000000000003";
const unverified = "f1000000-0000-4000-8000-000000000004";
const otherOwner = "f1000000-0000-4000-8000-000000000005";
const company = "f2000000-0000-4000-8000-000000000001";
const otherCompany = "f2000000-0000-4000-8000-000000000002";
let assertions = 0;
const eq = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
const sessionFor = (actor) => actor.replace("f1", "f3");
const claims = (actor, session = sessionFor(actor)) => JSON.stringify({ sub: actor, session_id: session, role: "authenticated" });
async function call(actor, statement, session) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims(actor, session)]);
  await db.exec("set role authenticated");
  try { return (await db.query(statement)).rows[0].result; } finally { await db.exec("reset role"); }
}
async function make(hash, email = "member@fixture.invalid", actor = owner, business = company) {
  return call(actor, `select public.create_staff_invitation('${business}', '${email}', 'Staff fixture', '${hash}') result`);
}
async function accept(hash, actor = member, session) {
  return call(actor, `select public.accept_staff_invitation('${hash}') result`, session);
}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.jwt(), auth.uid() to anon, authenticated;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create table auth.sessions(id uuid primary key, user_id uuid references auth.users, created_at timestamptz default clock_timestamp());
    create table public.companies(id uuid primary key, display_name text, status text);
    create table public.company_members(company_id uuid references public.companies, user_id uuid references auth.users,
      role text, status text, member_name text default '', created_at timestamptz default clock_timestamp(), primary key(company_id,user_id));
    insert into auth.users values
      ('${owner}','owner@fixture.invalid',clock_timestamp()), ('${member}','member@fixture.invalid',clock_timestamp()),
      ('${wrong}','wrong@fixture.invalid',clock_timestamp()), ('${unverified}','unverified@fixture.invalid',null),
      ('${otherOwner}','other-owner@fixture.invalid',clock_timestamp());
    insert into auth.sessions(id,user_id) select replace(id::text,'f1','f3')::uuid,id from auth.users;
    insert into public.companies values ('${company}','First fixture business','active'), ('${otherCompany}','Other business','active');
    insert into public.company_members(company_id,user_id,role,status,member_name) values
      ('${company}','${owner}','owner','active','Owner'), ('${otherCompany}','${otherOwner}','owner','active','Other owner');
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/20261008010000_vel_session_idle_policy.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/20261008070000_vel_staff_invitations.sql", import.meta.url), "utf8"));
  await db.exec("update private.app_session_settings set enabled=true");

  eq((await make("a".repeat(64))).ok, true);
  eq((await make("b".repeat(64), "unrelated@fixture.invalid", owner, otherCompany)).code, "FORBIDDEN");
  eq((await make("b".repeat(64), "unrelated@fixture.invalid", wrong)).code, "FORBIDDEN");
  const persisted = (await db.query("select token_hash, expires_at-created_at duration from private.staff_invitations")).rows;
  eq(persisted.length, 1); eq(persisted[0].token_hash, "a".repeat(64));
  eq((await db.query("select expires_at > created_at + interval '6 days' and expires_at <= created_at + interval '7 days 1 second' valid from private.staff_invitations")).rows[0].valid, true);
  await db.exec("set role anon");
  const preview = (await db.query(`select public.read_staff_invitation('${"a".repeat(64)}') result`)).rows[0].result;
  await db.exec("reset role");
  eq(preview.maskedEmail, "m***@fixture.invalid"); eq(preview.business, "First fixture business"); eq("email" in preview, false); eq("token_hash" in preview, false);
  eq((await accept("a".repeat(64), wrong)).code, "EMAIL_MISMATCH");
  eq((await accept("a".repeat(64), member, "f3000000-0000-4000-8000-000000000099")).code, "UNAUTHENTICATED");
  await db.exec(`update private.app_session_activity set last_activity_at=clock_timestamp()-interval '2 hours' where user_id='${member}'`);
  eq((await accept("a".repeat(64))).code, "UNAUTHENTICATED");
  await db.exec(`update private.app_session_activity set last_activity_at=clock_timestamp(),expired_at=null where user_id='${member}'`);
  await db.exec(`update public.companies set status='suspended' where id='${company}'`);
  eq((await accept("a".repeat(64))).code, "INVITE_INVALID");
  await db.exec(`update public.companies set status='active' where id='${company}'; update public.company_members set status='disabled' where user_id='${owner}'`);
  eq((await accept("a".repeat(64))).code, "INVITE_INVALID");
  await db.exec(`update public.company_members set status='active' where user_id='${owner}'`);
  eq((await accept("a".repeat(64))).ok, true); eq((await accept("a".repeat(64))).ok, true);
  eq((await db.query(`select count(*)::int n from public.company_members where user_id='${member}'`)).rows[0].n, 1);
  eq((await db.query(`select role from public.company_members where user_id='${member}'`)).rows[0].role, "staff");
  eq((await make("b".repeat(64))).code, "MEMBER_EXISTS");
  const activityBefore = (await db.query(`select last_activity_at from private.app_session_activity where user_id='${owner}'`)).rows[0].last_activity_at;
  const list = await call(owner, `select public.list_company_team('${company}') result`);
  eq((await db.query(`select last_activity_at from private.app_session_activity where user_id='${owner}'`)).rows[0].last_activity_at, activityBefore);
  eq(list.members.length, 2); eq(list.invitations.length, 0); eq(JSON.stringify(list).includes("token_hash"), false);
  eq((await call(member, `select public.list_company_team('${company}') result`)).code, "FORBIDDEN");
  eq((await make("c".repeat(64), "unverified@fixture.invalid")).ok, true);
  eq((await accept("c".repeat(64), unverified)).code, "UNVERIFIED");
  eq((await make("d".repeat(64), "wrong@fixture.invalid")).ok, true);
  await db.exec(`update private.staff_invitations set expires_at=clock_timestamp()-interval '1 second' where token_hash='${"d".repeat(64)}'`);
  eq((await accept("d".repeat(64), wrong)).code, "INVITE_INVALID");
  eq((await db.query("select has_table_privilege('authenticated','private.staff_invitations','SELECT') allowed")).rows[0].allowed, false);
  eq((await db.query("select relrowsecurity from pg_class where oid='private.staff_invitations'::regclass")).rows[0].relrowsecurity, true);
  eq((await db.query("select count(*)::int n from pg_policies where schemaname='private' and tablename='staff_invitations' and policyname='velora_active_session'")).rows[0].n, 1);
  eq((await db.query("select has_function_privilege('anon','public.accept_staff_invitation(text)','EXECUTE') allowed")).rows[0].allowed, false);
  eq((await db.query("select has_function_privilege('anon','public.create_staff_invitation(uuid,text,text,text)','EXECUTE') allowed")).rows[0].allowed, false);
  console.log(`Staff invitation PostgreSQL fixture passed: ${assertions} assertions.`);
} finally { await db.close(); }
