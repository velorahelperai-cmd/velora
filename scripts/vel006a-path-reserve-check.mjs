/**
 * VEL-006A-FIX-R2: prove storage_path is durable before upload, and survives
 * simulated DB finalize + cleanup failure (reload keeps path + honest status).
 * Requires SUPABASE_SERVICE_ROLE_KEY. Exit 2 = SKIP.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnvLocal();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !service) {
  console.error("SKIP: service role missing — path reserve recovery not exercised");
  process.exit(2);
}

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();
const password = `Velora!${stamp}Aa`;
const cleanupUsers = [];
const cleanupPaths = [];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function makeUser(label) {
  const email = `vel006ar2.${label}.${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "createUser");
  cleanupUsers.push(data.user.id);
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signErr } = await client.auth.signInWithPassword({ email, password });
  if (signErr) throw new Error(signErr.message);
  return { userId: data.user.id, client };
}

try {
  const owner = await makeUser("owner");
  const company = (await owner.client.rpc("upsert_owner_company", {
    p_display_name: `Reserve ${stamp}`,
    p_hours: "9-5",
    p_member_name: "Owner",
  })).data;
  assert(company?.id, "company");

  const sourceId = randomUUID();
  const fileName = "recover.csv";
  const path = `${company.id}/${sourceId}/${fileName}`;

  // Mirror production: insert → reserve path → upload → (skip stored) → cleanup fails.
  const { error: insErr } = await owner.client.from("knowledge_sources").insert({
    id: sourceId,
    company_id: company.id,
    kind: "file",
    title: fileName,
    content: "",
    file_name: fileName,
    content_type: "text/csv",
    byte_size: 32,
    status: "draft",
    created_by: owner.userId,
  });
  assert(!insErr, `insert: ${insErr?.message}`);

  const { data: reserved, error: resErr } = await owner.client
    .from("knowledge_sources")
    .update({ storage_path: path, status: "draft" })
    .eq("id", sourceId)
    .select("id, storage_path, status")
    .single();
  assert(!resErr && reserved?.storage_path === path, `reserve path before upload: ${resErr?.message}`);

  const payload = "a,b\n1,2\n";
  const { error: upErr } = await owner.client.storage.from("company-knowledge").upload(path, payload, {
    contentType: "text/csv",
    upsert: false,
  });
  assert(!upErr, `upload: ${upErr?.message}`);
  cleanupPaths.push(path);

  // Deliberate finalize failure: do not set status=stored.
  // Deliberate cleanup failure: do not remove object; mark failed WHILE KEEPING path.
  const { data: failedRow, error: failErr } = await owner.client
    .from("knowledge_sources")
    .update({ status: "failed" })
    .eq("id", sourceId)
    .select("id, storage_path, status")
    .single();
  assert(!failErr, `mark failed: ${failErr?.message}`);
  assert(failedRow.storage_path === path, "path must remain after finalize/cleanup failure");
  assert(failedRow.status === "failed", "status must be honest failed");

  // Reload (fresh read) must still see path — not response-only.
  const { data: reloaded, error: reloadErr } = await owner.client
    .from("knowledge_sources")
    .select("id, storage_path, status")
    .eq("id", sourceId)
    .single();
  assert(!reloadErr, `reload: ${reloadErr?.message}`);
  assert(reloaded.storage_path === path, "reloaded row lost storage_path");
  assert(reloaded.status === "failed", "reloaded status not failed");

  const { data: listed } = await owner.client.storage
    .from("company-knowledge")
    .list(`${company.id}/${sourceId}`);
  assert((listed ?? []).some((o) => o.name === fileName), "object still present for recovery");

  console.log("PASS: path reserved before upload; survives finalize+cleanup failure on reload");
} catch (e) {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  for (const path of cleanupPaths) {
    await admin.storage.from("company-knowledge").remove([path]).catch(() => {});
  }
  for (const id of cleanupUsers) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}
