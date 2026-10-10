// TEST ONLY. Real local GoTrue and PostgREST; project SQL/ACL/RLS remain unmodified.
// Nothing reads project environment files, starts Next, or contacts a provider.
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "SystemDrive", "COMSPEC", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"])
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
export async function startStack({ gatewayPort = 3130, authPort = 3140, restPort = 3141, appOrigin = "http://127.0.0.1:3120", progress = () => {}, throughMigration } = {}) {
  gatewayPort = port(gatewayPort); authPort = port(authPort); restPort = port(restPort);
  if (new Set([gatewayPort, authPort, restPort]).size !== 3) throw Error("STACK_PORTS_MUST_DIFFER");
  appOrigin = localOrigin(appOrigin);
  const url = `http://127.0.0.1:${gatewayPort}`;
  const runId = randomUUID();
  const suffix = runId.slice(0, 8);
  const networkName = `${NETWORK}-${suffix}`;
  const names = Object.fromEntries(["postgres", "auth", "rest"].map(key => [key, `velora-c1-ui-${key}-${suffix}`]));
  const jwtSecret = randomBytes(48).toString("base64url");
  const databasePassword = randomBytes(36).toString("hex");
  const anonKey = sign(jwtSecret, "anon", `${url}/auth/v1`);
  const serviceRoleKey = sign(jwtSecret, "service_role", `${url}/auth/v1`);
  const secrets = new Set([jwtSecret, databasePassword, anonKey, serviceRoleKey]);
  const created = new Set();
  const attached = new Map();
  const ingress = new Map();
  let networkCreated = false, gateway, closed = false;
  const redact = value => {
    let result = String(value);
    for (const secret of secrets) result = result.replaceAll(secret, "[LOCAL_CREDENTIAL_REDACTED]");
    return result.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[LOCAL_JWT_REDACTED]").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[LOCAL_EMAIL_REDACTED]");
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
    const expectedPort = kind === "auth" ? ["9999/tcp", authPort] : ["3000/tcp", restPort];
    const validPorts = kind === "postgres" ? Object.keys(ports).length === 0 :
      Object.keys(ports).length === 1 && ports[expectedPort[0]]?.length === 1 && ports[expectedPort[0]][0].HostIp === "127.0.0.1" && ports[expectedPort[0]][0].HostPort === String(expectedPort[1]);
    if (container.Config.Image !== IMAGES[kind] || container.Config.Labels?.["velora.task"] !== TASK_LABEL || container.Config.Labels?.["velora.run"] !== runId ||
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
    const args = [kind === "auth" ? "create" : "run", ...(kind === "auth" ? [] : ["--detach"]), "--pull=never", "--name", names[kind], "--label", `velora.task=${TASK_LABEL}`, "--label", `velora.run=${runId}`, "--network", networkName,
      "--memory", kind === "postgres" ? "1536m" : "384m", "--cpus", "1", "--pids-limit", "256", "--log-driver", "none", ...extra];
    for (const name of Object.keys(environment)) args.push("--env", name);
    args.push(IMAGES[kind]);
    await docker(args, { env: environment, timeout: 60_000 });
    created.add(kind);
    await verifyContainer(kind);
    if (kind === "auth") {
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
  const gatewayHandler = (request, response) => {
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
    if (![anonKey, serviceRoleKey].includes(request.headers.apikey)) return deny(401, "INVALID_LOCAL_API_KEY");
    const upstreamPath = (path.pathname.slice(8) || "/") + path.search;
    const headers = {};
    for (const name of ["authorization", "content-type", "content-length", "accept", "prefer", "range", "accept-profile", "content-profile", "x-client-info", "x-supabase-api-version", "x-request-id"])
      if (request.headers[name] !== undefined) headers[name] = request.headers[name];
    headers["x-forwarded-proto"] = "http";
    headers["x-forwarded-host"] = `127.0.0.1:${gatewayPort}`;
    headers.connection = "close";
    // Authorization is forwarded exactly as supplied; never synthesize a user/session.
    const upstream = httpRequest({ hostname: "127.0.0.1", port: auth ? authPort : restPort, path: upstreamPath, method: request.method, headers }, incoming => {
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
    await docker(["exec", "-i", "-u", "postgres", names.postgres, "psql", "-X", "-U", "supabase_admin", "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1"], { input: `CREATE DATABASE ${DB};\nALTER ROLE supabase_auth_admin WITH LOGIN PASSWORD ${lit(databasePassword)};\nALTER ROLE authenticator WITH LOGIN PASSWORD ${lit(databasePassword)};\nGRANT anon,authenticated,service_role TO authenticator;\n` });
    await sql("CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;");
    progress("LOCAL_DATABASE_READY");
    await runContainer("auth", {
      GOTRUE_API_HOST: "0.0.0.0", GOTRUE_API_PORT: "9999", API_EXTERNAL_URL: `${url}/auth/v1`,
      GOTRUE_DB_DRIVER: "postgres", GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${databasePassword}@${names.postgres}:5432/${DB}`,
      GOTRUE_SITE_URL: appOrigin, GOTRUE_URI_ALLOW_LIST: `${appOrigin}/**`, GOTRUE_DISABLE_SIGNUP: "false",
      GOTRUE_JWT_ADMIN_ROLES: "service_role", GOTRUE_JWT_AUD: "authenticated", GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated", GOTRUE_JWT_EXP: "3600", GOTRUE_JWT_SECRET: jwtSecret,
      GOTRUE_JWT_ISSUER: `${url}/auth/v1`, GOTRUE_EXTERNAL_EMAIL_ENABLED: "true", GOTRUE_MAILER_AUTOCONFIRM: "true",
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
    await sql(DEPENDENCIES);
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
    let migrationCount = 0, owner;
    for (const name of (await readdir(join(ROOT, "supabase/migrations"))).filter(name => name.endsWith(".sql")).sort()) {
      if (throughMigration && name > throughMigration) continue;
      const source = (await readFile(join(ROOT, "supabase/migrations", name), "utf8")).replace(/^\uFEFF/, "");
      if (name === OWNER_MIGRATION) {
        const email = source.match(/lower\(u.email\)='([^']+)'/)?.[1];
        if (!email) throw Error("OWNER_PRECONDITION_SOURCE_CHANGED");
        owner = await adminCreateUser({ email, userMetadata: { full_name: "Local integration platform owner" } });
        await sql(`INSERT INTO public.platform_admins(user_id,note) VALUES(${lit(owner.id)}::uuid,'Synthetic local owner migration precondition');`);
      }
      try { await sql(source); } catch (error) { throw Error(`LOCAL_MIGRATION_FAILED ${name}: ${redact(error.message)}`); }
      migrationCount++;
    }
    if (!owner) throw Error("OWNER_FIXTURE_REQUIRED");
    const [sessionPolicy] = await rows("select s.enabled,(select r.rolconfig from pg_roles r where r.rolname='authenticator') as authenticator_settings from private.app_session_settings s where s.singleton");
    progress(`PROJECT_MIGRATIONS_READY:${migrationCount}`);
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
    return { url, localUrl: url, anonKey, anonJwt: anonKey, serviceRoleKey, serviceJwt: serviceRoleKey, owner, migrationCount, sessionPolicy, runId, network: networkName, database: DB, sql, rows, adminCreateUser, verify, close, redact, names: Object.freeze(names) };
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
