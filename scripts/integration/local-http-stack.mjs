// TEST ONLY. Real local GoTrue and PostgREST; project SQL/ACL/RLS remain unmodified.
// Nothing reads project environment files, starts Next, or contacts a provider.
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Agent, createServer, request as httpRequest } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { confirmationEnvironment, CONFIRMATION_SQL } from "./local-auth-confirmation.mjs";

export const NETWORK = "velora-c1-ui-e2e";
export const TASK_LABEL = "c1-ui-http";
export const IMAGES = Object.freeze({
  postgres: "supabase/postgres:17.6.1.136",
  auth: "supabase/gotrue:v2.196.0",
  // Official Supabase docker composition, verified 2026-10-08.
  rest: "postgrest/postgrest:v14.17",
});
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DB = "c1_ui_integration";
const PGDATA = "/var/lib/postgresql/data";
const OWNER_MIGRATION = "20261007230212_vel_platform_owner_identity.sql";
const delay = ms => new Promise(ok => setTimeout(ok, ms));
export const lit = value => `'${String(value).replaceAll("'", "''")}'`;

// The Docker client inherits only its ordinary OS runtime paths, never provider keys.
function localProcessEnvironment() {
  const env = {};
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "SystemDrive", "COMSPEC", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "DOCKER_CONFIG"])
    if (process.env[name] !== undefined) env[name] = process.env[name];
  return env;
}

function localOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw Error("LOCAL_HTTP_ORIGIN_REQUIRED");
  return url.origin;
}

function port(value) {
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw Error("INVALID_LOCAL_PORT");
  return value;
}

function sign(secret, role, issuer) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role, iss: issuer, iat: now, exp: now + 86400 })).toString("base64url");
  const body = `${header}.${payload}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

const DEPENDENCIES = `
-- Reduced local platform dependencies. GoTrue already owns its real Auth tables.
create schema if not exists extensions;
-- Supabase CLI installation history, required by deterministic historical installers.
create schema if not exists supabase_migrations authorization postgres;
create table if not exists supabase_migrations.schema_migrations(
 version text primary key,statements text[],name text,created_by text,idempotency_key text unique,rollback text[]
);
alter table supabase_migrations.schema_migrations owner to postgres;
revoke all on schema supabase_migrations from public,anon,authenticated;
revoke all on supabase_migrations.schema_migrations from public,anon,authenticated;
create extension if not exists pgcrypto with schema extensions;
create schema storage;
grant usage on schema public,auth,storage,extensions to anon,authenticated,service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
create or replace function auth.uid() returns uuid language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub',nullif(current_setting('request.jwt.claim.sub',true),''))::uuid
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)
$$;
create or replace function auth.role() returns text language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',nullif(current_setting('request.jwt.claim.role',true),''))
$$;
create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid,owner_id text,metadata jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
grant all on storage.buckets,storage.objects to service_role;
`;

/** Start one isolated real local backend. All credentials are returned only in memory. */
export async function startStack({ gatewayPort = 3130, authPort = 3140, restPort = 3141, appOrigin = "http://127.0.0.1:3120", progress = () => {}, throughMigration, canonicalSqlLineEndings = false, databasePort, databaseOnly = false, migrationScope = "full", verifyAcceptedUsageUpgrade = false, emailConfirmation = false, reuseUpstreamConnections = false, nativeStoragePort } = {}) {
  if (typeof reuseUpstreamConnections !== "boolean") throw Error("LOCAL_UPSTREAM_REUSE_BOOLEAN_REQUIRED");
  const mailEnvironment = confirmationEnvironment(emailConfirmation);
  if (!["full", "wp01a-auth"].includes(migrationScope)) throw Error("LOCAL_MIGRATION_SCOPE_INVALID");
  gatewayPort = port(gatewayPort); authPort = port(authPort); restPort = port(restPort);
  if(databasePort !== undefined){databasePort=port(databasePort);if([gatewayPort,authPort,restPort].includes(databasePort))throw Error("STACK_PORTS_MUST_DIFFER");}
  if (new Set([gatewayPort, authPort, restPort]).size !== 3) throw Error("STACK_PORTS_MUST_DIFFER");
  if(nativeStoragePort!==undefined)nativeStoragePort=port(nativeStoragePort);
  appOrigin = localOrigin(appOrigin);
  const url = `http://127.0.0.1:${gatewayPort}`;
  const runId = randomUUID();
  const suffix = runId.slice(0, 8);
  const networkName = `${NETWORK}-${suffix}`;
  const names = Object.fromEntries(["postgres", "auth", "rest", ...(nativeStoragePort===undefined?[]:["storage"])].map(key => [key, `velora-c1-ui-${key}-${suffix}`]));
  const jwtSecret = randomBytes(48).toString("base64url");
  const databasePassword = randomBytes(36).toString("hex");
  const anonKey = sign(jwtSecret, "anon", `${url}/auth/v1`);
  const serviceRoleKey = sign(jwtSecret, "service_role", `${url}/auth/v1`);
  const secrets = new Set([jwtSecret, databasePassword, anonKey, serviceRoleKey]);
  const created = new Set();
  const attached = new Map();
  const ingress = new Map();
  // Reuse bounded loopback channels instead of spawning Docker exec for every
  // SSR request. Credentials remain request headers, never connection state.
  const upstreamAgents = reuseUpstreamConnections ? {auth:new Agent({keepAlive:true,maxSockets:2,maxFreeSockets:2}),rest:new Agent({keepAlive:true,maxSockets:2,maxFreeSockets:2})} : null;
  let networkCreated = false, gateway, closed = false;
  const redact = value => {
    let result = String(value);
    for (const secret of secrets) result = result.replaceAll(secret, "[LOCAL_CREDENTIAL_REDACTED]");
    return result.replace(/([?&](?:code|token|token_hash|vel_intent|state)=)[^&\s"]+/gi, "$1[LOCAL_AUTH_QUERY_REDACTED]").replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[LOCAL_JWT_REDACTED]").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[LOCAL_EMAIL_REDACTED]");
  };
  async function docker(args, { input, env = {}, timeout = 30_000 } = {}) {
    return new Promise((ok, fail) => {
      const child = spawn("docker", args, { env: { ...localProcessEnvironment(), ...env }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "", finished = false;
      const timer = setTimeout(() => { child.kill(); finish(Error("LOCAL_DOCKER_TIMEOUT")); }, timeout);
      const finish = error => {
        if (finished) return;
        finished = true; clearTimeout(timer);
        if (error) fail(Error(redact(error.message))); else ok(stdout.trim());
      };
      child.stdout.on("data", value => stdout += value);
      child.stderr.on("data", value => stderr += value);
      child.on("error", error => finish(error));
      child.on("close", code => finish(code === 0 ? undefined : Error(stderr || `LOCAL_DOCKER_EXIT_${code}`)));
      child.stdin.on("error", () => {});
      child.stdin.end(input ?? "");
    });
  }
  async function verifyNetwork() {
    const [network] = JSON.parse(await docker(["network", "inspect", networkName]));
    if (!network.Internal || network.Labels?.["velora.task"] !== TASK_LABEL || network.Labels?.["velora.run"] !== runId)
      throw Error("UNSAFE_LOCAL_NETWORK_TARGET");
    return network;
  }
  async function verifyContainer(kind) {
    await verifyNetwork();
    const [container] = JSON.parse(await docker(["inspect", names[kind]]));
    const ports = container.HostConfig.PortBindings ?? {};
    const expectedPort = kind === "auth" ? ["9999/tcp", authPort] : kind === "storage" ? ["5000/tcp", nativeStoragePort] : ["3000/tcp", restPort];
    const validPorts = kind === "postgres" ? Object.keys(ports).length === 0 :
      Object.keys(ports).length === 1 && ports[expectedPort[0]]?.length === 1 && ports[expectedPort[0]][0].HostIp === "127.0.0.1" && ports[expectedPort[0]][0].HostPort === String(expectedPort[1]);
    if (container.Config.Image !== (kind==="storage"?"supabase/storage-api:v1.81.0":IMAGES[kind]) || container.Config.Labels?.["velora.task"] !== TASK_LABEL || container.Config.Labels?.["velora.run"] !== runId ||
      container.HostConfig.NetworkMode !== networkName || Object.keys(container.NetworkSettings.Networks).some(name => name !== networkName) || !validPorts ||
      container.Mounts.some(mount => mount.Type !== "tmpfs") || (kind === "postgres" && (!container.HostConfig.Tmpfs?.[PGDATA] || !/size=1g/.test(container.HostConfig.Tmpfs[PGDATA]))))
      throw Error("UNSAFE_LOCAL_CONTAINER_TARGET");
    return container;
  }
  async function verify() {
    for (const kind of created) await verifyContainer(kind);
    for (const server of ingress.values())
      if (server.address()?.address !== "127.0.0.1") throw Error("UNSAFE_LOCAL_INGRESS_BINDING");
    return { network: networkName, internal: true, database: DB, containers: [...created].length, hostDatabasePorts: 0, persistentVolumes: 0 };
  }
  async function sql(query) {
    if (closed) throw Error("LOCAL_STACK_CLOSED");
    await verifyContainer("postgres");
    return docker(["exec", "-i", "-u", "postgres", names.postgres, "psql", "-X", "-U", "supabase_admin", "-d", DB, "-Atq", "-v", "ON_ERROR_STOP=1"], { input: `SET application_name='velora_c1_ui_http';\n${query}\n` });
  }
  async function rows(query) {
    return JSON.parse(await sql(`SELECT coalesce(jsonb_agg(q),'[]'::jsonb) FROM (${query}) q;`));
  }
  async function close() {
    if (closed) return;
    // Refuse cleanup if another actor changed the target's isolation or identity.
    if (gateway) {
      gateway.closeAllConnections();
      await new Promise(ok => gateway.close(ok));
    }
    for (const agent of Object.values(upstreamAgents??{})) agent.destroy();
    for (const server of ingress.values()) {
      for (const socket of server.localSockets) socket.destroy();
      await new Promise(ok => server.close(ok));
    }
    ingress.clear();
    for (const kind of [...created].reverse()) {
      await verifyContainer(kind);
      await docker(["rm", "--force", names[kind]]);
      created.delete(kind);
    }
    if (networkCreated) {
      const network = await verifyNetwork();
      if (Object.keys(network.Containers ?? {}).length) throw Error("LOCAL_NETWORK_HAS_UNOWNED_CONTAINERS");
      await docker(["network", "rm", networkName]);
      networkCreated = false;
    }
    closed = true;
  }
  async function waitFor(name, operation, timeout = 60_000) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try { if (await operation()) return; } catch (error) { if (error.fatal) throw error; last = error; }
      await delay(400);
    }
    throw Error(`${name}_NOT_READY${last ? `: ${redact(last.message)}` : ""}`);
  }
  async function runContainer(kind, environment, extra = []) {
    const args = [["auth","storage"].includes(kind) ? "create" : "run", ...(["auth","storage"].includes(kind) ? [] : ["--detach"]), "--pull=never", "--name", names[kind], "--label", `velora.task=${TASK_LABEL}`, "--label", `velora.run=${runId}`, "--network", networkName,
      "--memory", kind === "postgres" ? "1536m" : "384m", "--cpus", "1", "--pids-limit", "256", "--log-driver", "none", ...extra];
    for (const name of Object.keys(environment)) args.push("--env", name);
    args.push(kind==="storage"?"supabase/storage-api:v1.81.0":IMAGES[kind]);
    // Disposable fixture only: install real Cron in its isolated database,
    // but never launch scheduled background jobs during deterministic tests.
    if (kind === "postgres") args.push("postgres", "-D", "/etc/postgresql", "-c", `cron.database_name=${DB}`, "-c", "cron.launch_active_jobs=off");
    if (kind === "postgres" && migrationScope === "wp01a-auth") args.push("-c", "shared_buffers=32MB", "-c", "max_connections=48", "-c", "work_mem=1MB", "-c", "maintenance_work_mem=16MB");
    await docker(args, { env: environment, timeout: 60_000 });
    created.add(kind);
    await verifyContainer(kind);
    if (["auth","storage"].includes(kind)) {
      // Capture startup diagnostics only in memory; Docker has no persistent logs.
      const state = { output: "", exited: false, code: null };
      const child = spawn("docker", ["start", "--attach", names[kind]], { env: localProcessEnvironment(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      for (const stream of [child.stdout, child.stderr]) stream.on("data", value => { state.output = (state.output + value).slice(-65536); });
      child.on("close", code => { state.exited = true; state.code = code; });
      child.on("error", error => { state.output = redact(error.message); state.exited = true; });
      attached.set(kind, state);
      // `docker create` has no actual port bindings yet. Do not install a
      // fallback ingress until `docker start --attach` has finished starting:
      // an early listener can steal the port Docker is about to bind.
      await waitFor("LOCAL_AUTH_CONTAINER", async () => {
        if (state.exited) throw Object.assign(Error(`LOCAL_AUTH_EXITED:${state.code}:${redact(state.output)}`), { fatal: true });
        return (await verifyContainer(kind)).State.Running;
      });
    }
  }
  async function localIngress(kind, hostPort, containerPort) {
    const container = await verifyContainer(kind);
    const published = container.NetworkSettings.Ports?.[`${containerPort}/tcp`] ?? [];
    if (published.length) {
      if (published.length !== 1 || published[0].HostIp !== "127.0.0.1" || published[0].HostPort !== String(hostPort)) throw Error("UNSAFE_ACTUAL_HOST_BINDING");
      return;
    }
    // Docker Desktop disables host publishing on internal networks. A loopback
    // TCP ingress uses Docker exec's stdin/stdout to reach the real service via
    // nc in our own PostgreSQL container. No egress-capable network is added.
    const server = createTcpServer(socket => {
      server.localSockets.add(socket);
      const child = spawn("docker", ["exec", "-i", names.postgres, "nc", "-w", "20", names[kind], String(containerPort)], { env: localProcessEnvironment(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      socket.setTimeout(25_000, () => socket.destroy());
      child.stderr.on("data", () => {});
      child.stdin.on("error", () => socket.destroy());
      child.stdout.on("error", () => socket.destroy());
      child.on("error", () => socket.destroy());
      child.on("close", () => { if (!socket.destroyed) socket.end(); });
      socket.on("error", () => {});
      socket.once("close", () => { server.localSockets.delete(socket); child.stdin.end(); child.kill(); });
      socket.pipe(child.stdin); child.stdout.pipe(socket);
    });
    server.localSockets = new Set();
    await new Promise((ok, fail) => { server.once("error", fail); server.listen(hostPort, "127.0.0.1", ok); });
    ingress.set(kind, server);
    progress(`LOCAL_INTERNAL_TCP_INGRESS_READY:${kind}`);
  }
  async function authRequest(path, body, accessToken = serviceRoleKey) {
    const response = await fetch(`http://127.0.0.1:${authPort}${path}`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Connection: "close" }, body: JSON.stringify(body) });
    if (!response.ok) throw Error(`LOCAL_AUTH_REQUEST_${response.status}: ${redact(await response.text())}`);
    return response.json();
  }
  async function adminCreateUser({ email = `c1-${randomUUID()}@example.test`, password = `${randomBytes(24).toString("base64url")}aA7!`, userMetadata = {} } = {}) {
    await verifyContainer("auth");
    secrets.add(email); secrets.add(password);
    const user = await authRequest("/admin/users", { email, password, email_confirm: true, user_metadata: userMetadata });
    return { id: user.id, email, password, user };
  }
  async function readEmailOtp(email) {
    if (!emailConfirmation || typeof email !== "string" || !/@example\.(invalid|test)$/.test(email)) throw Error("LOCAL_SYNTHETIC_CONFIRMATION_REQUIRED");
    const [mail] = await rows(`select token from local_auth_fixture.email_events where email=${lit(email.toLowerCase())} order by created_at desc limit 1`);
    if (!mail || !/^[0-9]{6}$/.test(mail.token)) throw Error("LOCAL_CONFIRMATION_MAIL_MISSING");
    secrets.add(mail.token);
    return mail.token;
  }
  async function readEmailRecoveryLink(email) {
    if (!emailConfirmation || typeof email !== "string" || !/@example\.(invalid|test)$/.test(email)) throw Error("LOCAL_SYNTHETIC_CONFIRMATION_REQUIRED");
    const [mail] = await rows(`select token_hash,redirect_to from local_auth_fixture.email_events where email=${lit(email.toLowerCase())} and action_type='recovery' order by created_at desc limit 1`);
    if (!mail || typeof mail.token_hash!=="string" || !/^(?:pkce_)?[a-f0-9]{32,128}$/.test(mail.token_hash)) throw Error("LOCAL_RECOVERY_MAIL_MISSING");
    const redirect=new URL(mail.redirect_to);if(redirect.origin!==appOrigin || redirect.pathname!=="/auth/callback" || !redirect.searchParams.get("vel_intent"))throw Error("LOCAL_RECOVERY_REDIRECT_UNBOUND");
    secrets.add(mail.token_hash);const link=new URL(url+"/auth/v1/verify");link.searchParams.set("token",mail.token_hash);link.searchParams.set("type","recovery");link.searchParams.set("redirect_to",redirect.href);secrets.add(link.href);return link.href;
  }
  const gatewayHandler=createLocalGatewayHandler({gatewayPort,appOrigin,url,anonKey,serviceRoleKey,authPort,restPort,reuseUpstreamConnections,upstreamAgents});

  try {
    const context = JSON.parse(await docker(["context", "inspect"]))[0];
    if (!/^(npipe:\/\/|unix:\/\/)/.test(context.Endpoints?.docker?.Host ?? "")) throw Error("LOCAL_DOCKER_ENDPOINT_REQUIRED");
    for (const image of Object.values(IMAGES)) await docker(["image", "inspect", image]);
    const existingNetworks = (await docker(["network", "ls", "--format", "{{.Name}}"])).split(/\r?\n/);
    if (existingNetworks.includes(networkName)) throw Error("LOCAL_STACK_NETWORK_ALREADY_EXISTS");
    await docker(["network", "create", "--internal", "--label", `velora.task=${TASK_LABEL}`, "--label", `velora.run=${runId}`, networkName]);
    networkCreated = true;
    await runContainer("postgres", { POSTGRES_PASSWORD: databasePassword, POSTGRES_DB: "postgres", PGDATA }, ["--tmpfs", `${PGDATA}:rw,size=1g`]);
    await waitFor("LOCAL_DATABASE", async () => {
      await docker(["exec", "-u", "postgres", names.postgres, "pg_isready", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", "postgres"]);
      return true;
    });
    await docker(["exec", "-i", "-u", "postgres", names.postgres, "psql", "-X", "-U", "supabase_admin", "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1"], { input: `CREATE DATABASE ${DB} OWNER postgres;\nALTER ROLE supabase_admin WITH LOGIN PASSWORD ${lit(databasePassword)};\nALTER ROLE supabase_auth_admin WITH LOGIN PASSWORD ${lit(databasePassword)};\nALTER ROLE authenticator WITH LOGIN PASSWORD ${lit(databasePassword)};\nGRANT anon,authenticated,service_role TO authenticator;\nGRANT supabase_auth_admin TO postgres;\n` });
    await sql("CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;");
    if (emailConfirmation) await sql(CONFIRMATION_SQL);
    if(databasePort !== undefined)await localIngress("postgres",databasePort,5432);
    const [cronSettings] = await rows("select current_setting('cron.database_name') as database, current_setting('cron.launch_active_jobs') as launch");
    if (cronSettings.database !== DB || cronSettings.launch !== "off") throw Error("LOCAL_CRON_ISOLATION_REQUIRED");
    progress("LOCAL_CRON_DISABLED_AND_DATABASE_BOUND");
    progress("LOCAL_DATABASE_READY");
    await runContainer("auth", {
      GOTRUE_API_HOST: "0.0.0.0", GOTRUE_API_PORT: "9999", API_EXTERNAL_URL: `${url}/auth/v1`,
      GOTRUE_DB_DRIVER: "postgres", GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${databasePassword}@${names.postgres}:5432/${DB}`,
      GOTRUE_SITE_URL: appOrigin, GOTRUE_URI_ALLOW_LIST: `${appOrigin}/**`, GOTRUE_DISABLE_SIGNUP: "false",
      GOTRUE_JWT_ADMIN_ROLES: "service_role", GOTRUE_JWT_AUD: "authenticated", GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated", GOTRUE_JWT_EXP: "3600", GOTRUE_JWT_SECRET: jwtSecret,
      GOTRUE_JWT_ISSUER: `${url}/auth/v1`, GOTRUE_EXTERNAL_EMAIL_ENABLED: "true", ...mailEnvironment,
      GOTRUE_EXTERNAL_PHONE_ENABLED: "false", GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: "false", GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: "true",
      GOTRUE_LOG_LEVEL: "error", LOG_LEVEL: "error", GOTRUE_METRICS_ENABLED: "false", GOTRUE_TRACING_ENABLED: "false",
    }, ["--publish", `127.0.0.1:${authPort}:9999`]);
    await localIngress("auth", authPort, 9999);
    await waitFor("LOCAL_AUTH", async () => {
      const state = attached.get("auth");
      if (state?.exited) throw Object.assign(Error(`LOCAL_AUTH_EXITED:${state.code}:${redact(state.output)}`), { fatal: true });
      return (await fetch(`http://127.0.0.1:${authPort}/health`, { headers: { Connection: "close" }, signal: AbortSignal.timeout(3000), redirect: "error" })).ok;
    });
    const authTables = await rows("select table_name from information_schema.tables where table_schema='auth' and table_name in ('users','identities','sessions','refresh_tokens','schema_migrations')");
    if (authTables.length !== 5) throw Error("REAL_GOTRUE_MIGRATIONS_REQUIRED");
    progress("REAL_AUTH_MIGRATIONS_READY");
    await sql(nativeStoragePort===undefined?DEPENDENCIES:DEPENDENCIES.slice(0,DEPENDENCIES.indexOf("create table storage.buckets")));
    if(nativeStoragePort!==undefined){
      await docker(["image","inspect","supabase/storage-api:v1.81.0"]);
      await sql("ALTER ROLE supabase_storage_admin WITH LOGIN PASSWORD "+lit(databasePassword)+";ALTER SCHEMA storage OWNER TO supabase_storage_admin;GRANT supabase_storage_admin TO postgres;GRANT usage ON SCHEMA public,auth,extensions TO supabase_storage_admin;");
      await runContainer("storage",{ANON_KEY:anonKey,SERVICE_KEY:serviceRoleKey,AUTH_JWT_SECRET:jwtSecret,POSTGREST_URL:"http://"+names.rest+":3000",DATABASE_URL:`postgresql://supabase_storage_admin:${encodeURIComponent(databasePassword)}@${names.postgres}:5432/${DB}`,STORAGE_PUBLIC_URL:"http://127.0.0.1:"+nativeStoragePort,FILE_SIZE_LIMIT:"10485760",STORAGE_BACKEND:"file",FILE_STORAGE_BACKEND_PATH:"/var/lib/storage",GLOBAL_S3_BUCKET:"synthetic",TENANT_ID:"synthetic-wp01a",REGION:"local",ENABLE_IMAGE_TRANSFORMATION:"false",NODE_OPTIONS:"--max-old-space-size=256"},["--tmpfs","/var/lib/storage:rw,size=32m,mode=1777","--publish","127.0.0.1:"+nativeStoragePort+":5000"]);
      await localIngress("storage",nativeStoragePort,5000);
      await waitFor("NATIVE_STORAGE",async()=>{const state=attached.get("storage");if(state?.exited)throw Object.assign(Error("LOCAL_STORAGE_EXITED:"+redact(state.output)),{fatal:true});return (await fetch("http://127.0.0.1:"+nativeStoragePort+"/status",{signal:AbortSignal.timeout(3000)})).ok;});
      progress("REAL_STORAGE_MIGRATIONS_READY");
    }
    // Same local platform prerequisite as whatsapp-integration/run.mjs and
    // overnight-local-testing.md. The cached image's initializer was reviewed:
    // it generates 32 local random bytes when absent; its key output is discarded.
    // This is only our disposable container, never a Cloud/project migration.
    await verifyContainer("postgres");
    await docker(["exec", names.postgres, "bash", "-c", "/usr/lib/postgresql/bin/pgsodium_getkey.sh > /dev/null"]);
    await sql("CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;");
    await sql(`BEGIN;
      DO $$ DECLARE probe uuid; BEGIN
        probe:=vault.create_secret('synthetic-local-platform-probe');
        IF NOT EXISTS(SELECT 1 FROM vault.secrets WHERE id=probe AND secret<>'synthetic-local-platform-probe')
        OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE id=probe AND decrypted_secret='synthetic-local-platform-probe')
        THEN RAISE EXCEPTION 'LOCAL_VAULT_CRYPTO_UNAVAILABLE'; END IF;
      END $$;
      ROLLBACK;`);
    progress("LOCAL_VAULT_CRYPTO_READY");
    if (migrationScope === "wp01a-auth") progress("AUTH_SCOPED_FIXTURE_FULL_CHAIN_NOT_VERIFIED");
    let migrationCount = 0, owner;
    for (const name of (await readdir(join(ROOT, "supabase/migrations"))).filter(name => name.endsWith(".sql")).sort()) {
      if (throughMigration && name > throughMigration) continue;
      // Explicitly approved Auth-backed scope: retain the known installed base,
      // genuine native password/identity session gates, and every broker migration.
      // Unrelated post-baseline financial/business installers are NOT validated.
      if (migrationScope === "wp01a-auth" && name >= "20261014033008_master_autorenew_wallet.sql"
          && name !== "20261014033009_master_identity_recovery.sql" && !name.startsWith("20261016")) {
        progress(`AUTH_SCOPE_NOT_APPLIED:${name}`); continue;
      }
      let source = (await readFile(join(ROOT, "supabase/migrations", name), "utf8")).replace(/^\uFEFF/, "");
      if(name === "20261013073443_billing_subscription_email_outbox.sql"){
        const evidenceQuery=`select jsonb_build_object('adminExists',to_regprocedure('public.billing_admin_authorized_session()') is not null,'offersExists',to_regclass('private.billing_service_order_offers') is not null,'collection',md5(replace(pg_get_viewdef(to_regclass('private.billing_verified_collection_history'),true),chr(13),'')),'grants',md5(replace(pg_get_viewdef(to_regclass('private.billing_proven_entitlement_grants'),true),chr(13),'')))`;
        const defaultContext=JSON.parse(await sql(evidenceQuery));
        const emptyContext=JSON.parse(await sql(`SET search_path='';${evidenceQuery}`));
        progress(`BILLING_VIEW_CONTEXT:${JSON.stringify({defaultContext,emptyContext})}`);
        if(emptyContext.collection==='cdda398ed1d2f6bf1b0a4db89fcced9f' && emptyContext.grants==='6c6d6a29a1dfae3e667948901044a7b1')source="SET LOCAL search_path='';\n"+source;
      }
      // Production PostgreSQL function bodies use LF. Opt-in fixture parity keeps
      // exact body digest guards intact on Windows without editing SQL history.
      if (canonicalSqlLineEndings) source = source.replaceAll("\r\n", "\n");
      if (name === OWNER_MIGRATION) {
        const email = source.match(/lower\(u.email\)='([^']+)'/)?.[1];
        if (!email) throw Error("OWNER_PRECONDITION_SOURCE_CHANGED");
        owner = await adminCreateUser({ email, userMetadata: { full_name: "Local integration platform owner" } });
        await sql(`INSERT INTO public.platform_admins(user_id,note) VALUES(${lit(owner.id)}::uuid,'Synthetic local owner migration precondition');`);
      }
      if(verifyAcceptedUsageUpgrade && name === "20261011233153_wa_accepted_usage_compatibility.sql"){
        let rejected=false;
        const tamper=`DO $tamper$ DECLARE d text; BEGIN d:=pg_get_functiondef('public.finalize_whatsapp_send_attempt(uuid,uuid,text,text,text,uuid)'::regprocedure); IF position('AS $function$' in d)=0 THEN RAISE EXCEPTION 'FIXTURE_TAMPER_FORMAT_CHANGED';END IF; EXECUTE replace(d,'AS $function$','AS $function$'||chr(10)||'-- synthetic fingerprint drift'||chr(10));END; $tamper$;`;
        try {await sql(`BEGIN;SET LOCAL ROLE postgres;${tamper}\n${source}`);}
        catch(error){if(!error.message.includes("ACCEPTED_USAGE_KNOWN_V1_PREREQUISITE_MISMATCH: public.finalize_whatsapp_send_attempt(uuid,uuid,text,text,text,uuid)"))throw error;rejected=true;}
        if(!rejected)throw Error("KNOWN_V1_GUARD_FAILED_TO_REJECT_DRIFT");
        progress("KNOWN_V1_DRIFT_GUARD_REGRESSION_PASSED");
      }
      if(verifyAcceptedUsageUpgrade && name === "20261013162547_meta_review_channel_dispatch.sql"){
        let rejected=false;const tamper=`DO $tamper$ DECLARE d text; BEGIN d:=pg_get_functiondef('private.wa_claim_send_pre_integration(uuid,uuid,integer)'::regprocedure);IF position('AS $function$' in d)=0 THEN RAISE EXCEPTION 'FIXTURE_TAMPER_FORMAT_CHANGED';END IF;EXECUTE replace(d,'AS $function$','AS $function$'||chr(10)||'-- synthetic kernel drift'||chr(10));END;$tamper$;`;
        try{await sql(`BEGIN;SET LOCAL ROLE postgres;${tamper}\n${source}`);}catch(error){if(!error.message.includes('REVIEW_DISPATCH_KERNEL_MISMATCH'))throw error;rejected=true;}
        if(!rejected)throw Error('REVIEW_KERNEL_DRIFT_NOT_REJECTED');progress('REVIEW_KERNEL_DRIFT_REGRESSION_PASSED');
      }
      if (verifyAcceptedUsageUpgrade && name === "20261014033004_master_cycle_ai_credits.sql") {
        const targets = await rows("select n.nspname,p.proname, md5(replace(p.prosrc,chr(13),'')) as body_md5,position('private.wa_worker_month()' in p.prosrc)>0 as worker_month from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public') and p.proname in ('wa_stage_pre_answer_profile','wa_claim_assistant_pre_meta_policy','ai_lock_authorized_whatsapp_job','wa_noura_authority') order by p.proname");
        progress(`CYCLE_NATIVE_TARGETS:${JSON.stringify(targets)}`);
        let rejected = false;
        try { await sql(`BEGIN;SET LOCAL ROLE postgres;ALTER FUNCTION private.wa_stage_pre_answer_profile(uuid,uuid,uuid,jsonb) RENAME TO fixture_missing_cycle_stage;\n${source}`); }
        catch (error) { if (!error.message.includes('CYCLE_NATIVE_PERIOD_PREREQUISITE_MISSING')) throw error; rejected = true; }
        if (!rejected) throw Error('CYCLE_MISSING_NATIVE_STAGE_NOT_REJECTED');
        progress('CYCLE_MISSING_NATIVE_STAGE_REGRESSION_PASSED');
      }
      try { await sql(`BEGIN;\nSET LOCAL ROLE postgres;\n${source}\nCOMMIT;`);
        if(name === "20261013073442_billing_admin_authorized_session.sql"){
          await sql(`DO $check$ BEGIN IF has_function_privilege('anon','public.billing_admin_authorized_session()','EXECUTE') OR has_function_privilege('service_role','public.billing_admin_authorized_session()','EXECUTE') OR NOT has_function_privilege('authenticated','public.billing_admin_authorized_session()','EXECUTE') THEN RAISE EXCEPTION 'BILLING_ADMIN_GATE_ACL_REGRESSION';END IF;END; $check$;`);
          await sql(`BEGIN;SET LOCAL ROLE authenticated;DO $check$ BEGIN IF public.billing_admin_authorized_session() IS DISTINCT FROM false THEN RAISE EXCEPTION 'BILLING_ADMIN_NO_IDENTITY_REGRESSION';END IF;END; $check$;ROLLBACK;`);
          const native=await authRequest('/token?grant_type=password',{email:owner.email,password:owner.password});
          if(!native.access_token)throw Error('BILLING_ADMIN_NATIVE_LOGIN_REQUIRED');
          secrets.add(native.access_token);if(native.refresh_token)secrets.add(native.refresh_token);
          const claims=JSON.parse(Buffer.from(native.access_token.split('.')[1],'base64url').toString());
          if(!claims.session_id || claims.sub!==owner.id)throw Error('BILLING_ADMIN_NATIVE_OWNER_PROOF_REQUIRED');
          const context=JSON.stringify({sub:claims.sub,role:'authenticated',session_id:claims.session_id,exp:claims.exp});
          await sql(`BEGIN;UPDATE private.app_session_settings SET enabled=true WHERE singleton;SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claims',${lit(context)},true);SELECT public.check_app_session(true);DO $check$ BEGIN IF public.billing_admin_authorized_session() IS DISTINCT FROM true THEN RAISE EXCEPTION 'BILLING_ADMIN_VALID_OWNER_REGRESSION';END IF;END; $check$;RESET ROLE;UPDATE private.app_session_activity SET last_activity_at=clock_timestamp()-interval '3 hours' WHERE session_id=${lit(claims.session_id)}::uuid;SET LOCAL ROLE authenticated;DO $check$ BEGIN IF public.billing_admin_authorized_session() IS DISTINCT FROM false THEN RAISE EXCEPTION 'BILLING_ADMIN_EXPIRED_OWNER_REGRESSION';END IF;END; $check$;ROLLBACK;`);
          progress("BILLING_ADMIN_ACL_VALID_AND_EXPIRED_NATIVE_SESSION_REGRESSIONS_PASSED");
        }
        if(name === "20261013162547_meta_review_channel_dispatch.sql"){
          await sql(`DO $check$ BEGIN IF has_function_privilege('anon','public.claim_whatsapp_review_send(uuid,uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.claim_whatsapp_review_send(uuid,uuid,uuid)','EXECUTE') OR NOT has_function_privilege('service_role','public.claim_whatsapp_review_send(uuid,uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'REVIEW_CLAIM_ACL_REGRESSION';END IF;END;$check$;BEGIN;SET LOCAL ROLE service_role;DO $check$ BEGIN IF public.claim_whatsapp_review_send(gen_random_uuid(),gen_random_uuid(),gen_random_uuid())->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'REVIEW_CLAIM_UNKNOWN_INTENT_REGRESSION';END IF;END;$check$;ROLLBACK;`);
          progress('REVIEW_REPLACEMENT_ACL_AND_UNKNOWN_INTENT_REGRESSIONS_PASSED');
        }
        await sql(`INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES(${lit(name.split("_")[0])},${lit(name.replace(/^\d+_/,"" ).replace(/\.sql$/,""))}) ON CONFLICT(version) DO NOTHING;`);
      } catch (error) { throw Error(`LOCAL_MIGRATION_FAILED ${name}: ${redact(error.message).split("\nCONTEXT:")[0]}`); }
      migrationCount++;
      if(migrationCount % 25 === 0)progress(`PROJECT_MIGRATION_PROGRESS:${migrationCount}`);
    }
    if (!owner) throw Error("OWNER_FIXTURE_REQUIRED");
    const [sessionPolicy] = await rows("select s.enabled,(select r.rolconfig from pg_roles r where r.rolname='authenticator') as authenticator_settings from private.app_session_settings s where s.singleton");
    progress(`PROJECT_MIGRATIONS_READY:${migrationCount}`);
    if(databaseOnly){
      await verify();progress("LOCAL_DB_ONLY_STACK_READY");
      return {databaseUrl: databasePort === undefined ? undefined : `postgresql://supabase_admin:${databasePassword}@127.0.0.1:${databasePort}/${DB}`,url,anonKey,serviceRoleKey,owner,migrationCount,sessionPolicy,runId,network:networkName,database:DB,sql,rows,adminCreateUser,readEmailOtp,readEmailRecoveryLink,verify,close,redact,names:Object.freeze(names)};
    }
    await runContainer("rest", {
      PGRST_DB_URI: `postgres://authenticator:${databasePassword}@${names.postgres}:5432/${DB}`,
      PGRST_DB_SCHEMAS: "public", PGRST_DB_EXTRA_SEARCH_PATH: "public,extensions", PGRST_DB_ANON_ROLE: "anon", PGRST_JWT_SECRET: jwtSecret,
      PGRST_DB_MAX_ROWS: "1000", PGRST_LOG_LEVEL: "error", PGRST_SERVER_HOST: "0.0.0.0", PGRST_SERVER_PORT: "3000",
    }, ["--publish", `127.0.0.1:${restPort}:3000`]);
    await localIngress("rest", restPort, 3000);
    await waitFor("LOCAL_REST", async () => (await fetch(`http://127.0.0.1:${restPort}/`, { headers: { Authorization: `Bearer ${serviceRoleKey}`, Connection: "close" }, signal: AbortSignal.timeout(3000), redirect: "error" })).ok);
    gateway = createServer(gatewayHandler);
    await new Promise((ok, fail) => { gateway.once("error", fail); gateway.listen(gatewayPort, "127.0.0.1", ok); });
    await verify();
    progress("LOCAL_HTTP_STACK_READY");
    return { databaseUrl: databasePort === undefined ? undefined : `postgresql://supabase_admin:${databasePassword}@127.0.0.1:${databasePort}/${DB}`, url, localUrl: url, anonKey, anonJwt: anonKey, serviceRoleKey, serviceJwt: serviceRoleKey, owner, migrationCount, sessionPolicy, runId, network: networkName, database: DB, sql, rows, adminCreateUser, readEmailOtp, readEmailRecoveryLink, verify, close, redact, names: Object.freeze(names) };
  } catch (error) {
    await close().catch(cleanupError => progress(`LOCAL_CLEANUP_REFUSED:${redact(cleanupError.message)}`));
    throw Error(redact(error.message));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "--serve") throw Error("USE_IMPORT_STARTSTACK_OR_SERVE");
  const stack = await startStack({ progress: message => console.log(message) });
  console.log(`LOCAL_STACK_LISTENING:${stack.url}`);
  const stop = async () => { try { await stack.close(); process.exit(0); } catch (error) { console.error(stack.redact(error.message)); process.exit(1); } };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
}

export function createLocalGatewayHandler({gatewayPort,appOrigin,url,anonKey,serviceRoleKey,authPort,restPort,reuseUpstreamConnections=false,upstreamAgents,apiKeyAllowed=value=>[anonKey,serviceRoleKey].includes(value)}) {
  return (request, response) => {
    const deny = (status, code) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify({ code })); };
    if (![`127.0.0.1:${gatewayPort}`, `localhost:${gatewayPort}`].includes(request.headers.host)) return deny(403, "LOCAL_HOST_REQUIRED");
    if (request.headers.origin && ![appOrigin, url].includes(request.headers.origin)) return deny(403, "LOCAL_ORIGIN_REQUIRED");
    if (request.headers.origin) response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, range, accept-profile, content-profile, x-request-id");
    response.setHeader("Access-Control-Expose-Headers", "content-range, x-request-id");
    if (request.method === "OPTIONS") { response.writeHead(204); return response.end(); }
    if (!request.url?.startsWith("/") || request.url.startsWith("//")) return deny(400, "LOCAL_PATH_REQUIRED");
    let path;
    try { path = new URL(request.url, url); } catch { return deny(400, "LOCAL_PATH_REQUIRED"); }
    if (path.origin !== url) return deny(400, "LOCAL_PATH_REQUIRED");
    if (path.pathname === "/health") { response.writeHead(200, { "Content-Type": "application/json" }); return response.end('{"ok":true,"local":true}'); }
    const auth = path.pathname === "/auth/v1" || path.pathname.startsWith("/auth/v1/");
    const rest = path.pathname === "/rest/v1" || path.pathname.startsWith("/rest/v1/");
    if (!auth && !rest) return deny(404, "LOCAL_ROUTE_NOT_SUPPORTED");
    const nativeVerificationLink=request.method==="GET" && path.pathname==="/auth/v1/verify";
    if (!nativeVerificationLink && !apiKeyAllowed(request.headers.apikey)) return deny(401, "INVALID_LOCAL_API_KEY");
    const upstreamPath = (path.pathname.slice(8) || "/") + path.search;
    const headers = {};
    for (const name of ["authorization", "content-type", "content-length", "accept", "prefer", "range", "accept-profile", "content-profile", "x-client-info", "x-supabase-api-version", "x-request-id"])
      if (request.headers[name] !== undefined) headers[name] = request.headers[name];
    headers["x-forwarded-proto"] = "http";
    headers["x-forwarded-host"] = `127.0.0.1:${gatewayPort}`;
    headers.connection = reuseUpstreamConnections ? "keep-alive" : "close";
    // Authorization is forwarded exactly as supplied; never synthesize a user/session.
    const upstream = httpRequest({ hostname: "127.0.0.1", port: auth ? authPort : restPort, path: upstreamPath, method: request.method, headers, agent:upstreamAgents?.[auth?'auth':'rest'] }, incoming => {
      for (const [name, value] of Object.entries(incoming.headers))
        if (value !== undefined && !["connection", "transfer-encoding", "access-control-allow-origin", "access-control-allow-headers", "access-control-expose-headers"].includes(name)) response.setHeader(name, value);
      response.writeHead(incoming.statusCode ?? 502);
      incoming.pipe(response);
    });
    let bytes = 0;
    request.on("data", chunk => { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) { upstream.destroy(); if (!response.headersSent) deny(413, "LOCAL_BODY_TOO_LARGE"); } });
    upstream.setTimeout(20_000, () => upstream.destroy());
    upstream.on("error", () => { if (!response.headersSent) deny(502, "LOCAL_UPSTREAM_UNAVAILABLE"); else response.destroy(); });
    request.on("aborted", () => upstream.destroy());
    request.pipe(upstream);
  };
}
