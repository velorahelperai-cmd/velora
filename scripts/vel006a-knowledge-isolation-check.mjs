/**
 * VEL-006A: knowledge isolation + real Storage upload/download/cleanup.
 * Requires SUPABASE_SERVICE_ROLE_KEY. Exit 2 = SKIP.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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
  console.error("SKIP: service role missing — knowledge isolation/storage not exercised end-to-end");
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
  const email = `vel006a.${label}.${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: label },
  });
  if (error || !data.user) throw new Error(error?.message ?? "createUser");
  cleanupUsers.push(data.user.id);
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signErr } = await client.auth.signInWithPassword({ email, password });
  if (signErr) throw new Error(signErr.message);
  return { email, userId: data.user.id, client };
}

try {
  const ownerA = await makeUser("ownerA");
  const ownerB = await makeUser("ownerB");
  const staffA = await makeUser("staffA");

  const companyA = (await ownerA.client.rpc("upsert_owner_company", {
    p_display_name: `Know A ${stamp}`,
    p_hours: "9-5",
    p_member_name: "Owner A",
  })).data;
  const companyB = (await ownerB.client.rpc("upsert_owner_company", {
    p_display_name: `Know B ${stamp}`,
    p_hours: "9-5",
    p_member_name: "Owner B",
  })).data;
  assert(companyA?.id && companyB?.id, "companies");

  const { error: staffMemErr } = await admin.from("company_members").insert({
    company_id: companyA.id,
    user_id: staffA.userId,
    role: "staff",
    status: "active",
    member_name: "Staff A",
  });
  assert(!staffMemErr, `staff membership: ${staffMemErr?.message}`);

  const { data: textA, error: textErr } = await ownerA.client.from("knowledge_sources").insert({
    company_id: companyA.id,
    kind: "text",
    title: "Hours A",
    content: "Open daily",
    status: "ready",
    created_by: ownerA.userId,
  }).select("id").single();
  assert(!textErr && textA?.id, `owner A insert: ${textErr?.message}`);

  const { data: textB, error: textBErr } = await ownerB.client.from("knowledge_sources").insert({
    company_id: companyB.id,
    kind: "text",
    title: "Hours B",
    content: "Closed",
    status: "ready",
    created_by: ownerB.userId,
  }).select("id").single();
  assert(!textBErr && textB?.id, `owner B insert: ${textBErr?.message}`);

  const { data: staffRead } = await staffA.client
    .from("knowledge_sources")
    .select("id, company_id")
    .eq("company_id", companyA.id);
  assert((staffRead ?? []).length >= 1, "staff can read own company knowledge");

  const { data: staffCross } = await staffA.client
    .from("knowledge_sources")
    .select("id")
    .eq("company_id", companyB.id);
  assert(!(staffCross ?? []).length, "staff cannot read other company");

  const { error: staffWrite } = await staffA.client.from("knowledge_sources").insert({
    company_id: companyA.id,
    kind: "text",
    title: "Staff write",
    content: "nope",
    status: "ready",
    created_by: staffA.userId,
  });
  assert(staffWrite, "staff write must fail");

  const { data: crossRead } = await ownerA.client
    .from("knowledge_sources")
    .select("id")
    .eq("company_id", companyB.id);
  assert(!(crossRead ?? []).length, "owner A cannot read company B knowledge");

  // Real storage: upload CSV (>1KiB), download, cross-company deny, cleanup
  const { data: fileRow, error: fileRowErr } = await ownerA.client.from("knowledge_sources").insert({
    company_id: companyA.id,
    kind: "file",
    title: "menu.csv",
    content: "",
    file_name: "menu.csv",
    content_type: "text/csv",
    byte_size: 2048,
    status: "failed",
    created_by: ownerA.userId,
  }).select("id").single();
  assert(!fileRowErr && fileRow?.id, `file row: ${fileRowErr?.message}`);

  const pathA = `${companyA.id}/${fileRow.id}/menu.csv`;
  cleanupPaths.push(pathA);
  const payload = "name,price\n" + "item,1.5\n".repeat(120);
  assert(payload.length > 1024, "payload must exceed 1KiB for meaningful storage test");

  const { error: upA } = await ownerA.client.storage.from("company-knowledge").upload(pathA, payload, {
    contentType: "text/csv",
    upsert: false,
  });
  assert(!upA, `storage upload must succeed: ${upA?.message}`);

  const { error: linkErr } = await ownerA.client.from("knowledge_sources").update({
    storage_path: pathA,
    status: "stored",
  }).eq("id", fileRow.id);
  assert(!linkErr, `link path: ${linkErr?.message}`);

  const { data: downloaded, error: dlErr } = await ownerA.client.storage.from("company-knowledge").download(pathA);
  assert(!dlErr && downloaded, `storage download must succeed: ${dlErr?.message}`);
  const text = await downloaded.text();
  assert(text.includes("name,price"), "downloaded content mismatch");

  const { data: listB, error: listBErr } = await ownerB.client.storage.from("company-knowledge").list(companyA.id);
  assert(!listBErr, `list B: ${listBErr?.message}`);
  assert(!(listB ?? []).length, "owner B cannot list company A storage prefix");

  const { data: crossDl, error: crossDlErr } = await ownerB.client.storage.from("company-knowledge").download(pathA);
  assert(crossDlErr || !crossDl, "owner B must not download company A object");

  const { error: staffUp } = await staffA.client.storage.from("company-knowledge").upload(
    `${companyA.id}/${fileRow.id}/staff.csv`,
    "a,b\n1,2\n",
    { contentType: "text/csv", upsert: false },
  );
  assert(staffUp, "staff storage write must fail");

  const { error: rmErr } = await ownerA.client.storage.from("company-knowledge").remove([pathA]);
  assert(!rmErr, `cleanup remove: ${rmErr?.message}`);
  cleanupPaths.length = 0;

  const { data: afterRm, error: afterRmErr } = await ownerA.client.storage.from("company-knowledge").download(pathA);
  assert(afterRmErr || !afterRm, "object must be gone after cleanup");

  console.log("PASS: knowledge isolation + storage upload/download/cleanup");
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
