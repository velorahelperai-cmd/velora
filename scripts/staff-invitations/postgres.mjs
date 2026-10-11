import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const exec = promisify(execFile);
const container = "velora-staff-invitations-local";
const database = `staff_invitations_fixture_${randomBytes(6).toString("hex")}`;
let verifiedContainerId;
export const lit = value => `'${String(value).replaceAll("'", "''")}'`;

export async function verify() {
  if (verifiedContainerId) return;
  const { stdout } = await exec("docker", ["inspect", container]);
  const c = JSON.parse(stdout)[0];
  if (c.Config.Image !== "postgres:17.6-alpine" || c.Config.Labels?.["velora.task"] !== "staff-invitations"
    || c.HostConfig.NetworkMode !== "none" || c.HostConfig.LogConfig.Type !== "none"
    || Object.keys(c.HostConfig.PortBindings ?? {}).length || !c.HostConfig.Tmpfs?.["/var/lib/postgresql/data"]
    || c.Mounts.some(m => m.Type !== "tmpfs")) throw Error("UNSAFE_STAFF_INVITATION_TEST_TARGET");
  verifiedContainerId = c.Id;
}

export function session(query, { keepOpen = false, db = database } = {}) {
  if (!verifiedContainerId) throw Error("STAFF_INVITATION_TEST_TARGET_NOT_VERIFIED");
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
function extractExact(source,start,end) {
  const beginning=source.indexOf(start), ending=source.indexOf(end,beginning+start.length);
  if(beginning<0||ending<0||source.indexOf(start,beginning+start.length)>=0) throw Error("G03_FIXTURE_SOURCE_MARKERS_CHANGED");
  return source.slice(beginning,ending+end.length);
}
export async function bootstrap() {
  await verify();
  await session(`create database ${database}`, { db: "postgres" }).done;
  await file("scripts/staff-invitations/bootstrap.sql");
  // Execute exact production membership-trigger dependency, not a substitute.
  // Fixed source markers fail closed if the reviewed source structure changes.
  const g03=readFileSync("supabase/migrations/20261009215520_g03_verified_review.sql","utf8");
  await sql([
    extractExact(g03,"create table private.g03_company_inputs (","\n);"),
    "revoke all on private.g03_company_inputs from public,anon,authenticated,service_role;",
    extractExact(g03,"create function private.g03_bump_inputs() returns trigger","end; $$;"),
    extractExact(g03,"create trigger g03_owner_input_epoch after insert or update or delete on public.company_members","for each row execute function private.g03_bump_inputs();"),
    "revoke all on function private.g03_bump_inputs() from public,anon,authenticated,service_role;",
  ].join("\n"));
  await file("supabase/migrations/20261008010000_vel_session_idle_policy.sql");
  await file("supabase/migrations/20261008070000_vel_staff_invitations.sql");
  await sql("update private.app_session_settings set enabled=true");
}
export async function cleanup() {
  if (verifiedContainerId) await session(`drop database if exists ${database} with (force)`, { db: "postgres" }).done;
}
