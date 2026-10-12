import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const exec = promisify(execFile);
const container = "velora-ig-store-local";
const database = `instagram_store_fixture_${randomBytes(6).toString("hex")}`;
let verifiedContainerId;
export const lit = value => `'${String(value).replaceAll("'", "''")}'`;

export async function verify() {
  if (verifiedContainerId) return;
  const { stdout } = await exec("docker", ["inspect", container]);
  const c = JSON.parse(stdout)[0];
  if (c.Config.Image !== "postgres:17.6-alpine" || c.Config.Labels?.["velora.task"] !== "instagram-store"
    || c.HostConfig.NetworkMode !== "none" || c.HostConfig.LogConfig.Type !== "none"
    || Object.keys(c.HostConfig.PortBindings ?? {}).length || !c.HostConfig.Tmpfs?.["/var/lib/postgresql/data"]
    || c.Mounts.some(m => m.Type !== "tmpfs")) throw Error("UNSAFE_INSTAGRAM_STORE_TEST_TARGET");
  verifiedContainerId = c.Id;
}

export function session(query, { keepOpen = false, db = database } = {}) {
  if (!verifiedContainerId) throw Error("INSTAGRAM_STORE_TEST_TARGET_NOT_VERIFIED");
  const child = spawn("docker", ["exec", "-i", "-u", "postgres", verifiedContainerId, "psql", "-X", "-U", "postgres", "-d", db, "-Atq", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", data => stdout += data);
  child.stderr.on("data", data => stderr += data);
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(stdout.trim()) : reject(Error(stderr || `psql ${code}`)));
  });
  const input = `set statement_timeout='15s';set lock_timeout='10s';${query}\n`;
  if (keepOpen) child.stdin.write(input); else child.stdin.end(input);
  return { child, done, output: () => stdout };
}

export async function sql(query) { await verify(); return session(query).done; }
export async function file(path) { return sql(readFileSync(path, "utf8")); }
export async function bootstrap(migration) {
 await verify();
 await session(`create database ${database}`, {db:"postgres"}).done;
 await file("scripts/instagram-connection/bootstrap.sql");
 await file("supabase/migrations/20261008010000_vel_session_idle_policy.sql");
 await file(migration);
}
export async function cleanup() {
 if(verifiedContainerId) await session(`drop database if exists ${database} with (force)`,{db:"postgres"}).done;
}

// This installs only a labelled SQL contract DOUBLE inside the verified disposable
// fixture container. It is NOT Supabase Vault or cryptographic/key-isolation proof.
export async function installVaultContractFixture() {
 await verify();
 const {stdout}=await exec("docker",["exec",verifiedContainerId,"pg_config","--sharedir"]);
 const dir=stdout.trim()+"/extension/";
 const ctl="comment = 'Velora synthetic Vault contract fixture — NOT actual Vault'\ndefault_version = '0.0.0-fixture'\nrelocatable = false\nschema = vault\n";
 const body=readFileSync("scripts/instagram-connection/vault-contract-fixture.sql","utf8");
 for(const [name,value] of [["supabase_vault.control",ctl],["supabase_vault--0.0.0-fixture.sql",body]]) {
  await new Promise((resolve,reject)=>{
   const child=spawn("docker",["exec","-i","-u","0",verifiedContainerId,"sh","-c",'cat > "$1"',"sh",dir+name],{stdio:["pipe","ignore","pipe"]});
   child.on("error",reject);child.on("close",code=>code===0?resolve():reject(Error("FIXTURE_INSTALL_FAILED")));child.stdin.end(value);
  });
 }
 await sql("create extension supabase_vault");
}
