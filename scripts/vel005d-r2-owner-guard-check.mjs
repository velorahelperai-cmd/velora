/**
 * Verifies admin_set_member_status protects owner and still allows staff toggle.
 * Requires service role + publishable key.
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
  console.error("SKIP: service role missing — owner RPC guard not exercised end-to-end");
  process.exit(2);
}

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();
const password = `Velora!${stamp}Aa`;

async function makeUser(label) {
  const email = `vel005dr2.${label}.${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: label },
  });
  if (error || !data.user) throw new Error(error?.message ?? "createUser");
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signErr } = await client.auth.signInWithPassword({ email, password });
  if (signErr) throw new Error(signErr.message);
  return { email, userId: data.user.id, client };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const results = [];
try {
  const platformAdmin = await makeUser("admin");
  const owner = await makeUser("owner");
  const staff = await makeUser("staff");

  await admin.from("platform_admins").insert({ user_id: platformAdmin.userId, note: "r2 guard test" });
  const company = (await owner.client.rpc("upsert_owner_company", {
    p_display_name: `Guard Co ${stamp}`,
    p_hours: "9-5",
    p_member_name: "Owner",
  })).data;
  assert(company?.id, "company");
  await admin.from("company_members").insert({
    company_id: company.id,
    user_id: staff.userId,
    role: "staff",
    status: "active",
    member_name: "Staff",
  });

  const denyDisable = await platformAdmin.client.rpc("admin_set_member_status", {
    p_company_id: company.id,
    p_user_id: owner.userId,
    p_status: "disabled",
  });
  assert(denyDisable.error, `owner disable must fail: ${denyDisable.error?.message}`);
  results.push("deny owner disable");

  const denyRole = await platformAdmin.client.rpc("admin_set_member_status", {
    p_company_id: company.id,
    p_user_id: owner.userId,
    p_status: "active",
    p_role: "staff",
  });
  assert(denyRole.error, `owner demote must fail: ${denyRole.error?.message}`);
  results.push("deny owner demote");

  const staffOff = await platformAdmin.client.rpc("admin_set_member_status", {
    p_company_id: company.id,
    p_user_id: staff.userId,
    p_status: "disabled",
  });
  assert(!staffOff.error && staffOff.data?.status === "disabled", "staff disable");
  results.push("staff disable ok");

  const staffOn = await platformAdmin.client.rpc("admin_set_member_status", {
    p_company_id: company.id,
    p_user_id: staff.userId,
    p_status: "active",
  });
  assert(!staffOn.error && staffOn.data?.status === "active", "staff enable");
  results.push("staff enable ok");

  const ownerRow = await admin
    .from("company_members")
    .select("role, status")
    .eq("company_id", company.id)
    .eq("user_id", owner.userId)
    .single();
  assert(ownerRow.data?.role === "owner" && ownerRow.data?.status === "active", "owner unchanged");
  results.push("owner intact");

  console.log("PASS");
  for (const r of results) console.log(`- ${r}`);
} catch (err) {
  console.error("FAIL:", err instanceof Error ? err.message : err);
  console.error("passed_before_fail:", results);
  process.exit(1);
}
