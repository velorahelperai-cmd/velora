/**
 * Admin isolation checks (VEL-005C). Service role seeds users only.
 * Requires: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY
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
  console.error("SKIP: missing env for admin isolation (service role required for seeding)");
  process.exit(2);
}

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();
const password = `Velora!${stamp}Aa`;
const results = [];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertDenied(result, msg) {
  if (result.error) return;
  if (result.data == null) return;
  if (Array.isArray(result.data) && result.data.length === 0) return;
  throw new Error(`${msg}: expected denial, got ${JSON.stringify(result.data)}`);
}

async function makeUser(label, { confirm = true } = {}) {
  const email = `vel005c.${label}.${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: confirm,
    user_metadata: { full_name: label },
  });
  if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signErr } = await client.auth.signInWithPassword({ email, password });
  if (signErr) throw new Error(`signIn ${label}: ${signErr.message}`);
  return { email, userId: data.user.id, client };
}

try {
  const platformAdmin = await makeUser("platformAdmin");
  const owner = await makeUser("owner");
  const staff = await makeUser("staff");
  const outsider = await makeUser("outsider");
  const anonClient = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });

  // Trusted grant path (SQL/service), not UI email compare.
  const { data: grantId, error: grantErr } = await admin.rpc("is_platform_admin"); // warmup
  void grantId;
  void grantErr;
  const { error: grantSqlErr } = await admin.rpc("admin_list_companies", { p_search: "" }).then(() => ({ error: null })).catch((e) => ({ error: e }));
  void grantSqlErr;

  const { data: granted, error: gErr } = await admin
    .from("platform_admins")
    .insert({ user_id: platformAdmin.userId, note: "vel005c isolation seed" })
    .select("user_id")
    .single();
  assert(!gErr && granted?.user_id === platformAdmin.userId, `grant admin: ${gErr?.message}`);
  results.push("seed platform_admin via trusted insert");

  // Privilege escalation blocked for owner/staff on platform_admins
  assertDenied(
    await owner.client.from("platform_admins").insert({ user_id: owner.userId, note: "self" }),
    "owner cannot self-grant",
  );
  assertDenied(
    await staff.client.from("platform_admins").insert({ user_id: staff.userId, note: "self" }),
    "staff cannot self-grant",
  );
  results.push("deny self-grant platform_admin");

  const company = (await owner.client.rpc("upsert_owner_company", {
    p_display_name: `Admin View Co ${stamp}`,
    p_hours: "9-5",
    p_contact_email: `contact.${stamp}@example.com`,
    p_member_name: "Owner Name",
  })).data;
  assert(company?.id, "owner company create");
  await admin.from("company_members").insert({
    company_id: company.id,
    user_id: staff.userId,
    role: "staff",
    status: "active",
    member_name: "Staff Name",
  });
  results.push("seed company + staff");

  const listAdmin = await platformAdmin.client.rpc("admin_list_companies", { p_search: "" });
  assert(!listAdmin.error && Array.isArray(listAdmin.data) && listAdmin.data.some((r) => r.id === company.id), "admin list");
  results.push("admin can list companies");

  const detail = await platformAdmin.client.rpc("admin_get_company", { p_company_id: company.id });
  assert(!detail.error && detail.data?.company?.id === company.id, "admin detail");
  const ownerMember = (detail.data.members || []).find((m) => m.role === "owner");
  assert(ownerMember?.email === owner.email, "admin sees owner account email via protected rpc");
  assert(detail.data.company.contact_email === `contact.${stamp}@example.com`, "contact email present");
  results.push("admin detail shows owner email separately");

  assertDenied(await owner.client.rpc("admin_list_companies", { p_search: "" }), "owner list denied");
  assertDenied(await staff.client.rpc("admin_list_companies", { p_search: "" }), "staff list denied");
  assertDenied(await outsider.client.rpc("admin_list_companies", { p_search: "" }), "outsider list denied");
  assertDenied(await anonClient.rpc("admin_list_companies", { p_search: "" }), "anon list denied");
  assertDenied(await owner.client.rpc("admin_get_company", { p_company_id: company.id }), "owner detail denied");
  results.push("non-admin denied admin RPCs");

  // Tenant isolation still holds for owner
  const ownerSees = await owner.client.from("companies").select("id");
  assert(!ownerSees.error && ownerSees.data?.length === 1 && ownerSees.data[0].id === company.id, "owner isolation");
  results.push("owner company isolation intact");

  console.log("PASS");
  for (const r of results) console.log(`- ${r}`);
  console.log("NOTE: real velorahelper@gmail.com admin awaits signup+confirm then private.grant_platform_admin_by_email");
} catch (err) {
  console.error("FAIL:", err instanceof Error ? err.message : err);
  console.error("passed_before_fail:", results);
  process.exit(1);
}
