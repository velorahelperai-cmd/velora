import { beforeAll, afterAll, beforeEach, afterEach, expect, it as nativeIt } from "vitest";
// @ts-expect-error Guarded disposable PostgreSQL fixture; no cloud/provider access.
import { bootstrap, cleanup, file, sql, lit, session } from "../../../scripts/instagram-connection/postgres.mjs";
const it = (name: string, fn: () => Promise<void>, timeout = 15000) => nativeIt(name, fn, timeout);
type HeldSession = { child: { stdin: { end: (input: string) => void } }; done: Promise<unknown>; output: () => string };
const heldSessions = new Set<HeldSession>();
const trackedSession = (query: string) => {
  const held = session(query, { keepOpen: true }) as HeldSession; heldSessions.add(held);
  void held.done.then(() => heldSessions.delete(held), () => heldSessions.delete(held)); return held;
};
async function ready(held: HeldSession) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline && !held.output().includes("READY")) await new Promise(r => setTimeout(r, 25));
  expect(held.output()).toContain("READY");
}
afterEach(async () => { for (const held of heldSessions) { held.child.stdin.end("rollback;\n"); await held.done.catch(() => {}); } heldSessions.clear(); });
const id = (n: number) => `f1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const payload = { business: { name: "Shop", type: "other", replyLanguage: "both", country: "OM", city: "", hours: "", contactPhone: "", contactEmail: "" }, setupStep: 0 };
const actor = (n = 1, sid = n + 100) => `set role authenticated;set request.jwt.claims=${lit(JSON.stringify({ sub: id(n), session_id: id(sid), role: "authenticated" }))};`;
const rpc = async (name: string, args: string, n = 1) => JSON.parse(await sql(actor(n) + `select public.${name}(${args});`));
const save = (company: number | null, revision = 0, data = payload, n = 1) => rpc("save_company_setup_draft", `'${id(n)}',${company ? `'${id(company)}'` : "null"},${revision},${lit(JSON.stringify(data))}::jsonb`, n);
const action = (row: { draft_id: string; revision: number; generation: number }, kind: string, token: string | null = null, n = 1) => rpc("master_setup_draft_action", `'${id(n)}','${row.draft_id}',${row.revision},${row.generation},${lit(kind)},${token ? `'${token}'` : "null"}`, n);
beforeAll(async () => {
  await bootstrap("supabase/migrations/20261013225246_vel_setup_drafts.sql");
  await sql(`alter table public.companies add column created_by uuid;
    alter table auth.users add column deleted_at timestamptz,add column banned_until timestamptz;
    drop index public.company_members_one_active_owner_per_user;
    create function public.is_platform_admin() returns boolean language sql as $$select false$$;
    create table private.billing_proven_entitlement_grants(id uuid primary key,company_id uuid,provider_environment text,applied_paid_through timestamptz,applied_at timestamptz);
    create function private.billing_service_receipt_eligible(uuid) returns boolean language sql as $$select true$$;
    create table public.billing_settlement_outcomes(id uuid primary key,company_id uuid,outcome text,provider_environment text);
    create table public.knowledge_sources(id uuid primary key,company_id uuid,kind text,storage_path text);
    insert into auth.users(id,email,email_confirmed_at) values('${id(1)}','owner@test.invalid',clock_timestamp()),('${id(2)}','staff@test.invalid',clock_timestamp()),('${id(3)}','legacy@test.invalid',clock_timestamp());
    insert into auth.sessions(id,user_id) values('${id(101)}','${id(1)}'),('${id(102)}','${id(2)}'),('${id(103)}','${id(3)}');
    insert into public.companies values('${id(201)}','Existing','active','${id(1)}'),('${id(202)}','Other','active','${id(3)}');
    insert into public.company_members(company_id,user_id,role) values('${id(201)}','${id(1)}','owner'),('${id(201)}','${id(2)}','staff'),('${id(201)}','${id(3)}','owner'),('${id(202)}','${id(3)}','owner');
    insert into public.company_setup_drafts(user_id,company_id,payload) values('${id(3)}','${id(201)}',${lit(JSON.stringify(payload))}::jsonb),('${id(3)}','${id(202)}',${lit(JSON.stringify(payload))}::jsonb);`);
  await file("supabase/migrations/20261014015933_master_setup_draft_lifecycle.sql");
}, 30000);
afterAll(cleanup);
beforeEach(async () => { await sql(`do $$begin if to_regclass('private.master_setup_draft_confirmations') is not null then delete from private.master_setup_draft_confirmations;delete from private.master_setup_draft_outbox;end if;end;$$;delete from public.company_setup_drafts where user_id<>'${id(3)}';truncate private.billing_proven_entitlement_grants,public.billing_settlement_outcomes;update auth.users set deleted_at=null,banned_until=null;update auth.sessions set not_after=null;update private.app_session_settings set enabled=false;delete from private.app_session_activity;`); });
it("preserves every legacy conflict without silently selecting a winner", async () => {
  expect(await sql(`select count(*) from public.company_setup_drafts d where user_id='${id(3)}' and to_jsonb(d)->>'state'='legacy_conflict'`)).toBe("2");
  expect(await rpc("read_active_company_setup_draft", `'${id(3)}'`, 3)).toMatchObject({ ok: false, code: "LEGACY_DRAFT_CONFLICT" });
});
it("permits a new-business null scope for an existing owner but denies staff", async () => {
  expect(await save(null)).toMatchObject({ ok: true, data: { company_id: null, state: "active" } });
  expect(await save(null, 0, payload, 2)).toMatchObject({ ok: false, code: "FORBIDDEN" });
  expect(await save(201)).toMatchObject({ ok: false, code: "ACTIVE_DRAFT_EXISTS" });
});
it("does not extend expiry or duplicate notices for identical save or read", async () => {
  const first = await save(null); const replay = await save(null);
  expect(replay.data.expires_at).toBe(first.data.expires_at);
  expect(replay.data.generation).toBe(first.data.generation);
  await rpc("read_active_company_setup_draft", `'${id(1)}'`);
  expect(await sql(`select count(*) from private.master_setup_draft_outbox where state='queued'`)).toBe("3");
  expect(Number(await sql(`select extract(epoch from (expires_at-last_meaningful_activity_at)) from public.company_setup_drafts where user_id='${id(1)}'`))).toBe(2592000);
});
it("actual save and keep cancel old generations and reset thirty elapsed days", async () => {
  const first = await save(null);
  const changed = await save(null, first.data.revision, { ...payload, setupStep: 1 });
  expect(changed.data.generation).toBe(2);
  const kept = await action(changed.data, "keep");
  expect(kept.data.generation).toBe(3);
  expect(await sql(`select count(*) from private.master_setup_draft_outbox where state='cancelled'`)).toBe("6");
});
it("a bound lost-response retry returns the committed receipt without rewriting expiry", async () => {
  const first = await save(null); const args = `'${id(1)}',null,${first.data.revision},${lit(JSON.stringify({ ...payload, setupStep: 1 }))}::jsonb,'${first.data.draft_id}',${first.data.generation}`;
  const committed = await rpc("master_save_company_setup_draft", args); const retry = await rpc("master_save_company_setup_draft", args);
  expect(retry).toEqual(committed);
});
it("requires a fresh scope-bound preview and preserves company and unscoped files", async () => {
  const first = await save(201);
  const denied = await action(first.data, "confirm_cancel"); expect(denied.code).toBe("CONFIRMATION_REQUIRED");
  const preview = await action(first.data, "preview_cancel"); expect(preview.data.scopedFileCount).toBe(0); expect(preview.data.unscopedFilesIncluded).toBe(false);
  const closed = await action(first.data, "confirm_cancel", preview.data.confirmationToken);
  expect(closed.data.state).toBe("cancelled"); expect(closed.data.cleanup_policy).toBe("UNCONFIGURED");
  expect(await save(201, 0)).toMatchObject({ ok: false, code: "DRAFT_CLOSED" });
  expect(await save(201, first.data.revision, payload)).toMatchObject({ ok: false, code: "DRAFT_CLOSED" });
  expect(await sql(`select count(*) from public.companies where id='${id(201)}'`)).toBe("1");
  expect((await action(closed.data, "keep")).code).toBe("DRAFT_CLOSED");
});
it("bound ID and generation reject stale writes after explicit new draft begins", async () => {
  const old = await save(null); const preview = await action(old.data, "preview_cancel"); await action(old.data, "confirm_cancel", preview.data.confirmationToken);
  const fresh = await rpc("begin_company_setup_draft", `'${id(1)}',null,'${id(401)}',${lit(JSON.stringify(payload))}::jsonb`);
  expect(fresh.data.draft_id).toBe(id(401));
  const late = await rpc("master_save_company_setup_draft", `'${id(1)}',null,${old.data.revision},${lit(JSON.stringify(payload))}::jsonb,'${old.data.draft_id}',${old.data.generation}`);
  expect(late.code).toBe("DRAFT_CLOSED");
  expect((await save(null, fresh.data.revision, payload)).code).toBe("DRAFT_BINDING_REQUIRED");
});
it("paid proof protects waiting or paid-cycle setup without trusting client flags", async () => {
  const first = await save(201);
  await sql(`insert into private.billing_proven_entitlement_grants values('${id(501)}','${id(201)}','live',clock_timestamp()+interval '720 hours',clock_timestamp());insert into public.billing_settlement_outcomes values('${id(502)}','${id(201)}','granted','live');`);
  const read = await rpc("read_active_company_setup_draft", `'${id(1)}'`);
  expect(read.data.paid_protection_receipt_id).toBe(id(501)); expect(read.data.expires_at).toBeNull();
  expect(await sql(`select count(*) from private.master_setup_draft_outbox where state='queued'`)).toBe("0");
  expect((await action(first.data, "keep")).code).toBe("CONFLICT");
});
it("expiry closes precisely at thirty days and queues blocked cleanup without deleting data", async () => {
  const first = await save(null);
  await sql(`update public.company_setup_drafts set last_meaningful_activity_at=clock_timestamp()-interval '720 hours',expires_at=clock_timestamp() where draft_id='${first.data.draft_id}';`);
  const result = JSON.parse(await sql(`set role service_role;select public.master_expire_setup_draft('${first.data.draft_id}');`));
  expect(result.code).toBe("EXPIRED_DELETION_BLOCKED");
  expect(await sql(`select state||':'|| (payload is not null)::text from public.company_setup_drafts where draft_id='${first.data.draft_id}'`)).toBe("deletion_pending:true");
  expect((await save(null)).code).toBe("DRAFT_CLOSED");
});
it("an overdue free draft cannot be revived by a late keep or save before the worker runs", async () => {
  const first = await save(null);
  await sql(`update public.company_setup_drafts set expires_at=clock_timestamp()-interval '1 second' where draft_id='${first.data.draft_id}';`);
  expect((await action(first.data, "keep")).code).toBe("DRAFT_EXPIRED");
  expect((await save(null, first.data.revision, { ...payload, setupStep: 2 })).code).toBe("DRAFT_EXPIRED");
});
it("a trusted payment holding the company lock wins before expiry reevaluates paid protection", async () => {
  const first = await save(201);
  await sql(`update public.company_setup_drafts set expires_at=clock_timestamp()-interval '1 second' where draft_id='${first.data.draft_id}';`);
  const held = trackedSession(`begin;select id from public.companies where id='${id(201)}' for update;insert into private.billing_proven_entitlement_grants values('${id(501)}','${id(201)}','live',clock_timestamp()+interval '720 hours',clock_timestamp());insert into public.billing_settlement_outcomes values('${id(502)}','${id(201)}','granted','live');select 'READY';`);
  await ready(held);
  const pending = sql(`set role service_role;select public.master_expire_setup_draft('${first.data.draft_id}');`);
  held.child.stdin.end("commit;\n"); await held.done;
  expect(JSON.parse(await pending).code).toBe("PAID_PROTECTED");
  expect(await sql(`select state from public.company_setup_drafts where draft_id='${first.data.draft_id}'`)).toBe("active");
});
it("cancellation invalidates a save already waiting on the account lock", async () => {
  const first = await save(null); const preview = await action(first.data, "preview_cancel");
  const held = trackedSession(actor() + `begin;select public.master_setup_draft_action('${id(1)}','${first.data.draft_id}',${first.data.revision},${first.data.generation},'confirm_cancel','${preview.data.confirmationToken}');select 'READY';`);
  await ready(held);
  const pending = save(null, first.data.revision, { ...payload, setupStep: 2 });
  held.child.stdin.end("commit;\n"); await held.done;
  expect((await pending).code).toBe("DRAFT_CLOSED");
});
it("two concurrent scopes commit only one active draft", async () => {
  const results = await Promise.all([save(null), save(201)]);
  expect(results.filter(r => r.ok)).toHaveLength(1); expect(results.filter(r => r.code === "ACTIVE_DRAFT_EXISTS")).toHaveLength(1);
  expect(await sql(`select count(*) from public.company_setup_drafts where user_id='${id(1)}' and state='active'`)).toBe("1");
});
it("revoked sessions and wrong owners cannot read or mutate drafts", async () => {
  const first = await save(201); expect((await action(first.data, "keep", null, 2)).code).toBe("FORBIDDEN");
  expect(JSON.parse(await sql(actor(1, 999) + `select public.read_active_company_setup_draft('${id(1)}');`)).code).toBe("UNAUTHENTICATED");
});
nativeIt.each(["banned", "deleted"])("%s native users with retained JWTs cannot read, save, keep or confirm cancellation", async status => {
  const first = await save(201); const preview = await action(first.data, "preview_cancel");
  await sql(`update auth.users set ${status === "banned" ? "banned_until=clock_timestamp()+interval '1 hour'" : "deleted_at=clock_timestamp()"} where id='${id(1)}';`);
  expect((await rpc("read_active_company_setup_draft", `'${id(1)}'`)).code).toBe("UNAUTHENTICATED");
  expect((await save(201, first.data.revision, { ...payload, setupStep: 2 })).code).toBe("UNAUTHENTICATED");
  expect((await action(first.data, "keep")).code).toBe("UNAUTHENTICATED");
  expect((await action(first.data, "confirm_cancel", preview.data.confirmationToken)).code).toBe("UNAUTHENTICATED");
  expect(await sql(actor() + "select count(*) from public.company_setup_drafts;")).toBe("0");
  expect(await sql(`select state||':'||revision::text from public.company_setup_drafts where draft_id='${first.data.draft_id}'`)).toBe("active:1");
}, 15000);
it("native session expiry during an account-lock wait prevents later cancellation", async () => {
  const first = await save(null); const preview = await action(first.data, "preview_cancel");
  const held = trackedSession(`begin;select pg_advisory_xact_lock(hashtextextended('${id(1)}:setup-draft',0));select 'READY';`);
  await ready(held);
  const pending = action(first.data, "confirm_cancel", preview.data.confirmationToken);
  // The request has already passed its initial actor check and is blocked by the canonical account lock.
  for (let i = 0; i < 50; i++) {
    if (await sql(`select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event='advisory' and query like '%confirm_cancel%')`) === "t") break;
    if (i === 49) throw Error("CANCELLATION_ACCOUNT_LOCK_WAIT_NOT_OBSERVED");
    await new Promise(r => setTimeout(r, 20));
  }
  await sql(`update auth.sessions set not_after=clock_timestamp() where id='${id(101)}';`); held.child.stdin.end("commit;\n"); await held.done;
  expect((await pending).code).toBe("UNAUTHENTICATED");
  expect(await sql(`select state from public.company_setup_drafts where draft_id='${first.data.draft_id}'`)).toBe("active");
}, 15000);
it("idle expiry during a lock wait is checked with the current native clock", async () => {
  const first = await save(null);
  await sql(`update private.app_session_settings set enabled=true;insert into private.app_session_activity(session_id,user_id,last_activity_at) values('${id(101)}','${id(1)}',clock_timestamp());`);
  const held = trackedSession(`begin;select pg_advisory_xact_lock(hashtextextended('${id(1)}:setup-draft',0));select 'READY';`);
  await ready(held); const pending = action(first.data, "keep");
  for (let i = 0; i < 50; i++) {
    if (await sql(`select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event='advisory' and query like '%master_setup_draft_action%')`) === "t") break;
    if (i === 49) throw Error("KEEP_ACCOUNT_LOCK_WAIT_NOT_OBSERVED");
    await new Promise(r => setTimeout(r, 20));
  }
  await sql(`update private.app_session_activity set last_activity_at=clock_timestamp()-interval '2 hours' where session_id='${id(101)}';`); held.child.stdin.end("commit;\n"); await held.done;
  expect((await pending).code).toBe("UNAUTHENTICATED");
}, 15000);
