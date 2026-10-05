/**
 * VEL-A10-01: suspended company members cannot read knowledge / storage / WhatsApp.
 *
 * Local disposable Velora Supabase only. Never loads cloud `.env.local`.
 * Project root is derived from this script path (not cwd alone).
 *
 * Required:
 *   VELORA_ALLOW_DISPOSABLE_LOCAL_TEST=YES   explicit opt-in before any fixtures
 *   VELORA_LOCAL_SUPABASE_URL              = http://127.0.0.1:54321 or http://localhost:54321
 *   VELORA_LOCAL_SUPABASE_ANON_KEY
 *   VELORA_LOCAL_SUPABASE_SERVICE_ROLE_KEY
 *   Local `supabase status` for project_id Velora_new must match URL/keys
 *   Migration vel_a10_01 applied on that local DB
 *
 * Exit 2 = BLOCKED. Exit 1 = FAIL. Exit 0 = PASS (cases + cleanup).
 */
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");
const EXPECTED_PROJECT_ID = "Velora_new";
const LOCAL_ENV_FILES = [".env.local.supabase", ".env.supabase.local"];
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost"]);
const ALLOWED_PORT = "54321";

function loadLocalOnlyEnv() {
  for (const name of LOCAL_ENV_FILES) {
    const path = resolve(ROOT, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      if (!k.startsWith("VELORA_LOCAL_") && k !== "VELORA_ALLOW_DISPOSABLE_LOCAL_TEST") continue;
      const v = line.slice(i + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

function blocked(reason) {
  console.error(`BLOCKED: ${reason}`);
  process.exit(2);
}

/** Strict local API URL: host/port only, no userinfo/path/query/hash. */
function parseLocalApiUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (parsed.protocol !== "http:") return { ok: false, reason: "protocol_not_http" };
  if (!ALLOWED_HOSTS.has(parsed.hostname)) return { ok: false, reason: `unexpected_host` };
  if (parsed.port !== ALLOWED_PORT) return { ok: false, reason: `unexpected_port` };
  if (parsed.username || parsed.password) return { ok: false, reason: "credentials_in_url" };
  if (parsed.pathname && parsed.pathname !== "/") return { ok: false, reason: "path_in_url" };
  if (parsed.search || parsed.hash) return { ok: false, reason: "query_or_hash_in_url" };
  return { ok: true, origin: `http://${parsed.hostname}:${ALLOWED_PORT}` };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function requireOk(error, label) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

function errText(error) {
  return `${error?.code ?? ""} ${error?.status ?? error?.statusCode ?? ""} ${error?.message ?? ""}`.toLowerCase();
}

function isNetworkOrServerError(error) {
  if (!error) return false;
  const text = errText(error);
  const status = Number(error.status ?? error.statusCode ?? 0);
  if (status >= 500) return true;
  return (
    text.includes("fetch failed")
    || text.includes("network")
    || text.includes("timeout")
    || text.includes("econnrefused")
    || text.includes("enotfound")
    || text.includes("socket")
    || text.includes("502")
    || text.includes("503")
    || text.includes("504")
  );
}

/** Expected RLS / visibility denial — not infra, and not signed-in session failure. */
function isExpectedAccessDenial(error) {
  if (!error) return false;
  if (isNetworkOrServerError(error)) return false;
  const text = errText(error);
  const status = Number(error.status ?? error.statusCode ?? 0);
  const code = String(error.code ?? "");
  if (status === 403) return true;
  if (code === "42501") return true;
  // Storage often returns 400/404 when object is invisible under RLS.
  if (status === 400 || status === 404) {
    return (
      text.includes("not found")
      || text.includes("object not found")
      || text.includes("unauthorized")
      || text.includes("permission")
      || text.includes("row-level security")
      || text.includes("denied")
    );
  }
  if (status === 401) {
    // Anon gate only — signed-in actors treat any 401 as session failure first.
    return text.includes("unauthorized") || text.includes("permission") || text.includes("denied")
      || text.includes("row-level security") || text.includes("jwt") || text.includes("anon");
  }
  return (
    text.includes("permission")
    || text.includes("row-level security")
    || text.includes("unauthorized")
    || text.includes("denied")
  );
}

/** Signed-in actor: any 401 / missing-auth (incl. PGRST302) fails the test — not isolation deny. */
function isSessionAuthFailure(error) {
  if (!error) return false;
  if (isNetworkOrServerError(error)) return false;
  const text = errText(error);
  const status = Number(error.status ?? error.statusCode ?? 0);
  const code = String(error.code ?? "");
  if (status === 401) return true;
  if (code === "PGRST301" || code === "PGRST302") return true;
  if (text.includes("jwt expired") || text.includes("invalid jwt") || text.includes("invalid claim")) return true;
  if (text.includes("session missing") || text.includes("no session") || text.includes("session not found")) {
    return true;
  }
  if (text.includes("not authenticated") || text.includes("auth session missing")) return true;
  return false;
}

/** Leftover proof only: storage object specifically absent — bare HTTP 404 is not enough. */
function isStorageObjectNotFound(error) {
  if (!error) return false;
  if (isNetworkOrServerError(error)) return false;
  const text = errText(error);
  if (text.includes("permission") || text.includes("unauthorized") || text.includes("row-level security") || text.includes("denied") || text.includes("jwt")) {
    return false;
  }
  // Reject generic/wrong-path 404; require object-resource wording.
  return text.includes("object not found")
    || (text.includes("object") && text.includes("not found"))
    || text.includes("no such object");
}

/** Leftover proof only: auth admin reports user absent — bare HTTP 404 is not enough. */
function isAuthUserNotFound(error) {
  if (!error) return false;
  if (isNetworkOrServerError(error)) return false;
  const text = errText(error);
  if (text.includes("permission") || text.includes("unauthorized") || text.includes("forbidden")) return false;
  // Reject generic/wrong-path 404; require user-resource wording.
  return text.includes("user not found")
    || (text.includes("user") && text.includes("not found"));
}

/**
 * @param {'allow'|'deny'} expect
 * @param {{ data?: unknown, error?: { message?: string, code?: string, status?: number } | null }} result
 * @param {'anon'|'authed'} actor
 */
function classifyRead(expect, result, label, actor = "authed") {
  const { data, error } = result;
  if (error) {
    if (isNetworkOrServerError(error)) {
      throw new Error(`TEST_ERROR ${label}: ${error.message}`);
    }
    if (actor === "authed" && isSessionAuthFailure(error)) {
      throw new Error(`FAIL ${label}: signed-in session/JWT invalid or missing (not isolation deny)`);
    }
    if (expect === "deny" && isExpectedAccessDenial(error)) return;
    throw new Error(`TEST_ERROR ${label}: unexpected error (${error.code ?? ""} ${error.message})`);
  }
  const rows = Array.isArray(data) ? data.length : data ? 1 : 0;
  if (expect === "allow") {
    if (rows < 1) throw new Error(`FAIL ${label}: expected visible row(s), got none`);
    return;
  }
  if (rows > 0) throw new Error(`FAIL ${label}: expected hidden/denied, got ${rows} row(s)`);
}

/** @param {'anon'|'authed'} actor */
async function classifyStorageDownload(expect, client, path, label, actor = "authed") {
  const { data, error } = await client.storage.from("company-knowledge").download(path);
  if (error) {
    if (isNetworkOrServerError(error)) throw new Error(`TEST_ERROR ${label}: ${error.message}`);
    if (actor === "authed" && isSessionAuthFailure(error)) {
      throw new Error(`FAIL ${label}: signed-in session/JWT invalid or missing (not isolation deny)`);
    }
    if (expect === "deny" && isExpectedAccessDenial(error)) return null;
    throw new Error(`TEST_ERROR ${label}: unexpected storage error (${error.message})`);
  }
  if (expect === "deny") {
    if (!data) return null;
    throw new Error(`FAIL ${label}: expected storage deny, download returned bytes`);
  }
  if (!data) throw new Error(`FAIL ${label}: expected storage allow, got empty body`);
  return data;
}

loadLocalOnlyEnv();

function assertProjectRootIsVeloraNew() {
  const configPath = resolve(ROOT, "supabase", "config.toml");
  if (!existsSync(configPath)) blocked(`project root missing supabase/config.toml (root from script)`);
  const config = readFileSync(configPath, "utf8");
  const match = config.match(/^\s*project_id\s*=\s*"([^"]+)"/m);
  if (!match) blocked("supabase/config.toml missing project_id");
  if (match[1] !== EXPECTED_PROJECT_ID) {
    blocked(`project_id mismatch (expected ${EXPECTED_PROJECT_ID})`);
  }
  if (!existsSync(resolve(ROOT, "scripts", "vel-a10-01-suspended-company-isolation.mjs"))) {
    blocked("script path not under expected Velora project root");
  }
}

function statusField(status, keys) {
  for (const key of keys) {
    const value = status?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** Read-only: installed `supabase status -o json` only (no npx). Never prints secrets. */
function readLocalSupabaseStatus() {
  const result = spawnSync("supabase", ["status", "-o", "json", "--workdir", ROOT], {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.error) {
    blocked(
      result.error.code === "ENOENT"
        ? "supabase CLI not installed (no npx fallback)"
        : "supabase CLI spawn error",
    );
  }
  if (result.status !== 0) {
    blocked("local supabase status unavailable (containers not ready or workdir mismatch)");
  }
  try {
    return JSON.parse(result.stdout || "{}");
  } catch {
    blocked("supabase status returned non-json");
  }
}

function assertEnvMatchesLocalCli(status, apiOrigin, anonKey, serviceKey) {
  const apiRaw = statusField(status, ["API_URL", "apiUrl", "api_url", "API URL"]);
  const anonRaw = statusField(status, ["ANON_KEY", "anonKey", "anon_key", "Publishable key", "PUBLISHABLE_KEY"]);
  const serviceRaw = statusField(status, [
    "SERVICE_ROLE_KEY",
    "serviceRoleKey",
    "service_role_key",
    "Secret key",
    "SECRET_KEY",
  ]);
  if (!apiRaw || !anonRaw || !serviceRaw) {
    blocked("supabase status missing API_URL / ANON_KEY / SERVICE_ROLE_KEY");
  }
  const cliParsed = parseLocalApiUrl(apiRaw);
  if (!cliParsed.ok) blocked(`supabase status API_URL refused (${cliParsed.reason})`);
  if (cliParsed.origin !== apiOrigin) blocked("local API URL mismatch vs supabase status");
  if (anonRaw !== anonKey) blocked("local anon key mismatch vs supabase status");
  if (serviceRaw !== serviceKey) blocked("local service_role key mismatch vs supabase status");
}

const rawUrl = process.env.VELORA_LOCAL_SUPABASE_URL ?? "";
const anon = process.env.VELORA_LOCAL_SUPABASE_ANON_KEY ?? "";
const service = process.env.VELORA_LOCAL_SUPABASE_SERVICE_ROLE_KEY ?? "";
const allowDisposable = (process.env.VELORA_ALLOW_DISPOSABLE_LOCAL_TEST ?? "").trim() === "YES";

assertProjectRootIsVeloraNew();

if (!allowDisposable) {
  blocked("set VELORA_ALLOW_DISPOSABLE_LOCAL_TEST=YES to use disposable local Velora");
}
if (!rawUrl || !anon || !service) {
  blocked("missing VELORA_LOCAL_SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY (use .env.local.supabase)");
}

const parsedUrl = parseLocalApiUrl(rawUrl);
if (!parsedUrl.ok) blocked(`refusing URL (${parsedUrl.reason})`);

const url = parsedUrl.origin;
const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
const anonClient = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });

async function proveDisposableLocalVelora() {
  const status = readLocalSupabaseStatus();
  assertEnvMatchesLocalCli(status, url, anon, service);

  let health;
  try {
    health = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
  } catch (err) {
    blocked(`local auth health unreachable (${err instanceof Error ? err.message : "fetch"})`);
  }
  if (!health.ok) blocked(`local auth health status=${health.status}`);

  const probes = [
    ["companies", () => admin.from("companies").select("id").limit(1)],
    ["knowledge_sources", () => admin.from("knowledge_sources").select("id").limit(1)],
    ["whatsapp_conversations", () => admin.from("whatsapp_conversations").select("id").limit(1)],
    ["whatsapp_messages", () => admin.from("whatsapp_messages").select("id").limit(1)],
    ["whatsapp_delivery_statuses", () => admin.from("whatsapp_delivery_statuses").select("id").limit(1)],
  ];
  for (const [name, run] of probes) {
    const { error } = await run();
    if (!error) continue;
    if (isNetworkOrServerError(error)) blocked(`local ${name} probe network/server error`);
    const text = errText(error);
    if (text.includes("does not exist") || text.includes("schema cache") || error.code === "PGRST205") {
      blocked(`local env missing Velora table ${name}`);
    }
    blocked(`local ${name} probe failed before seed`);
  }

  const { data: buckets, error: bucketErr } = await admin.storage.listBuckets();
  if (bucketErr) {
    if (isNetworkOrServerError(bucketErr)) blocked("storage listBuckets network/server error");
    blocked("storage listBuckets failed before seed");
  }
  if (!(buckets ?? []).some((b) => b.name === "company-knowledge" || b.id === "company-knowledge")) {
    blocked("local env missing company-knowledge bucket");
  }

  console.log("ENV proven=local_disposable_velora project_id=Velora_new api=loopback:54321");
}

const stamp = Date.now();
const password = `Velora!${stamp}Aa`;
const passed = [];
const cleanup = {
  users: [],
  companies: [],
  storagePaths: [],
  knowledgeIds: [],
  conversationIds: [],
  messageIds: [],
  statusIds: [],
  platformAdminIds: [],
};

function pass(id) {
  passed.push(id);
}

async function makeUser(label) {
  const email = `vela10.${label}.${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: label },
  });
  requireOk(error, `createUser ${label}`);
  assert(data?.user?.id, `createUser ${label} missing id`);
  cleanup.users.push(data.user.id);
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: signData, error: signErr } = await client.auth.signInWithPassword({ email, password });
  requireOk(signErr, `signIn ${label}`);
  assert(signData?.session?.access_token, `missing session after signIn ${label}`);
  const { data: sessionData, error: sessionErr } = await client.auth.getSession();
  requireOk(sessionErr, `getSession ${label}`);
  assert(sessionData?.session?.access_token, `session missing for ${label}`);
  const { data: userData, error: userErr } = await client.auth.getUser();
  requireOk(userErr, `getUser ${label}`);
  assert(userData.user?.id === data.user.id, `session identity ${label}`);
  return { email, userId: data.user.id, client, label };
}

async function createOwnerCompany(owner, displayName) {
  const { data, error } = await owner.client.rpc("upsert_owner_company", {
    p_display_name: displayName,
    p_hours: "9-5",
    p_member_name: owner.label,
  });
  requireOk(error, `upsert_owner_company ${owner.label}`);
  assert(data?.id, `company id for ${owner.label}`);
  cleanup.companies.push(data.id);
  const { data: membership, error: memErr } = await admin
    .from("company_members")
    .select("company_id, user_id, role, status")
    .eq("company_id", data.id)
    .eq("user_id", owner.userId)
    .maybeSingle();
  requireOk(memErr, `verify owner membership ${owner.label}`);
  assert(membership?.role === "owner" && membership?.status === "active", `owner membership ${owner.label}`);
  return data;
}

async function setCompanyStatus(companyId, status) {
  const { data, error } = await admin.from("companies").update({ status }).eq("id", companyId).select("id, status").single();
  requireOk(error, `set status ${status}`);
  assert(data?.status === status, `status became ${status}`);
  return data;
}

async function insertMember({ companyId, userId, role, status, memberName }) {
  const { data, error } = await admin
    .from("company_members")
    .insert({ company_id: companyId, user_id: userId, role, status, member_name: memberName })
    .select("company_id, user_id, role, status")
    .single();
  requireOk(error, `insert member ${memberName}`);
  assert(data?.role === role && data?.status === status, `member row ${memberName}`);
  return data;
}

async function seedKnowledge(companyId, userId, title) {
  const { data, error } = await admin
    .from("knowledge_sources")
    .insert({
      company_id: companyId,
      kind: "text",
      title,
      content: "secret body",
      status: "ready",
      created_by: userId,
    })
    .select("id")
    .single();
  requireOk(error, `seed knowledge ${title}`);
  cleanup.knowledgeIds.push(data.id);
  return data.id;
}

async function seedStorageFile(owner, companyId, tag) {
  const { data: fileRow, error: fileRowErr } = await admin
    .from("knowledge_sources")
    .insert({
      company_id: companyId,
      kind: "file",
      title: `a10-${tag}.csv`,
      content: "",
      file_name: `a10-${tag}.csv`,
      content_type: "text/csv",
      byte_size: 2048,
      status: "failed",
      created_by: owner.userId,
    })
    .select("id")
    .single();
  requireOk(fileRowErr, `seed storage row ${tag}`);
  cleanup.knowledgeIds.push(fileRow.id);

  const path = `${companyId}/${fileRow.id}/a10-${tag}.csv`;
  const payload = "name,price\n" + "item,1.5\n".repeat(120);
  assert(payload.length > 1024, "storage payload > 1KiB");
  const { error: upErr } = await admin.storage.from("company-knowledge").upload(path, payload, {
    contentType: "text/csv",
    upsert: false,
  });
  requireOk(upErr, `storage upload ${tag}`);
  cleanup.storagePaths.push(path);
  const { error: linkErr } = await admin
    .from("knowledge_sources")
    .update({ storage_path: path, status: "stored", byte_size: payload.length })
    .eq("id", fileRow.id);
  requireOk(linkErr, `link storage ${tag}`);
  return { knowledgeId: fileRow.id, path, payload };
}

async function seedWhatsapp(companyId, tag) {
  const phoneNumberId = `pn-a10-${tag}-${stamp}`;
  const customerWaId = `968${String(stamp).slice(-8)}${tag === "act" ? "01" : tag === "set" ? "03" : "02"}`;
  const { data: conv, error: cErr } = await admin
    .from("whatsapp_conversations")
    .insert({
      company_id: companyId,
      phone_number_id: phoneNumberId,
      customer_wa_id: customerWaId,
      customer_name: `A10 ${tag}`,
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  requireOk(cErr, `seed conversation ${tag}`);
  cleanup.conversationIds.push(conv.id);

  const waMessageId = `wamid.a10.${tag}.${stamp}.${Math.random().toString(16).slice(2, 8)}`;
  const { data: msg, error: mErr } = await admin
    .from("whatsapp_messages")
    .insert({
      company_id: companyId,
      conversation_id: conv.id,
      wa_message_id: waMessageId,
      body: `hello ${tag}`,
      message_type: "text",
      direction: "inbound",
      sender: "customer",
      received_at: new Date().toISOString(),
    })
    .select("id, wa_message_id")
    .single();
  requireOk(mErr, `seed message ${tag}`);
  cleanup.messageIds.push(msg.id);

  const { data: st, error: sErr } = await admin
    .from("whatsapp_delivery_statuses")
    .insert({
      company_id: companyId,
      phone_number_id: phoneNumberId,
      wa_message_id: waMessageId,
      status: "delivered",
      recipient_wa_id: customerWaId,
      occurred_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  requireOk(sErr, `seed delivery status ${tag}`);
  cleanup.statusIds.push(st.id);
  return { conversationId: conv.id, messageId: msg.id, waMessageId, statusId: st.id };
}

async function cleanupAll() {
  const errors = [];
  const step = async (label, fn) => {
    try {
      await fn();
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  await step("storage.remove", async () => {
    if (!cleanup.storagePaths.length) return;
    const { error } = await admin.storage.from("company-knowledge").remove(cleanup.storagePaths);
    if (error && !isStorageObjectNotFound(error) && !isExpectedAccessDenial(error)) {
      if (isNetworkOrServerError(error)) throw new Error(error.message);
      throw new Error(error.message);
    }
  });
  await step("delivery_statuses.delete", async () => {
    if (!cleanup.statusIds.length) return;
    const { error } = await admin.from("whatsapp_delivery_statuses").delete().in("id", cleanup.statusIds);
    requireOk(error, "delivery_statuses");
  });
  await step("messages.delete", async () => {
    if (!cleanup.messageIds.length) return;
    const { error } = await admin.from("whatsapp_messages").delete().in("id", cleanup.messageIds);
    requireOk(error, "messages");
  });
  await step("conversations.delete", async () => {
    if (!cleanup.conversationIds.length) return;
    const { error } = await admin.from("whatsapp_conversations").delete().in("id", cleanup.conversationIds);
    requireOk(error, "conversations");
  });
  await step("knowledge.delete", async () => {
    if (!cleanup.knowledgeIds.length) return;
    const { error } = await admin.from("knowledge_sources").delete().in("id", cleanup.knowledgeIds);
    requireOk(error, "knowledge");
  });
  await step("platform_admins.delete", async () => {
    if (!cleanup.platformAdminIds.length) return;
    const { error } = await admin.from("platform_admins").delete().in("user_id", cleanup.platformAdminIds);
    requireOk(error, "platform_admins");
  });
  await step("companies.delete", async () => {
    if (!cleanup.companies.length) return;
    const { error } = await admin.from("companies").delete().in("id", cleanup.companies);
    requireOk(error, "companies");
  });
  for (const id of cleanup.users) {
    await step(`auth.deleteUser:${id.slice(0, 8)}`, async () => {
      const { error } = await admin.auth.admin.deleteUser(id);
      requireOk(error, "deleteUser");
    });
  }

  // Leftover verification for every fixture class
  await step("leftover.companies", async () => {
    if (!cleanup.companies.length) return;
    const { data, error } = await admin.from("companies").select("id").in("id", cleanup.companies);
    if (error) throw error;
    if (data?.length) throw new Error(`remaining=${data.length}`);
  });
  await step("leftover.knowledge", async () => {
    if (!cleanup.knowledgeIds.length) return;
    const { data, error } = await admin.from("knowledge_sources").select("id").in("id", cleanup.knowledgeIds);
    if (error) throw error;
    if (data?.length) throw new Error(`remaining=${data.length}`);
  });
  await step("leftover.conversations", async () => {
    if (!cleanup.conversationIds.length) return;
    const { data, error } = await admin.from("whatsapp_conversations").select("id").in("id", cleanup.conversationIds);
    if (error) throw error;
    if (data?.length) throw new Error(`remaining=${data.length}`);
  });
  await step("leftover.messages", async () => {
    if (!cleanup.messageIds.length) return;
    const { data, error } = await admin.from("whatsapp_messages").select("id").in("id", cleanup.messageIds);
    if (error) throw error;
    if (data?.length) throw new Error(`remaining=${data.length}`);
  });
  await step("leftover.statuses", async () => {
    if (!cleanup.statusIds.length) return;
    const { data, error } = await admin.from("whatsapp_delivery_statuses").select("id").in("id", cleanup.statusIds);
    if (error) throw error;
    if (data?.length) throw new Error(`remaining=${data.length}`);
  });
  await step("leftover.platform_admins", async () => {
    if (!cleanup.platformAdminIds.length) return;
    const { data, error } = await admin.from("platform_admins").select("user_id").in("user_id", cleanup.platformAdminIds);
    if (error) throw error;
    if (data?.length) throw new Error(`remaining=${data.length}`);
  });
  for (const path of cleanup.storagePaths) {
    await step(`leftover.storage:${path.split("/").pop()}`, async () => {
      const { data, error } = await admin.storage.from("company-knowledge").download(path);
      if (data) throw new Error("object still downloadable");
      if (!error) throw new Error("missing error while object absent expected");
      if (isNetworkOrServerError(error)) throw new Error(`network/server: ${error.message}`);
      if (!isStorageObjectNotFound(error)) {
        throw new Error(`cleanup leftover requires object-not-found, got: ${error.message}`);
      }
    });
  }
  for (const id of cleanup.users) {
    await step(`leftover.user:${id.slice(0, 8)}`, async () => {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error) {
        if (isNetworkOrServerError(error)) throw new Error(error.message);
        if (!isAuthUserNotFound(error)) {
          throw new Error(`cleanup leftover requires user-not-found, got: ${error.message}`);
        }
        return;
      }
      if (data?.user) throw new Error("user still exists");
    });
  }

  return errors;
}

async function main() {
  await proveDisposableLocalVelora();

  const ownerActive = await makeUser("ownerActive");
  const staffActive = await makeUser("staffActive");
  const disabledMember = await makeUser("disabled");
  const ownerSuspended = await makeUser("ownerSuspended");
  const staffSuspended = await makeUser("staffSuspended");
  const ownerOther = await makeUser("ownerOther");
  const ownerSetup = await makeUser("ownerSetup");
  const platformAdmin = await makeUser("platformAdmin");

  const companyActive = await createOwnerCompany(ownerActive, `A10 active ${stamp}`);
  await setCompanyStatus(companyActive.id, "active");
  const companySetup = await createOwnerCompany(ownerSetup, `A10 setup ${stamp}`);
  {
    const { data, error } = await admin.from("companies").select("status").eq("id", companySetup.id).single();
    requireOk(error, "verify setup");
    assert(data?.status === "setup", "setup status");
  }
  const companyOther = await createOwnerCompany(ownerOther, `A10 other ${stamp}`);
  await setCompanyStatus(companyOther.id, "active");
  const companySuspended = await createOwnerCompany(ownerSuspended, `A10 suspended ${stamp}`);
  await setCompanyStatus(companySuspended.id, "suspended");

  await insertMember({
    companyId: companyActive.id,
    userId: staffActive.userId,
    role: "staff",
    status: "active",
    memberName: "Staff Active",
  });
  await insertMember({
    companyId: companyActive.id,
    userId: disabledMember.userId,
    role: "staff",
    status: "disabled",
    memberName: "Disabled Member",
  });
  await insertMember({
    companyId: companySuspended.id,
    userId: staffSuspended.userId,
    role: "staff",
    status: "active",
    memberName: "Staff Suspended",
  });

  const { error: adminUpsertErr } = await admin.from("platform_admins").upsert({ user_id: platformAdmin.userId });
  requireOk(adminUpsertErr, "platform_admins upsert");
  cleanup.platformAdminIds.push(platformAdmin.userId);

  const knowledgeActive = await seedKnowledge(companyActive.id, ownerActive.userId, `active ${stamp}`);
  const knowledgeSetup = await seedKnowledge(companySetup.id, ownerSetup.userId, `setup ${stamp}`);
  const knowledgeSuspended = await seedKnowledge(companySuspended.id, ownerSuspended.userId, `suspended ${stamp}`);
  const storageActive = await seedStorageFile(ownerActive, companyActive.id, "act");
  const storageSuspended = await seedStorageFile(ownerSuspended, companySuspended.id, "sus");
  const storageSetup = await seedStorageFile(ownerSetup, companySetup.id, "set");
  const waActive = await seedWhatsapp(companyActive.id, "act");
  const waSuspended = await seedWhatsapp(companySuspended.id, "sus");
  const waSetup = await seedWhatsapp(companySetup.id, "set");

  /** @type {Array<{ id: string, run: () => Promise<void> }>} */
  const cases = [
    // Allowed proofs first (same fixtures used later for deny)
    {
      id: "allow.active.owner.knowledge",
      run: async () => {
        classifyRead("allow", await ownerActive.client.from("knowledge_sources").select("id").eq("id", knowledgeActive), "allow.active.owner.knowledge");
      },
    },
    {
      id: "allow.active.staff.knowledge",
      run: async () => {
        classifyRead("allow", await staffActive.client.from("knowledge_sources").select("id").eq("id", knowledgeActive), "allow.active.staff.knowledge");
      },
    },
    {
      id: "allow.active.owner.storage",
      run: async () => {
        const blob = await classifyStorageDownload("allow", ownerActive.client, storageActive.path, "allow.active.owner.storage");
        const text = await blob.text();
        assert(text.includes("name,price"), "storage payload");
      },
    },
    {
      id: "allow.active.staff.wa.conversation",
      run: async () => {
        classifyRead(
          "allow",
          await staffActive.client.from("whatsapp_conversations").select("id").eq("id", waActive.conversationId),
          "allow.active.staff.wa.conversation",
        );
      },
    },
    {
      id: "allow.active.staff.wa.message",
      run: async () => {
        classifyRead(
          "allow",
          await staffActive.client.from("whatsapp_messages").select("id").eq("id", waActive.messageId),
          "allow.active.staff.wa.message",
        );
      },
    },
    {
      id: "allow.active.staff.wa.status",
      run: async () => {
        classifyRead(
          "allow",
          await staffActive.client.from("whatsapp_delivery_statuses").select("id").eq("id", waActive.statusId),
          "allow.active.staff.wa.status",
        );
      },
    },
    {
      id: "allow.setup.owner.knowledge",
      run: async () => {
        classifyRead("allow", await ownerSetup.client.from("knowledge_sources").select("id").eq("id", knowledgeSetup), "allow.setup.owner.knowledge");
      },
    },
    {
      id: "allow.setup.owner.storage",
      run: async () => {
        await classifyStorageDownload("allow", ownerSetup.client, storageSetup.path, "allow.setup.owner.storage");
      },
    },
    {
      id: "allow.setup.owner.wa.message",
      run: async () => {
        classifyRead(
          "allow",
          await ownerSetup.client.from("whatsapp_messages").select("id").eq("id", waSetup.messageId),
          "allow.setup.owner.wa.message",
        );
      },
    },

    // Anonymous
    {
      id: "deny.anon.knowledge",
      run: async () => {
        classifyRead("deny", await anonClient.from("knowledge_sources").select("id").eq("id", knowledgeActive), "deny.anon.knowledge", "anon");
      },
    },
    {
      id: "deny.anon.storage",
      run: async () => {
        await classifyStorageDownload("deny", anonClient, storageActive.path, "deny.anon.storage", "anon");
      },
    },
    {
      id: "deny.anon.wa.conversation",
      run: async () => {
        classifyRead(
          "deny",
          await anonClient.from("whatsapp_conversations").select("id").eq("id", waActive.conversationId),
          "deny.anon.wa.conversation",
          "anon",
        );
      },
    },
    {
      id: "deny.anon.wa.message",
      run: async () => {
        classifyRead("deny", await anonClient.from("whatsapp_messages").select("id").eq("id", waActive.messageId), "deny.anon.wa.message", "anon");
      },
    },
    {
      id: "deny.anon.wa.status",
      run: async () => {
        classifyRead(
          "deny",
          await anonClient.from("whatsapp_delivery_statuses").select("id").eq("id", waActive.statusId),
          "deny.anon.wa.status",
          "anon",
        );
      },
    },

    // Disabled / other / suspended owner+staff — knowledge + storage + WhatsApp
    {
      id: "deny.disabled.knowledge",
      run: async () => {
        classifyRead("deny", await disabledMember.client.from("knowledge_sources").select("id").eq("id", knowledgeActive), "deny.disabled.knowledge");
      },
    },
    {
      id: "deny.disabled.storage",
      run: async () => {
        await classifyStorageDownload("deny", disabledMember.client, storageActive.path, "deny.disabled.storage");
      },
    },
    {
      id: "deny.disabled.wa.message",
      run: async () => {
        classifyRead(
          "deny",
          await disabledMember.client.from("whatsapp_messages").select("id").eq("id", waActive.messageId),
          "deny.disabled.wa.message",
        );
      },
    },
    {
      id: "deny.other.knowledge",
      run: async () => {
        classifyRead("deny", await ownerOther.client.from("knowledge_sources").select("id").eq("id", knowledgeActive), "deny.other.knowledge");
      },
    },
    {
      id: "deny.other.storage",
      run: async () => {
        await classifyStorageDownload("deny", ownerOther.client, storageActive.path, "deny.other.storage");
      },
    },
    {
      id: "deny.other.wa.conversation",
      run: async () => {
        classifyRead(
          "deny",
          await ownerOther.client.from("whatsapp_conversations").select("id").eq("id", waActive.conversationId),
          "deny.other.wa.conversation",
        );
      },
    },
    {
      id: "deny.suspended.owner.knowledge",
      run: async () => {
        classifyRead(
          "deny",
          await ownerSuspended.client.from("knowledge_sources").select("id").eq("id", knowledgeSuspended),
          "deny.suspended.owner.knowledge",
        );
      },
    },
    {
      id: "deny.suspended.owner.storage",
      run: async () => {
        await classifyStorageDownload("deny", ownerSuspended.client, storageSuspended.path, "deny.suspended.owner.storage");
      },
    },
    {
      id: "deny.suspended.owner.wa.message",
      run: async () => {
        classifyRead(
          "deny",
          await ownerSuspended.client.from("whatsapp_messages").select("id").eq("id", waSuspended.messageId),
          "deny.suspended.owner.wa.message",
        );
      },
    },
    {
      id: "deny.suspended.staff.knowledge",
      run: async () => {
        classifyRead(
          "deny",
          await staffSuspended.client.from("knowledge_sources").select("id").eq("id", knowledgeSuspended),
          "deny.suspended.staff.knowledge",
        );
      },
    },
    {
      id: "deny.suspended.staff.storage",
      run: async () => {
        await classifyStorageDownload("deny", staffSuspended.client, storageSuspended.path, "deny.suspended.staff.storage");
      },
    },
    {
      id: "deny.suspended.staff.wa.conversation",
      run: async () => {
        classifyRead(
          "deny",
          await staffSuspended.client.from("whatsapp_conversations").select("id").eq("id", waSuspended.conversationId),
          "deny.suspended.staff.wa.conversation",
        );
      },
    },
    {
      id: "deny.suspended.staff.wa.message",
      run: async () => {
        classifyRead(
          "deny",
          await staffSuspended.client.from("whatsapp_messages").select("id").eq("id", waSuspended.messageId),
          "deny.suspended.staff.wa.message",
        );
      },
    },
    {
      id: "deny.suspended.staff.wa.status",
      run: async () => {
        classifyRead(
          "deny",
          await staffSuspended.client.from("whatsapp_delivery_statuses").select("id").eq("id", waSuspended.statusId),
          "deny.suspended.staff.wa.status",
        );
      },
    },

    // Platform admin on suspended tenant
    {
      id: "allow.admin.suspended.knowledge",
      run: async () => {
        classifyRead(
          "allow",
          await platformAdmin.client.from("knowledge_sources").select("id").eq("id", knowledgeSuspended),
          "allow.admin.suspended.knowledge",
        );
      },
    },
    {
      id: "allow.admin.suspended.storage",
      run: async () => {
        await classifyStorageDownload("allow", platformAdmin.client, storageSuspended.path, "allow.admin.suspended.storage");
      },
    },
    {
      id: "allow.admin.suspended.wa.conversation",
      run: async () => {
        classifyRead(
          "allow",
          await platformAdmin.client.from("whatsapp_conversations").select("id").eq("id", waSuspended.conversationId),
          "allow.admin.suspended.wa.conversation",
        );
      },
    },
    {
      id: "allow.admin.suspended.wa.message",
      run: async () => {
        classifyRead(
          "allow",
          await platformAdmin.client.from("whatsapp_messages").select("id").eq("id", waSuspended.messageId),
          "allow.admin.suspended.wa.message",
        );
      },
    },
    {
      id: "allow.admin.suspended.wa.status",
      run: async () => {
        classifyRead(
          "allow",
          await platformAdmin.client.from("whatsapp_delivery_statuses").select("id").eq("id", waSuspended.statusId),
          "allow.admin.suspended.wa.status",
        );
      },
    },

    // Same-session suspend / reactivate for knowledge + storage + WhatsApp
    {
      id: "session.suspend.then.restore",
      run: async () => {
        await setCompanyStatus(companyActive.id, "suspended");
        classifyRead(
          "deny",
          await staffActive.client.from("knowledge_sources").select("id").eq("id", knowledgeActive),
          "session.suspend.knowledge",
        );
        await classifyStorageDownload("deny", staffActive.client, storageActive.path, "session.suspend.storage");
        classifyRead(
          "deny",
          await staffActive.client.from("whatsapp_messages").select("id").eq("id", waActive.messageId),
          "session.suspend.wa.message",
        );
        await setCompanyStatus(companyActive.id, "active");
        classifyRead(
          "allow",
          await staffActive.client.from("knowledge_sources").select("id").eq("id", knowledgeActive),
          "session.restore.knowledge",
        );
        await classifyStorageDownload("allow", staffActive.client, storageActive.path, "session.restore.storage");
        classifyRead(
          "allow",
          await staffActive.client.from("whatsapp_messages").select("id").eq("id", waActive.messageId),
          "session.restore.wa.message",
        );
      },
    },
  ];

  console.log("COVERAGE_TABLE");
  for (const item of cases) console.log(`- ${item.id}`);

  for (const item of cases) {
    await item.run();
    pass(item.id);
  }

  console.log(passed.map((id) => `PASS ${id}`).join("\n"));
  console.log(`CASES_OK count=${passed.length}`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  let caseFailed = false;
  try {
    await main();
  } catch (err) {
    caseFailed = true;
    console.error("FAIL", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    const cleanupErrors = await cleanupAll();
    if (cleanupErrors.length) {
      console.error("CLEANUP_ISSUES");
      for (const item of cleanupErrors) console.error(`- ${item}`);
      process.exitCode = 1;
    } else if (!caseFailed) {
      console.log("CLEANUP ok");
      console.log("OK VEL-A10-01 all cases passed and cleanup verified");
    } else {
      console.log("CLEANUP ok");
    }
  }
}
