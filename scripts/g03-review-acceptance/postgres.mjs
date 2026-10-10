// Opt-in only. No URL, .env, cloud client, published ports or persistent volume.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const rawExec = promisify(execFile);
const exec = (file,args) => rawExec(file,args,{timeout:15_000,windowsHide:true,maxBuffer:4*1024*1024});
export const lit = value => `'${String(value).replaceAll("'", "''")}'`;
const IMAGE = "supabase/postgres:17.6.1.136";
const TASK = "g03-verified-review";

export async function isolatedPostgres() {
  const run = randomUUID();
  const container = `velora-g03-${run.slice(0, 8)}`;
  const context = JSON.parse((await exec("docker", ["context", "inspect"])).stdout)[0];
  const endpoint = context?.Endpoints?.docker?.Host ?? "";
  if (!/^(npipe:\/\/|unix:\/\/)/.test(endpoint)) throw Error("NON_LOCAL_DOCKER");
  await exec("docker", ["image", "inspect", IMAGE]);
  await rawExec("docker", ["run", "--pull=never", "-d", "--name", container,
    "--label", `velora.task=${TASK}`, "--label", `velora.run=${run}`,
    "--network", "none", "--tmpfs", "/var/lib/postgresql/data:rw,size=1073741824",
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust", IMAGE],{timeout:30000,windowsHide:true,maxBuffer:4*1024*1024});

  async function verify() {
    const c = JSON.parse((await exec("docker", ["inspect", container])).stdout)[0];
    if (c.Config.Labels?.["velora.task"] !== TASK || c.Config.Labels?.["velora.run"] !== run
      || c.Config.Image !== IMAGE || c.HostConfig.NetworkMode !== "none"
      || !c.HostConfig.Tmpfs?.["/var/lib/postgresql/data"]
      || Object.keys(c.HostConfig.PortBindings ?? {}).length
      || c.Mounts.some(m => m.Type !== "tmpfs")) throw Error("UNSAFE_DATABASE_TARGET");
  }
  function session(query, name = "g03-test", { keepOpen = false } = {}) {
    const child = spawn("docker", ["exec", "-i", "-u", "postgres", container,
      "psql", "-X", "-U", "supabase_admin", "-d", "g03_review", "-Atq", "-v", "ON_ERROR_STOP=1"],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    const done = new Promise((ok, fail) => {
      const timer=setTimeout(()=>{ child.kill();fail(Error('LOCAL_PSQL_PROCESS_TIMEOUT')); },60_000);
      child.on("error", fail);
      child.on("close", code => {clearTimeout(timer);if(code===0)ok(stdout.trim());else fail(Error(stderr || `psql ${code}`));});
    });
    const input = `SET application_name=${lit(name)};\nSET statement_timeout='15s';\nSET lock_timeout='10s';\n${query}\n`;
    if (keepOpen) child.stdin.write(input); else child.stdin.end(input);
    return { child, done, output: () => stdout };
  }
  async function sql(query, name) { await verify(); return session(query, name).done; }
  async function file(path) { return sql(readFileSync(resolve(path), "utf8").replace(/^\uFEFF/, "")); }
  async function bootstrap({ omitG03 = false, beforeG03, baselineMetadataPath, upgradePackagePath, containmentPackagePath, throughMigration } = {}) {
    await verify();
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const logs = await exec("docker", ["logs", container]);
        if (!(logs.stdout + logs.stderr).includes("init process complete")) throw Error("INITIALIZING");
        await exec("docker", ["exec", "-u", "postgres", container, "pg_isready", "-U", "supabase_admin"]); break;
      }
      catch { if (attempt === 59) throw Error("POSTGRES_NOT_READY"); await new Promise(r => setTimeout(r, 500)); }
    }
    await exec("docker", ["exec", "-u", "postgres", container, "createdb", "-U", "supabase_admin", "g03_review"]);
    if (baselineMetadataPath) {
      const { loadMetadata, renderSchema } = await import('../g03-cloud-upgrade/schema-replay.mjs');
      // Verified read-only cloud pg_database owner; preserves implicit
      // pg_database_owner membership instead of inventing a schema CREATE grant.
      await sql('ALTER DATABASE g03_review OWNER TO postgres;');
      await sql(renderSchema(loadMetadata(baselineMetadataPath)));
      // Synthetic control rows, never cloud/customer row exports.
      const ownerMigration=readFileSync(resolve('supabase/migrations/20261007230212_vel_platform_owner_identity.sql'),'utf8');
      const address=ownerMigration.match(/lower\(u.email\)='([^']+)'/)?.[1];
      if(!address)throw Error('OWNER_PRECONDITION_CHANGED');
      await sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(md5('g03-synthetic-platform-owner')::uuid,${lit(address)},now());
        INSERT INTO public.platform_admins(user_id,role,status) VALUES(md5('g03-synthetic-platform-owner')::uuid,'owner','active');
        INSERT INTO private.app_session_settings(singleton,enabled) VALUES(true,false);
        INSERT INTO storage.buckets(id,name,public) VALUES('company-knowledge','company-knowledge',false);`);
      if(beforeG03)await beforeG03();
      if(containmentPackagePath)await file(containmentPackagePath);
      if(upgradePackagePath)await file(upgradePackagePath);
      return 'actual metadata baseline + bounded package';
    }
    await file("scripts/whatsapp-integration/dependency-stubs.sql");
    let count = 0;
    for (const name of readdirSync(resolve("supabase/migrations")).filter(n => n.endsWith(".sql")).sort()) {
      if (throughMigration && name > throughMigration) continue;
      if (omitG03 && name.endsWith("_g03_verified_review.sql")) continue;
      if (name.endsWith("_g03_verified_review.sql") && beforeG03) await beforeG03();
      if (name === "20261007230212_vel_platform_owner_identity.sql") {
        const migration = readFileSync(resolve("supabase/migrations", name), "utf8");
        const address = migration.match(/lower\(u.email\)='([^']+)'/)?.[1];
        if (!address) throw Error("OWNER_PRECONDITION_CHANGED");
        await sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(md5('g03-synthetic-platform-owner')::uuid,${lit(address)},now()); INSERT INTO public.platform_admins(user_id,role,status) VALUES(md5('g03-synthetic-platform-owner')::uuid,'owner','active');`);
      }
      try { await file(`supabase/migrations/${name}`); }
      catch (error) { throw Error(`MIGRATION_FAILED ${name}: ${error.message}`); }
      count++;
    }
    return count;
  }
  async function close() { await verify(); await exec("docker", ["rm", "-f", container]); }
  return { container, sql, file, session, bootstrap, close, verify };
}
