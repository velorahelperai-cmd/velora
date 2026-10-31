// Local disposable Postgres for knowledge-file-worker acceptance only.
// Same isolation contract as scripts/g03-review-acceptance/postgres.mjs, with:
// - LF normalization of SQL files (Windows CRLF breaks pinned prosrc digests)
// - longer docker inspect timeout during heavy baseline replay
// - documented paymob-live-checkout predecessor + composed alternative installers
//   (same local composition as scripts/account-deletion/full-baseline.mjs)
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { nativeBillingOwner } from "../account-deletion/full-baseline.mjs";
import { branchCompatibility, reviewFamilyEquivalence } from "../account-deletion/branch-compat.mjs";
import { embeddedTrialHistory } from "../account-deletion/history-compat.mjs";

const rawExec = promisify(execFile);
const exec = (file, args) =>
  rawExec(file, args, { timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
export const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;
const IMAGE = "supabase/postgres:17.6.1.136";
const TASK = "knowledge-file-worker-native";
/** Match scripts/integration/local-http-stack.mjs — required by LOCAL_ONLY ES02 credit gate. */
const DB = "c1_ui_integration";

function lf(sql) {
  return String(sql).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

/**
 * Match scripts/integration/local-cron-test-stack.mjs + staff-invitations cases:
 *   BEGIN; SET LOCAL ROLE postgres; <migration body>; COMMIT;
 * Staff recovery header requires a transaction ("Apply transactionally");
 * production installer uses psql --single-transaction. Role postgres satisfies
 * deterministic owner/ACL guards used by later historical installers.
 * Inner begin/commit inside a migration body is tolerated by PostgreSQL
 * (nested BEGIN warns; trailing outer COMMIT is a no-op warning).
 */
export function wrapMigrationTransaction(body) {
  const text = lf(body);
  return `begin;\nset local role postgres;\n${text}\ncommit;`;
}

export async function isolatedPostgres() {
  const run = randomUUID();
  const container = `velora-kfw-${run.slice(0, 8)}`;
  const context = JSON.parse((await exec("docker", ["context", "inspect"])).stdout)[0];
  const endpoint = context?.Endpoints?.docker?.Host ?? "";
  if (!/^(npipe:\/\/|unix:\/\/)/.test(endpoint)) throw Error("NON_LOCAL_DOCKER");
  await exec("docker", ["image", "inspect", IMAGE]);
  // Match local-http-stack: real pg_cron bound to this disposable DB, jobs not launched.
  await rawExec(
    "docker",
    [
      "run",
      "--pull=never",
      "-d",
      "--name",
      container,
      "--label",
      `velora.task=${TASK}`,
      "--label",
      `velora.run=${run}`,
      "--network",
      "none",
      "--tmpfs",
      "/var/lib/postgresql/data:rw,size=1073741824",
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      IMAGE,
      "postgres",
      "-D",
      "/etc/postgresql",
      "-c",
      `cron.database_name=${DB}`,
      "-c",
      "cron.launch_active_jobs=off",
    ],
    { timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );

  async function verify() {
    const c = JSON.parse((await exec("docker", ["inspect", container])).stdout)[0];
    if (
      c.Config.Labels?.["velora.task"] !== TASK
      || c.Config.Labels?.["velora.run"] !== run
      || c.Config.Image !== IMAGE
      || c.HostConfig.NetworkMode !== "none"
      || !c.HostConfig.Tmpfs?.["/var/lib/postgresql/data"]
      || Object.keys(c.HostConfig.PortBindings ?? {}).length
      || c.Mounts.some((m) => m.Type !== "tmpfs")
    ) {
      throw Error("UNSAFE_DATABASE_TARGET");
    }
  }
  function session(query, name = "kfw-test", { keepOpen = false } = {}) {
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        "-u",
        "postgres",
        container,
        "psql",
        "-X",
        "-U",
        "supabase_admin",
        "-d",
        DB,
        "-Atq",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const done = new Promise((ok, fail) => {
      const timer = setTimeout(() => {
        child.kill();
        fail(Error("LOCAL_PSQL_PROCESS_TIMEOUT"));
      }, 120_000);
      child.on("error", fail);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) ok(stdout.trim());
        else fail(Error(stderr || `psql ${code}`));
      });
    });
    const input = `SET application_name=${lit(name)};\nSET statement_timeout='60s';\nSET lock_timeout='10s';\n${query}\n`;
    if (keepOpen) child.stdin.write(input);
    else child.stdin.end(input);
    return { child, done, output: () => stdout };
  }
  async function sql(query, name) {
    await verify();
    return session(query, name).done;
  }
  async function file(path, { transactionalMigration = false } = {}) {
    const raw = readFileSync(resolve(path), "utf8");
    return sql(transactionalMigration ? wrapMigrationTransaction(raw) : lf(raw));
  }
  async function bootstrap({ throughMigration, skipMigrations = [] } = {}) {
    await verify();
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        const logs = await exec("docker", ["logs", container]);
        if (!(logs.stdout + logs.stderr).includes("init process complete")) throw Error("INITIALIZING");
        await exec("docker", ["exec", "-u", "postgres", container, "pg_isready", "-U", "supabase_admin"]);
        break;
      } catch {
        if (attempt === 119) throw Error("POSTGRES_NOT_READY");
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    await exec("docker", ["exec", "-u", "postgres", container, "createdb", "-U", "supabase_admin", DB]);
    // local-cron-test-stack / DIAGNOSTICS: deterministic installers need DB owner postgres
    // so SET LOCAL ROLE postgres can create objects and satisfy owner/ACL guards.
    // DB name must be c1_ui_integration for ES02 operational-credit LOCAL_ONLY gate.
    await sql(`ALTER DATABASE ${DB} OWNER TO postgres;`);
    await file("scripts/whatsapp-integration/dependency-stubs.sql");
    // Auth tables from stubs must be owned by postgres so later migrations can
    // create indexes/triggers on auth.users under SET LOCAL ROLE postgres
    // (same ownership model as the GoTrue-backed local integration stack).
    await sql(`
do $$ begin
  create role supabase_auth_admin nologin; exception when duplicate_object then null;
end $$;
alter schema auth owner to postgres;
alter schema storage owner to postgres;
grant all on schema auth, storage to postgres;
alter table auth.users owner to postgres;
alter table auth.sessions owner to postgres;
alter table storage.buckets owner to postgres;
alter table storage.objects owner to postgres;
-- Columns referenced by later master/ES02 migrations; present on real GoTrue Auth.
alter table auth.users add column if not exists deleted_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists is_sso_user boolean not null default false;
alter table auth.users add column if not exists phone_change text;
alter table auth.users add column if not exists phone_change_token text;
alter table auth.users add column if not exists phone_change_sent_at timestamptz;
alter table auth.users add column if not exists confirmed_at timestamptz;
alter table auth.users add column if not exists invited_at timestamptz;
alter table auth.users add column if not exists confirmation_token text;
alter table auth.users add column if not exists recovery_token text;
alter table auth.users add column if not exists email_change text;
alter table auth.users add column if not exists email_change_token_new text;
alter table auth.users add column if not exists email_change_token_current text;
alter table auth.users add column if not exists last_sign_in_at timestamptz;
alter table auth.sessions add column if not exists not_after timestamptz;
alter table auth.sessions add column if not exists aal text;
alter table auth.sessions add column if not exists refreshed_at timestamptz;
alter table auth.sessions add column if not exists user_agent text;
alter table auth.sessions add column if not exists ip text;
`);
    // Match local-http-stack / whatsapp-integration: real vault crypto + postgres
    // ownership so later WA checkpoint guards can attach triggers on vault.secrets.
    await rawExec(
      "docker",
      ["exec", container, "bash", "-c", "/usr/lib/postgresql/bin/pgsodium_getkey.sh > /dev/null"],
      { timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    );
    await sql(`CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;`);
    await sql(`
do $$ begin
  begin
    create role supabase_auth_admin nologin;
  exception when duplicate_object then null;
  end;
end $$;
grant supabase_auth_admin to postgres;
alter table if exists vault.secrets owner to postgres;
alter table if exists vault.decrypted_secrets owner to postgres;
revoke all on vault.secrets from public, anon, authenticated, service_role;
grant select, insert, update, delete, truncate, references, trigger on vault.secrets to postgres with grant option;
`);
    await sql(`begin;
do $$ declare probe uuid; begin
  probe:=vault.create_secret('synthetic-local-platform-probe');
  if not exists(select 1 from vault.secrets where id=probe and secret<>'synthetic-local-platform-probe')
     or not exists(select 1 from vault.decrypted_secrets where id=probe and decrypted_secret='synthetic-local-platform-probe')
  then raise exception 'LOCAL_VAULT_CRYPTO_UNAVAILABLE'; end if;
end $$;
rollback;`);
    // Match scripts/integration/local-cron-test-stack.mjs: Supabase CLI installation
    // history required by deterministic historical installers (e.g. WA compatibility).
    await sql(`
create schema if not exists supabase_migrations authorization postgres;
create table if not exists supabase_migrations.schema_migrations(
 version text primary key,statements text[],name text,created_by text,idempotency_key text unique,rollback text[]
);
alter table supabase_migrations.schema_migrations owner to postgres;
revoke all on schema supabase_migrations from public,anon,authenticated;
revoke all on supabase_migrations.schema_migrations from public,anon,authenticated;
`);
    let count = 0;
    const skipped = [];
    let paymobPredecessor = null;
    let reviewSnapshot = null;
    const reviewCatalogSql = `
select coalesce(jsonb_agg(jsonb_build_object(
  'oid', p.oid,
  'signature', p.oid::regprocedure::text,
  'body', md5(p.prosrc)
) order by p.oid), '[]'::jsonb)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'private' and (p.proname like 'smart_review_%' or p.proname like 'g03_%'))
   or (n.nspname = 'public' and p.proname in (
     'smart_review_configuration','g03_begin_review_check','transition_company_review','g03_complete_review_check'
   ))`;
    const recordHistory = async (name) => {
      const version = name.split("_")[0];
      const shortName = name.replace(/^\d+_/, "").replace(/\.sql$/, "");
      await sql(
        `INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES(${lit(version)},${lit(shortName)}) ON CONFLICT(version) DO NOTHING;`,
      );
    };
    const installSql = async (body, name) => {
      try {
        await sql(wrapMigrationTransaction(body));
        await recordHistory(name);
      } catch (error) {
        throw Error(`MIGRATION_FAILED ${name}: ${error.message}`);
      }
      count++;
    };

    /** Disposable-only: exact paymob review predecessor for billing_live_owner (no stubs). */
    const installPaymobLiveOwnerPredecessor = async () => {
      if (paymobPredecessor) return paymobPredecessor;
      const dependency = nativeBillingOwner();
      const budgetPath = "supabase/upgrade-packages/ai-runtime-compatibility/20-budget-binding.review.sql";
      const budgetBytes = readFileSync(budgetPath);
      const budgetSha256 = createHash("sha256").update(budgetBytes).digest("hex");
      if (budgetSha256 !== "2240fe6e6b7baedf7e67881bd588322879adfedd0e48ca43f705f00d754a71c0") {
        throw Error("NATIVE_BUDGET_POLICY_PROVENANCE_CHANGED");
      }
      const budgetSource = lf(budgetBytes.toString("utf8"));
      const budgetStart = budgetSource.indexOf("create table private.ai_plan_budget_policies (");
      const budgetEnd = budgetSource.indexOf("alter table public.ai_budget_accounts", budgetStart);
      if (budgetStart < 0 || budgetEnd <= budgetStart) throw Error("NATIVE_BUDGET_POLICY_LAYOUT_CHANGED");
      if ((await sql(`select to_regprocedure('private.billing_live_owner(uuid,uuid,uuid)') is null`)) !== "t") {
        throw Error("BILLING_LIVE_OWNER_ALREADY_PRESENT");
      }
      for (const table of [
        "billing_live_merchant_contracts",
        "billing_live_order_bindings",
        "billing_live_checkouts",
      ]) {
        if ((await sql(`select to_regclass('private.${table}') is null`)) !== "t") {
          throw Error(`BILLING_LIVE_RELATION_ALREADY_PRESENT:${table}`);
        }
      }
      await sql(`begin;set local role postgres;${budgetSource.slice(budgetStart, budgetEnd)}${dependency.relationSql}${dependency.sql}
   alter function private.billing_live_owner(uuid,uuid,uuid) owner to postgres;
   revoke all on function private.billing_live_owner(uuid,uuid,uuid) from public,anon,authenticated,service_role;commit;`);
      if ((await sql(`select private.billing_live_owner(gen_random_uuid(),gen_random_uuid(),gen_random_uuid())`)) !== "f") {
        throw Error("BILLING_LIVE_OWNER_BODY_UNEXPECTED");
      }
      paymobPredecessor = {
        path: dependency.path,
        sourceSha256: dependency.sourceSha256,
        budgetPath,
        budgetSha256,
        installedBefore: "20261014033008_master_autorenew_wallet.sql",
        financialRowsSeeded: false,
        fullCheckoutPackageInstalled: false,
        paymentCalls: false,
      };
      return paymobPredecessor;
    };

    for (const name of readdirSync(resolve("supabase/migrations")).filter((n) => n.endsWith(".sql")).sort()) {
      if (throughMigration && name > throughMigration) continue;
      if (skipMigrations.includes(name)) {
        skipped.push(name);
        continue;
      }
      if (name === "20261007230212_vel_platform_owner_identity.sql") {
        const migration = lf(readFileSync(resolve("supabase/migrations", name), "utf8"));
        const address = migration.match(/lower\(u.email\)='([^']+)'/)?.[1];
        if (!address) throw Error("OWNER_PRECONDITION_CHANGED");
        await sql(
          `INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(md5('g03-synthetic-platform-owner')::uuid,${lit(address)},now()); INSERT INTO public.platform_admins(user_id,role,status) VALUES(md5('g03-synthetic-platform-owner')::uuid,'owner','active');`,
        );
      }
      if (name === "20261014033008_master_autorenew_wallet.sql") {
        await installPaymobLiveOwnerPredecessor();
      }
      try {
        if (name === "20261014080108_smart_setup_foundation.sql") {
          // Historical alternative: company_branches already exists from enterprise.
          const compat = branchCompatibility();
          await installSql(compat.sql, name);
          continue;
        }
        if (name === "20261014080217_smart_review_native_scope.sql") {
          reviewFamilyEquivalence();
          if (!reviewSnapshot) throw Error("REVIEW_FAMILY_SNAPSHOT_MISSING");
          const catalog = await sql(reviewCatalogSql);
          if (catalog !== reviewSnapshot) throw Error("REVIEW_FAMILY_NATIVE_DRIFT");
          skipped.push(`${name}:composition_skip_duplicate_family`);
          await recordHistory(name);
          count++;
          continue;
        }
        if (name === "20261022093000_es02_trial_session_history.sql") {
          const history = embeddedTrialHistory();
          await sql(`begin;set local role postgres;${history.guard}commit;`);
          skipped.push(`${name}:embedded_guard_only`);
          await recordHistory(name);
          count++;
          continue;
        }
        await file(`supabase/migrations/${name}`, { transactionalMigration: true });
        await recordHistory(name);
        if (name === "20261014040120_smart_channel_independent_review.sql") {
          reviewFamilyEquivalence();
          reviewSnapshot = await sql(reviewCatalogSql);
        }
      } catch (error) {
        if (String(error?.message ?? error).startsWith("MIGRATION_FAILED ")) throw error;
        throw Error(`MIGRATION_FAILED ${name}: ${error.message}`);
      }
      count++;
    }
    return { count, skipped, paymobPredecessor };
  }
  async function close() {
    await verify();
    await exec("docker", ["rm", "-f", container]);
  }
  return { container, sql, file, session, bootstrap, close, verify };
}
