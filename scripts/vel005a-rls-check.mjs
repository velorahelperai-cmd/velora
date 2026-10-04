/**
 * RLS isolation checks against cloud Supabase using user JWTs (not service_role for assertions).
 * Requires: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY
 * Service role is used only to confirm emails and seed memberships for negative cases.
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
  console.error("Need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();
const password = `Velora!${stamp}Aa`;

async function makeUser(label) {
  const email = `vel005a.${label}.${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: label },
  });
  if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signErr } = await client.auth.signInWithPassword({ email, password });
  if (signErr) throw new Error(`signIn ${label}: ${signErr.message}`);
  return { email, password, userId: data.user.id, client };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Denial must be explicit (error or empty rows). Transport/network failures fail the suite. */
function assertDenied(result, msg) {
  const { data, error } = result;
  if (error) {
    // Explicit permission / RLS / RPC rejection
    return;
  }
  if (Array.isArray(data) && data.length === 0) return;
  if (data == null) return;
  throw new Error(`${msg}: expected denial, got data=${JSON.stringify(data)}`);
}

function assertOk(result, msg) {
  if (result.error) throw new Error(`${msg}: ${result.error.message}`);
  return result.data;
}

const results = [];

try {
  const ownerA = await makeUser("ownerA");
  const ownerB = await makeUser("ownerB");
  const staffA = await makeUser("staffA");
  const outsider = await makeUser("outsider");
  const anonClient = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });

  const companyA = assertOk(
    await ownerA.client.rpc("upsert_owner_company", {
      p_display_name: `Company A ${stamp}`,
      p_hours: "9-5",
      p_member_name: "Owner A",
    }),
    "create A",
  );
  assert(companyA?.id, "create A missing id");
  results.push("ownerA create company");

  const companyB = assertOk(
    await ownerB.client.rpc("upsert_owner_company", {
      p_display_name: `Company B ${stamp}`,
      p_hours: "10-6",
      p_member_name: "Owner B",
    }),
    "create B",
  );
  assert(companyB?.id, "create B missing id");
  results.push("ownerB create company");

  // Concurrent upsert: same user, same company + one owner membership
  const [c1, c2] = await Promise.all([
    ownerA.client.rpc("upsert_owner_company", {
      p_display_name: `Company A concurrent ${stamp}`,
      p_hours: "9-5",
      p_member_name: "Owner A",
    }),
    ownerA.client.rpc("upsert_owner_company", {
      p_display_name: `Company A concurrent ${stamp}`,
      p_hours: "9-5",
      p_member_name: "Owner A",
    }),
  ]);
  assert(!c1.error && !c2.error, `concurrent upsert transport: ${c1.error?.message ?? c2.error?.message}`);
  assert(c1.data?.id && c2.data?.id && c1.data.id === c2.data.id, "concurrent upsert must return same company");
  const { data: ownerMemberships, error: memErr } = await admin
    .from("company_members")
    .select("company_id, role, status")
    .eq("user_id", ownerA.userId)
    .eq("role", "owner")
    .eq("status", "active");
  assert(!memErr, `membership count query: ${memErr?.message}`);
  assert(ownerMemberships?.length === 1 && ownerMemberships[0].company_id === c1.data.id, "one active owner membership");
  results.push("concurrent upsert same company + one owner");

  const { error: staffInsErr } = await admin.from("company_members").insert({
    company_id: companyA.id,
    user_id: staffA.userId,
    role: "staff",
    status: "active",
    member_name: "Staff A",
  });
  assert(!staffInsErr, `staff seed: ${staffInsErr?.message}`);

  const aSees = assertOk(await ownerA.client.from("companies").select("id, display_name"), "ownerA select");
  assert(aSees?.length === 1 && aSees[0].id === companyA.id, "ownerA must see only A");
  results.push("ownerA isolation read");

  const bSees = assertOk(await ownerB.client.from("companies").select("id"), "ownerB select");
  assert(bSees?.length === 1 && bSees[0].id === companyB.id, "ownerB must see only B");
  results.push("ownerB isolation read");

  const cross = assertOk(await ownerA.client.from("companies").select("id").eq("id", companyB.id), "cross select");
  assert(!cross?.length, "ownerA must not read company B by id");
  results.push("deny cross-company read");

  // Owner can update own company
  const renamed = `Company A renamed ${stamp}`;
  const ownerUpdate = assertOk(
    await ownerA.client.from("companies").update({ display_name: renamed, hours: "8-4" }).eq("id", companyA.id).select("id, display_name, hours"),
    "ownerA update own",
  );
  assert(ownerUpdate?.length === 1 && ownerUpdate[0].display_name === renamed, "owner update applied");
  results.push("owner update own company");

  // Cross-company update denied; B unchanged
  const beforeB = assertOk(
    await admin.from("companies").select("display_name, hours, status, created_by").eq("id", companyB.id).single(),
    "admin read B before",
  );
  const crossUpdate = await ownerA.client
    .from("companies")
    .update({ display_name: "Hijacked B" })
    .eq("id", companyB.id)
    .select();
  assertDenied(crossUpdate, "ownerA update company B");
  const afterB = assertOk(
    await admin.from("companies").select("display_name, hours, status, created_by").eq("id", companyB.id).single(),
    "admin read B after",
  );
  assert(
    afterB.display_name === beforeB.display_name && afterB.hours === beforeB.hours,
    "company B must be unchanged after cross update",
  );
  results.push("deny cross-company update + data intact");

  // Anonymous denied
  assertDenied(await anonClient.from("companies").select("id"), "anon select companies");
  assertDenied(
    await anonClient.rpc("upsert_owner_company", { p_display_name: "Anon Co", p_hours: "1-2" }),
    "anon upsert",
  );
  results.push("anon denied select + upsert");

  // Immutable columns: status / created_by
  const statusAttempt = await ownerA.client.from("companies").update({ status: "active" }).eq("id", companyA.id).select();
  assertDenied(statusAttempt, "owner cannot change status via client update");
  const createdByAttempt = await ownerA.client
    .from("companies")
    .update({ created_by: ownerB.userId })
    .eq("id", companyA.id)
    .select();
  assertDenied(createdByAttempt, "owner cannot change created_by");
  const guarded = assertOk(
    await admin.from("companies").select("status, created_by").eq("id", companyA.id).single(),
    "admin read guarded cols",
  );
  assert(guarded.status === companyA.status, "status unchanged");
  assert(guarded.created_by === ownerA.userId, "created_by unchanged");
  results.push("immutable status + created_by");

  // Membership elevation denied
  const elev = await staffA.client
    .from("company_members")
    .update({ role: "owner" })
    .eq("company_id", companyA.id)
    .eq("user_id", staffA.userId)
    .select();
  assertDenied(elev, "staff elevate role");
  const roleCheck = assertOk(
    await admin.from("company_members").select("role, status").eq("company_id", companyA.id).eq("user_id", staffA.userId).single(),
    "admin role check",
  );
  assert(roleCheck.role === "staff", "staff role unchanged");
  results.push("deny membership role change");

  const staffSees = assertOk(await staffA.client.from("companies").select("id"), "staff select");
  assert(staffSees?.length === 1 && staffSees[0].id === companyA.id, "staffA sees A");
  const staffUpdate = await staffA.client.from("companies").update({ display_name: "Hacked" }).eq("id", companyA.id).select();
  assertDenied(staffUpdate, "staff update company");
  const afterStaff = assertOk(
    await ownerA.client.from("companies").select("display_name").eq("id", companyA.id).single(),
    "ownerA re-read after staff",
  );
  assert(afterStaff?.display_name === renamed, "company name unchanged after staff update attempt");
  results.push("staff cannot update company");

  const outSees = assertOk(await outsider.client.from("companies").select("id"), "outsider select");
  assert(!outSees?.length, "outsider sees none");
  results.push("outsider denied");

  await admin.from("company_members").update({ status: "disabled" }).eq("company_id", companyA.id).eq("user_id", staffA.userId);
  const disabledSees = assertOk(await staffA.client.from("companies").select("id"), "disabled select");
  assert(!disabledSees?.length, "disabled membership sees none");
  results.push("disabled membership denied");

  console.log("PASS");
  for (const r of results) console.log(`- ${r}`);
  console.log("DEFERRED: browser A→logout→B (needs Playwright + live app session)");
} catch (err) {
  console.error("FAIL:", err instanceof Error ? err.message : err);
  console.error("passed_before_fail:", results);
  process.exit(1);
}
