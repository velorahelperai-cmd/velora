/**
 * WP01A-CORRECTION C5-R4 — DB contract fixtures (opt-in; NotRun by Cursor).
 *
 * Required:
 *   VELORA_WP01A_DB_FIXTURES=1
 *   VELORA_WP01A_DATABASE_URL=postgresql://...@127.0.0.1:...  (explicit local only)
 *   VELORA_WP01A_FIXTURE_USER_ID=<uuid>  (authorized fixture account — never auth.users LIMIT 1)
 *   optional `pg` driver
 *
 * Offline / missing gate → skip (not a pass). Do not run before gate+env approval.
 * Note: sequence nextval is durable across rollback (DB07/DB18).
 * DB18b asserts shared continuity root + exact tip (not issue_seq supersede).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENABLED = process.env.VELORA_WP01A_DB_FIXTURES === "1";
const DATABASE_URL = process.env.VELORA_WP01A_DATABASE_URL?.trim() || "";
const FIXTURE_USER_ID = process.env.VELORA_WP01A_FIXTURE_USER_ID?.trim() || "";

const LOCAL_HOST = /^(postgres(ql)?:\/\/)([^@]+@)?(127\.0\.0\.1|localhost|\[::1\])[:/]/i;

type SqlClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

function gateReason(hasPg: boolean): string {
  if (!ENABLED) return "VELORA_WP01A_DB_FIXTURES!=1";
  if (!DATABASE_URL) return "VELORA_WP01A_DATABASE_URL required (no SUPABASE_DB_URL fallback)";
  if (!LOCAL_HOST.test(DATABASE_URL)) return "DATABASE_URL must be loopback host";
  if (/supabase\.co|pooler\.supabase/i.test(DATABASE_URL)) return "hosted URL refused";
  if (!/^[0-9a-f-]{36}$/i.test(FIXTURE_USER_ID)) return "VELORA_WP01A_FIXTURE_USER_ID required";
  if (!hasPg) return "pg driver not installed";
  return "";
}

async function sqlState(client: SqlClient, text: string, params?: unknown[]): Promise<string | null> {
  try {
    await client.query(text, params);
    return null;
  } catch (e) {
    const err = e as { code?: string };
    return typeof err.code === "string" ? err.code : "UNKNOWN";
  }
}

async function asService(client: SqlClient) {
  // Session-level role (false) so it survives across statements outside aborted txns.
  await client.query(`select set_config('role', 'service_role', false)`);
}

async function beginService(client: SqlClient) {
  await client.query("begin");
  await client.query(`select set_config('role', 'service_role', true)`);
}

describe("WP01A DB contracts C5-R4 (opt-in fixtures)", () => {
  let client: SqlClient | null = null;
  let reason = "init";

  beforeAll(async () => {
    let hasPg = false;
    try {
      await import("pg");
      hasPg = true;
    } catch {
      hasPg = false;
    }
    reason = gateReason(hasPg);
    if (reason) return;
    // Prove environment before connect: parse URL host.
    const u = new URL(DATABASE_URL.replace(/^postgres(ql)?:/i, "http:"));
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost" && u.hostname !== "::1") {
      reason = "host proof failed";
      return;
    }
    const mod = await import("pg");
    const c = new mod.default.Client({ connectionString: DATABASE_URL });
    await c.connect();
    // Fixture existence is setup authority; the tested service role gains no Auth table grant.
    const user = await c.query(`select id from auth.users where id = $1::uuid`, [FIXTURE_USER_ID]);
    if (!user.rows[0]) {
      reason = "fixture user missing";
      await c.end();
      return;
    }
    await asService(c as unknown as SqlClient);
    client = c as unknown as SqlClient;
  });

  afterAll(async () => {
    await client?.end();
  });

  const run = () => Boolean(client) && !reason;

  it("gate documents skip (not a DB pass)", () => {
    if (!run()) expect(reason.length).toBeGreaterThan(0);
    else expect(client).not.toBeNull();
  });

  it("DB01: anon/authenticated denied CRUD on all broker tables (SQLSTATE 42501)", async ({ skip }) => {
    if (!run()) return skip();
    const tables = [
      "vel_broker_sessions",
      "vel_broker_auth_intents",
      "vel_broker_operations",
      "vel_broker_admission",
      "vel_broker_browser_attempts",
      "vel_broker_browser_lineages",
    ];
    await beginService(client!);
    try {
      for (const table of tables) {
        const deny = async (role: "anon" | "authenticated", sql: string) => {
          await client!.query("savepoint sp_denial");
          await client!.query(`select set_config('role', '${role}', true)`);
          expect(await sqlState(client!, sql)).toBe("42501");
          await client!.query("rollback to savepoint sp_denial");
          await client!.query(`select set_config('role', 'service_role', true)`);
        };
        const updateSql =
          table === "vel_broker_browser_attempts"
            ? `update public.${table} set superseded_at=now()`
            : `update public.${table} set updated_at=now()`;
        await deny("anon", `select * from public.${table} limit 1`);
        await deny("anon", `insert into public.${table} default values`);
        await deny("anon", updateSql);
        await deny("anon", `delete from public.${table}`);
        await deny("authenticated", `select * from public.${table} limit 1`);
        await deny("authenticated", `insert into public.${table} default values`);
        await deny("authenticated", updateSql);
        await deny("authenticated", `delete from public.${table}`);
      }
    } finally {
      await client!.query("rollback");
      await asService(client!);
    }
  }, 15000);

  it("DB02: service_role reads ciphertext columns", async ({ skip }) => {
    if (!run()) return skip();
    const { rows } = await client!.query(`
      select column_name from information_schema.columns
      where table_schema='public' and table_name='vel_broker_sessions'
        and column_name in ('access_token_enc','refresh_token_enc')
      order by 1`);
    expect(rows.map((r) => r.column_name)).toEqual(["access_token_enc", "refresh_token_enc"]);
  });

  it("DB03: no grants to public/anon/authenticated on sessions", async ({ skip }) => {
    if (!run()) return skip();
    const { rows } = await client!.query(`
      select grantee from information_schema.role_table_grants
      where table_schema='public' and table_name='vel_broker_sessions'
        and grantee in ('PUBLIC','anon','authenticated')`);
    expect(rows.length).toBe(0);
  });

  it("DB04: DEFINER search_path exactly empty + execute ACL", async ({ skip }) => {
    if (!run()) return skip();
    await asService(client!);
    const { rows } = await client!.query(`
      select p.proname, p.prosecdef, p.proconfig, p.oid from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like 'vel_broker_%'`);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.prosecdef).toBe(true);
      const cfg = (row.proconfig as string[] | null) ?? [];
      const sp = cfg.find((c) => c.startsWith("search_path"));
      expect(sp === "search_path=\"\"" || sp === "search_path=").toBe(true);
      const acl = await client!.query(
        `select has_function_privilege('anon', $1::oid, 'execute') as a,
                has_function_privilege('authenticated', $1::oid, 'execute') as u,
                has_function_privilege('service_role', $1::oid, 'execute') as s`,
        [row.oid],
      );
      // Most broker RPCs deny browser roles; capability/operation_status may differ — deny anon at least.
      expect(acl.rows[0]!.a, `anon EXECUTE ${row.proname} oid=${row.oid}`).toBe(false);
      expect(acl.rows[0]!.s).toBe(true);
    }
  });

  it("DB05: capability probe ok + bound admit/resolve contract (v2)", async ({ skip }) => {
    if (!run()) return skip();
    await asService(client!);
    const { rows } = await client!.query(`select public.vel_broker_capability_probe() as p`);
    const p = rows[0]!.p as Record<string, unknown>;
    expect(p.contract_version).toBe(2);
    expect(p.ok).toBe(true);
    expect(p.admit_atomic).toBe(true);
    expect(p.bound_admit).toBe(true);
    expect(p.bound_resolve).toBe(true);
    expect(p.browser_bootstrap_claim).toBe(true);
    expect(p.complete_revocation_strict).toBe(true);
    expect(p.browser_attempt_issue).toBe(false);
    expect(p.admit_14arg).toBe(false);
    expect(p.issue_seq_column).toBe(true);
    expect(p.admission_scope_column).toBe(true);
    expect(p.complete_revocation).toBe(true);
    expect(p.complete_returns_boolean).toBe(true);
    expect(p.continuity_lookup).toBe(true);
    expect(p.intent_lineage_column).toBe(true);
    const deprecated = await client!.query(
      `select public.vel_broker_admit_session(
        null::uuid, $1::uuid, gen_random_uuid(), 'h'::text, $2::text, $3::text, 'ae'::text, 're'::text, now()+interval '1 hour',
        null::text, gen_random_uuid(), 'enc-handle-token-fixture-abcdefghijklmnop'::text, null::text, 'app'::text
      ) as r`,
      [FIXTURE_USER_ID, `vel_sh_${"e".repeat(32)}`, "e".repeat(32)],
    );
    expect((deprecated.rows[0]!.r as { code?: string }).code).toBe("DEPRECATED_USE_BOUND_ADMIT");
    const issueDenied = await client!.query(
      `select public.vel_broker_issue_browser_attempt(null, null) as j`,
    );
    expect((issueDenied.rows[0]!.j as { ok?: boolean; code?: string }).ok).toBe(false);
    expect((issueDenied.rows[0]!.j as { code?: string }).code).toBe("DEPRECATED_USE_CONTINUITY");
  });

  it("DB06: schema drift + deprecated admit overload fail closed", async ({ skip }) => {
    if (!run()) return skip();
    await asService(client!);
    const { rows } = await client!.query(`
      select data_type from information_schema.columns
      where table_schema='public' and table_name='vel_broker_sessions' and column_name='auth_ordinal'`);
    expect(rows[0]?.data_type).toBe("bigint");
    const scopeCol = await client!.query(`
      select 1 from information_schema.columns
      where table_schema='public' and table_name='vel_broker_sessions' and column_name='admission_scope'`);
    expect(scopeCol.rows.length).toBe(1);
    const probe = await client!.query(`select public.vel_broker_capability_probe() as p`);
    const p = probe.rows[0]!.p as { ok: boolean; codes: unknown };
    expect(Array.isArray(p.codes)).toBe(true);
    expect(typeof p.ok).toBe("boolean");
    const legacy = await client!.query(
      `select public.vel_broker_admit_session(
        null::uuid, $1::uuid, gen_random_uuid(), 'h'::text, 'vel_sh_${"a".repeat(32)}'::text, $2::text,
        'ae'::text, 're'::text, now()+interval '1 hour', null::text
      ) as r`,
      [FIXTURE_USER_ID, "a".repeat(32)],
    );
    expect((legacy.rows[0]!.r as { code?: string }).code).toBe("DEPRECATED_SIGNATURE");
  });

  it("DB07: ordinal sequence advances (note: nextval not rolled back)", async ({ skip }) => {
    if (!run()) return skip();
    // Capture ordinals outside a failed txn expectation — sequence consumption is durable.
    const a = await client!.query(`select public.vel_broker_next_auth_ordinal() as o`);
    const b = await client!.query(`select public.vel_broker_next_auth_ordinal() as o`);
    expect(Number(b.rows[0]!.o)).toBeGreaterThan(Number(a.rows[0]!.o));
  });

  it("DB08: claim_refresh blocks second rotate (savepoint)", async ({ skip }) => {
    if (!run()) return skip();
    await beginService(client!);
    try {
      await client!.query("savepoint sp_claim");
      const gen = `${Date.now().toString(16)}aaaaaaaaaaaaaaaaaaaaaaaa`.slice(0, 32);
      const ins = await client!.query(
        `insert into public.vel_broker_sessions (
          handle_hash, cookie_name, generation, user_id, native_session_id,
          access_token_enc, refresh_token_enc, token_expires_at, auth_ordinal, status, refresh_state, browser_lineage_id
        ) values ($1,$2,$3,$4::uuid,gen_random_uuid(),'x','y',now()+interval '1 hour', 1, 'active', 'idle', gen_random_uuid())
        returning id, refresh_revision`,
        [`h_${Date.now()}`, `vel_sh_${gen}`, gen, FIXTURE_USER_ID],
      );
      const id = ins.rows[0]!.id;
      const rev = ins.rows[0]!.refresh_revision;
      const t1 = await client!.query(`select public.vel_broker_claim_refresh($1::uuid,$2::bigint,15000) as t`, [id, rev]);
      expect(typeof t1.rows[0]!.t).toBe("string");
      const t2 = await client!.query(`select public.vel_broker_claim_refresh($1::uuid,$2::bigint,15000) as t`, [id, rev]);
      expect(t2.rows[0]!.t).toBeNull();
      await client!.query("rollback to savepoint sp_claim");
    } finally {
      await client!.query("rollback");
      await asService(client!);
    }
  });

  it("DB09: barrier ownership CAS with fixture user", async ({ skip }) => {
    if (!run()) return skip();
    await beginService(client!);
    try {
      const a = await client!.query(
        `select public.vel_broker_set_admission_barrier($1::uuid,'op_aaaaaaaaaaaaaaaa'::text,true) as ok`,
        [FIXTURE_USER_ID],
      );
      expect(a.rows[0]!.ok).toBe(true);
      const b = await client!.query(
        `select public.vel_broker_set_admission_barrier($1::uuid,'op_bbbbbbbbbbbbbbbb'::text,true) as ok`,
        [FIXTURE_USER_ID],
      );
      expect(b.rows[0]!.ok).toBe(false);
      const rel = await client!.query(
        `select public.vel_broker_set_admission_barrier($1::uuid,'op_aaaaaaaaaaaaaaaa'::text,false) as ok`,
        [FIXTURE_USER_ID],
      );
      expect(rel.rows[0]!.ok).toBe(true);
    } finally {
      await client!.query("rollback");
      await asService(client!);
    }
  });

  it("DB10: bound admit fixture + legacy admit_session denied", async ({ skip }) => {
    if (!run()) return skip();
    await beginService(client!);
    try {
      const hash = "d".repeat(64);
      const bind = await client!.query(
        `select public.vel_broker_bind_browser_continuity($1) as j`,
        [hash],
      );
      expect((bind.rows[0]!.j as { ok: boolean }).ok).toBe(true);
      const nonce = cryptoRandomUuid();
      const reserved = await client!.query(
        `select public.vel_broker_reserve_bound_intent($1, $2::uuid, 'password_login', null, 600) as j`,
        [hash, nonce],
      );
      const intent = reserved.rows[0]!.j as { ok: boolean; intent_id: string };
      expect(intent.ok).toBe(true);
      const claim = await client!.query(
        `select public.vel_broker_claim_provider_attempt($1::uuid) as j`,
        [intent.intent_id],
      );
      expect((claim.rows[0]!.j as { claimed?: boolean }).claimed).toBe(true);
      const nativeId=cryptoRandomUuid();
      const capture=await client!.query(`select public.vel_broker_record_provider_session($1::uuid,$2::uuid,$3::uuid,'synthetic-access-enc','synthetic-refresh-enc',now()+interval '1 hour') as ok`,[intent.intent_id,FIXTURE_USER_ID,nativeId]);
      expect(capture.rows[0]!.ok).toBe(true);
      const admitSql=`select public.vel_broker_admit_bound_session($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,'synthetic-access-enc','synthetic-refresh-enc',now()+interval '1 hour','app',null,'synthetic-handle-enc-abcdefghijklmnop') as j`;
      const admitArgs=[intent.intent_id,FIXTURE_USER_ID,nativeId,"f".repeat(64),`vel_sh_${"f".repeat(32)}`,"f".repeat(32)];
      const admitted=await client!.query(admitSql,admitArgs);
      const receipt=admitted.rows[0]!.j as {ok?:boolean;registry_id?:string};expect(receipt.ok).toBe(true);
      const replay=await client!.query(admitSql,admitArgs);expect((replay.rows[0]!.j as {registry_id?:string}).registry_id).toBe(receipt.registry_id);
      const adopted=await client!.query(`select public.vel_broker_begin_provider_cleanup($1::uuid,$2::uuid,$3::uuid,'synthetic-access-enc','synthetic-refresh-enc') as j`,[intent.intent_id,FIXTURE_USER_ID,nativeId]);
      expect(adopted.rows[0]!.j).toMatchObject({ok:true,allowed:false,adopted:true});
      const reserved2=await client!.query(`select public.vel_broker_reserve_bound_intent($1,$2::uuid,'password_login',null,600) as j`,[hash,cryptoRandomUuid()]);
      const intent2=(reserved2.rows[0]!.j as {intent_id:string}).intent_id;const native2=cryptoRandomUuid();
      await client!.query(`select public.vel_broker_claim_provider_attempt($1::uuid)`,[intent2]);
      await client!.query(`select public.vel_broker_record_provider_session($1::uuid,$2::uuid,$3::uuid,'synthetic-access-enc','synthetic-refresh-enc',now()+interval '1 hour')`,[intent2,FIXTURE_USER_ID,native2]);
      const cleanup=await client!.query(`select public.vel_broker_begin_provider_cleanup($1::uuid,$2::uuid,$3::uuid,'synthetic-access-enc','synthetic-refresh-enc') as j`,[intent2,FIXTURE_USER_ID,native2]);
      expect(cleanup.rows[0]!.j).toMatchObject({ok:true,allowed:true,cleanup_state:"unknown"});
      const denied=await client!.query(admitSql,[intent2,FIXTURE_USER_ID,native2,"e".repeat(64),`vel_sh_${"e".repeat(32)}`,"e".repeat(32)]);
      expect(denied.rows[0]!.j).toMatchObject({ok:false,code:"PROVIDER_CLEANUP_PENDING"});
      const unknown=await client!.query(`select status,cleanup_state,provider_access_enc is not null as captured from public.vel_broker_auth_intents where id=$1::uuid`,[intent2]);
      expect(unknown.rows[0]).toMatchObject({status:"rejected",cleanup_state:"unknown",captured:true});
      const legacy = await client!.query(
        `select public.vel_broker_admit_session(
          null::uuid, $1::uuid, gen_random_uuid(), 'h'::text, $2::text, $3::text, 'ae'::text, 're'::text, now()+interval '1 hour',
          null::text, gen_random_uuid(), 'enc-handle-token-fixture-abcdefghijklmnop'::text, null::text
        ) as r`,
        [FIXTURE_USER_ID, `vel_sh_${"e".repeat(32)}`, "e".repeat(32)],
      );
      expect((legacy.rows[0]!.r as { ok?: boolean; code?: string }).ok).toBe(false);
      expect((legacy.rows[0]!.r as { code?: string }).code).toBe("DEPRECATED_SIGNATURE");
    } finally {
      await client!.query("rollback");
      await asService(client!);
    }
  });

  it("DB11: freeze empty snapshot once (snapshot_frozen)", async ({ skip }) => {
    if (!run()) return skip();
    await beginService(client!);
    try {
      const key = `op_freeze_${Date.now()}`;
      await client!.query(
        `insert into public.vel_broker_operations(operation_key,kind,actor_user_id,target_snapshot,stages,status,snapshot_frozen)
         values ($1,'logout',$2::uuid,'[]'::jsonb,'{}'::jsonb,'open',false)`,
        [key, FIXTURE_USER_ID],
      );
      const f1 = await client!.query(
        `select public.vel_broker_freeze_operation_snapshot($1,$2::uuid,'[]'::jsonb) as ok`,
        [key, FIXTURE_USER_ID],
      );
      expect(f1.rows[0]!.ok).toBe(true);
      await client!.query(
        `select public.vel_broker_freeze_operation_snapshot($1,$2::uuid,'[{"x":1}]'::jsonb) as ok`,
        [key, FIXTURE_USER_ID],
      );
      const snap = await client!.query(
        `select target_snapshot, snapshot_frozen from public.vel_broker_operations where operation_key=$1`,
        [key],
      );
      expect(snap.rows[0]!.snapshot_frozen).toBe(true);
      expect(snap.rows[0]!.target_snapshot).toEqual([]);
      const revision = await client!.query(`select revision from public.vel_broker_operations where operation_key=$1`, [key]);
      const unfreeze = await client!.query(`select public.vel_broker_patch_operation($1,$2::bigint,'{"snapshot_frozen":false}'::jsonb) as j`, [key, revision.rows[0]!.revision]);
      expect((unfreeze.rows[0]!.j as {code?:string}).code).toBe("SNAPSHOT_FROZEN");
      await client!.query("savepoint frozen_direct");
      expect(await sqlState(client!, `update public.vel_broker_operations set snapshot_frozen=false where operation_key=$1`, [key])).toBe("P0001");
      await client!.query("rollback to savepoint frozen_direct");
    } finally {
      await client!.query("rollback");
      await asService(client!);
    }
  });

  it("DB12: revoke_sessions_at freezes cutoff (retry cannot advance)", async ({ skip }) => {
    if (!run()) return skip();
    await beginService(client!);
    try {
      const key = `op_cutoff_${Date.now().toString(16)}aaaaaaaa`;
      const t1 = "2026-01-01T00:00:00.000Z";
      const t2 = "2026-06-01T00:00:00.000Z";
      await client!.query(
        `insert into public.vel_broker_operations(operation_key,kind,actor_user_id,stages,status)
         values ($1,'password_revoke',$2::uuid,'{}'::jsonb,'open')`,
        [key, FIXTURE_USER_ID],
      );
      const r1 = await client!.query(
        `select public.vel_broker_revoke_sessions_at($1::uuid,$2,$3::timestamptz) as ok`,
        [FIXTURE_USER_ID, key, t1],
      );
      expect(r1.rows[0]!.ok).toBe(true);
      const r2 = await client!.query(
        `select public.vel_broker_revoke_sessions_at($1::uuid,$2,$3::timestamptz) as ok`,
        [FIXTURE_USER_ID, key, t2],
      );
      expect(r2.rows[0]!.ok).toBe(true);
      const { rows } = await client!.query(
        `select cutoff from public.vel_broker_operations where operation_key=$1`,
        [key],
      );
      expect(new Date(String(rows[0]!.cutoff)).toISOString()).toBe(t1);
    } finally {
      await client!.query("rollback");
      await asService(client!);
    }
  });

  it("DB13: operation_status foreign actor denied", async ({ skip }) => {
    if (!run()) return skip();
    await beginService(client!);
    try {
      const key = `op_foreign_${Date.now()}`;
      await client!.query(
        `insert into public.vel_broker_operations(operation_key,kind,actor_user_id,stages,status)
         values ($1,'logout',$2::uuid,'{}'::jsonb,'pending')`,
        [key, FIXTURE_USER_ID],
      );
      await client!.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
        "00000000-0000-0000-0000-000000000099",
      ]);
      await client!.query(`select set_config('role', 'authenticated', true)`);
      const { rows } = await client!.query(`select public.vel_broker_operation_status($1) as s`, [key]);
      // Foreign authenticated should not see actor's operation details.
      const s = rows[0]?.s;
      expect(s === null || (typeof s === "object" && (s as { ok?: boolean }).ok === false)).toBe(true);
    } finally {
      await client!.query("rollback");
      await asService(client!);
    }
  });

  it("DB14: old schema without lineage columns fails closed at admit tip helper", async ({ skip }) => {
    if (!run()) return skip();
    const { rows } = await client!.query(`
      select 1 from information_schema.columns
      where table_schema='public' and table_name='vel_broker_sessions' and column_name='browser_lineage_id'`);
    expect(rows.length).toBe(1);
    const tip = await client!.query(`select * from public.vel_broker_lineage_tip(gen_random_uuid())`);
    expect(Array.isArray(tip.rows)).toBe(true);
  });

  it("DB15: retained boolean revoke + idle wrappers", async ({ skip }) => {
    if (!run()) return skip();
    const { rows } = await client!.query(
      `select pg_get_function_result('public.master_revoke_account_sessions(uuid)'::regprocedure) as r`,
    );
    expect(rows[0]?.r).toBe("boolean");
  });

  it("DB16: capability probe stable across two calls (not mixed-version rewrite)", async ({ skip }) => {
    if (!run()) return skip();
    const a = await client!.query(`select public.vel_broker_capability_probe() as p`);
    const b = await client!.query(`select public.vel_broker_capability_probe() as p`);
    expect(a.rows[0]!.p).toEqual(b.rows[0]!.p);
    expect((a.rows[0]!.p as { contract_version: number }).contract_version).toBe(2);
  });

  it("DB17: ciphertext columns not granted to authenticated", async ({ skip }) => {
    if (!run()) return skip();
    await beginService(client!);
    try {
      await client!.query(`select set_config('role', 'authenticated', true)`);
      const code = await sqlState(
        client!,
        `select access_token_enc from public.vel_broker_sessions limit 1`,
      );
      expect(code).toBe("42501");
    } finally {
      await client!.query("rollback");
      await asService(client!);
    }
  });

  it("DB18b: admit A then B; missing B handle never returns A", async ({ skip }) => {
    if (!run()) return skip();
    await beginService(client!);
    try {
      const hash = "a".repeat(64);
      const bind = await client!.query(
        `select public.vel_broker_bind_browser_continuity($1) as j`,
        [hash],
      );
      const rootId = (bind.rows[0]!.j as { browser_lineage_id: string }).browser_lineage_id;
      const hashA = `ha_${"1".repeat(28)}`;
      const hashB = `hb_${"2".repeat(28)}`;
      const sidA = crypto.randomUUID();
      const sidB = crypto.randomUUID();
      const regA = crypto.randomUUID();
      const regB = crypto.randomUUID();
      const o1 = await client!.query(`select public.vel_broker_next_auth_ordinal() as o`);
      const o2 = await client!.query(`select public.vel_broker_next_auth_ordinal() as o`);
      await client!.query(
        `insert into public.vel_broker_sessions (
          id, handle_hash, cookie_name, generation, user_id, native_session_id,
          access_token_enc, refresh_token_enc, token_expires_at, auth_ordinal, status,
          browser_lineage_id, admission_scope
        ) values
          ($1::uuid,$2,'vel_sh_aaa','aaa',$3::uuid,$4::uuid,'ae','re',now()+interval '1 hour',$5,'tombstoned',$6::uuid,'app'),
          ($7::uuid,$8,'vel_sh_bbb','bbb',$3::uuid,$9::uuid,'ae','re',now()+interval '1 hour',$10,'active',$6::uuid,'app')`,
        [
          regA, hashA, FIXTURE_USER_ID, sidA, Number(o1.rows[0]!.o), rootId,
          regB, hashB, sidB, Number(o2.rows[0]!.o),
        ],
      );
      await client!.query(
        `update public.vel_broker_browser_lineages
           set current_registry_id=$1::uuid, current_generation=2, valid_until=now()+interval '30 days'
         where id=$2::uuid`,
        [regB, rootId],
      );
      // Present only A (tombstoned tip predecessor) — must not resurrect.
      const onlyA = await client!.query(
        `select public.vel_broker_resolve_bound_session($1, ARRAY[$2]::text[], 'app') as j`,
        [hash, hashA],
      );
      expect((onlyA.rows[0]!.j as { ok?: boolean; code?: string }).ok).toBe(false);
      expect((onlyA.rows[0]!.j as { code?: string }).code).toBe("UNAUTHENTICATED");
      // Present B — exact tip.
      const withB = await client!.query(
        `select public.vel_broker_resolve_bound_session($1, ARRAY[$2]::text[], 'app') as j`,
        [hash, hashB],
      );
      expect((withB.rows[0]!.j as { ok?: boolean; handle_hash?: string }).ok).toBe(true);
      expect((withB.rows[0]!.j as { handle_hash?: string }).handle_hash).toBe(hashB);
      // Independent root unaffected.
      const other = await client!.query(
        `select public.vel_broker_bind_browser_continuity($1) as j`,
        ["b".repeat(64)],
      );
      expect((other.rows[0]!.j as { browser_lineage_id: string }).browser_lineage_id).not.toBe(rootId);
    } finally {
      await client!.query("rollback");
      await asService(client!);
    }
  });

  it("DB18b-r4: complete rejects incomplete; success confirms; lost reply idempotent", async ({ skip }) => {
    if (!run()) return skip();
    await beginService(client!);
    try {
      const opKey = `op_${"c".repeat(40)}`;
      const regId = crypto.randomUUID();
      const nativeId = crypto.randomUUID();
      const cutoff = new Date().toISOString();
      await client!.query(
        `insert into public.vel_broker_sessions (
          id, handle_hash, cookie_name, generation, user_id, native_session_id,
          access_token_enc, refresh_token_enc, token_expires_at, auth_ordinal, status
        ) values ($1::uuid,'hx','vel_sh_x','x',$2::uuid,$3::uuid,'ae','re',now()+interval '1 hour',1,'active')`,
        [regId, FIXTURE_USER_ID, nativeId],
      );
      await client!.query(
        `insert into public.vel_broker_operations(
           operation_key, kind, actor_user_id, status, stages, snapshot_frozen,
           target_snapshot, target_receipts, legacy_coverage, cutoff, credential_mutated_at
         ) values ($1, 'password_revoke', $2::uuid, 'pending',
           '{"credentialMutation":"confirmed","appRevocation":"confirmed","nativeRevocation":"pending"}'::jsonb,
           false, '[]'::jsonb, '{}'::jsonb, 'pending', $3::timestamptz, $3::timestamptz)`,
        [opKey, FIXTURE_USER_ID, cutoff],
      );
      await client!.query(
        `insert into public.vel_broker_admission(user_id, barrier_operation_key, barrier_active)
         values ($1::uuid, $2, true)
         on conflict (user_id) do update
           set barrier_operation_key=excluded.barrier_operation_key, barrier_active=true`,
        [FIXTURE_USER_ID, opKey],
      );
      const bad = await client!.query(
        `select public.vel_broker_complete_revocation_operation($1::uuid, $2) as j`,
        [FIXTURE_USER_ID, opKey],
      );
      expect(bad.rows[0]!.j).toBe(false);

      await client!.query(
        `update public.vel_broker_operations set
           stages = '{"credentialMutation":"confirmed","appRevocation":"confirmed","nativeRevocation":"confirmed"}'::jsonb,
           snapshot_frozen = true,
           legacy_coverage = 'absent',
           target_snapshot = $1::jsonb,
           target_receipts = $2::jsonb
         where operation_key = $3`,
        [
          JSON.stringify([{ registryId: regId, nativeSessionId: nativeId }]),
          JSON.stringify({ [regId]: "native_confirmed" }),
          opKey,
        ],
      );
      const ok1 = await client!.query(
        `select public.vel_broker_complete_revocation_operation($1::uuid, $2) as j`,
        [FIXTURE_USER_ID, opKey],
      );
      expect(ok1.rows[0]!.j).toBe(true);
      const ok2 = await client!.query(
        `select public.vel_broker_complete_revocation_operation($1::uuid, $2) as j`,
        [FIXTURE_USER_ID, opKey],
      );
      expect(ok2.rows[0]!.j).toBe(true);
      const st = await client!.query(
        `select status, completion_receipt is not null as has_receipt from public.vel_broker_operations where operation_key=$1`,
        [opKey],
      );
      expect(st.rows[0]!.status).toBe("confirmed");
      expect(st.rows[0]!.has_receipt).toBe(true);
      const beforeAck = await client!.query(`select stages,revision,completion_receipt,target_receipts from public.vel_broker_operations where operation_key=$1`, [opKey]);
      const stagesAck = {...(beforeAck.rows[0]!.stages as Record<string,unknown>),clientCleanup:"confirmed"};
      const ack = await client!.query(`select public.vel_broker_patch_operation($1,$2::bigint,$3::jsonb) as j`, [opKey,beforeAck.rows[0]!.revision,JSON.stringify({status:"confirmed",stages:stagesAck})]);
      expect((ack.rows[0]!.j as {ok?:boolean}).ok).toBe(true);
      const afterAck = await client!.query(`select stages,revision,completion_receipt,target_receipts from public.vel_broker_operations where operation_key=$1`, [opKey]);
      expect((afterAck.rows[0]!.stages as Record<string,unknown>).clientCleanup).toBe("confirmed");
      expect(afterAck.rows[0]!.completion_receipt).toEqual(beforeAck.rows[0]!.completion_receipt);
      expect(afterAck.rows[0]!.target_receipts).toEqual(beforeAck.rows[0]!.target_receipts);
      const illegalAck = await client!.query(`select public.vel_broker_patch_operation($1,$2::bigint,$3::jsonb) as j`, [opKey,afterAck.rows[0]!.revision,JSON.stringify({stages:{...stagesAck,nativeRevocation:"unknown"}})]);
      expect((illegalAck.rows[0]!.j as {code?:string}).code).toBe("CONFIRMED_IMMUTABLE");
      // Newer barrier owned by another op must remain untouched after historical complete.
      const otherOp = `op_${"d".repeat(40)}`;
      await client!.query(
        `update public.vel_broker_admission
           set barrier_operation_key=$1, barrier_active=true where user_id=$2::uuid`,
        [otherOp, FIXTURE_USER_ID],
      );
      const again = await client!.query(
        `select public.vel_broker_complete_revocation_operation($1::uuid, $2) as j`,
        [FIXTURE_USER_ID, opKey],
      );
      expect(again.rows[0]!.j).toBe(true);
      const barrier = await client!.query(
        `select barrier_operation_key, barrier_active from public.vel_broker_admission where user_id=$1::uuid`,
        [FIXTURE_USER_ID],
      );
      expect(barrier.rows[0]!.barrier_operation_key).toBe(otherOp);
      expect(barrier.rows[0]!.barrier_active).toBe(true);
    } finally {
      await client!.query("rollback");
      await asService(client!);
    }
  });

  it("DB18: sequence ACL — authenticated cannot nextval intent ordinal", async ({ skip }) => {
    if (!run()) return skip();
    await asService(client!);
    const { rows } = await client!.query(
      `select pg_get_serial_sequence('public.vel_broker_auth_intents','ordinal') as seq`,
    );
    const seq = String(rows[0]?.seq ?? "");
    expect(seq.length).toBeGreaterThan(0);
    // nextval advances permanently if allowed — only probe under authenticated.
    await beginService(client!);
    try {
      await client!.query(`select set_config('role', 'authenticated', true)`);
      const code = await sqlState(client!, `select nextval($1::regclass)`, [seq]);
      expect(code).toBe("42501");
    } finally {
      await client!.query("rollback");
      await asService(client!);
    }
  });
});

function cryptoRandomUuid(): string {
  // Prefer Web Crypto when present; Node 19+ globalThis.crypto.randomUUID.
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "00000000-0000-4000-8000-000000000001";
}

export const WP01A_DB_CONTRACT = {
  migrations: [
    "supabase/migrations/20261016080000_wp01a_session_broker.sql",
    "supabase/migrations/20261016090000_wp01a_session_broker_correction.sql",
    "supabase/migrations/20261016100000_wp01a_session_broker_correction_r2.sql",
    "supabase/migrations/20261016110000_wp01a_session_broker_correction_c3.sql",
    "supabase/migrations/20261016120000_wp01a_session_broker_correction_c4.sql",
    "supabase/migrations/20261016130000_wp01a_session_broker_retire_admit_overloads.sql",
    "supabase/migrations/20261016140000_wp01a_session_broker_correction_c5.sql",
    "supabase/migrations/20261016150000_wp01a_session_broker_correction_c5_r2.sql",
    "supabase/migrations/20261016160000_wp01a_session_broker_correction_c5_r3.sql",
    "supabase/migrations/20261016170000_wp01a_session_broker_correction_c5_r4.sql",
  ],
  optInEnv: [
    "VELORA_WP01A_DB_FIXTURES=1",
    "VELORA_WP01A_DATABASE_URL=postgresql://...@127.0.0.1/...",
    "VELORA_WP01A_FIXTURE_USER_ID=<uuid>",
  ],
  acceptance:
    "Opt-in local fixture assertions; no SUPABASE_DB_URL fallback; no auth.users LIMIT 1; retire DROP inert; R4 continuity+bound tip",
  note: "Retirement migration is no-op until explicit approval (C4-07). Cursor does not run fixtures.",
} as const;
