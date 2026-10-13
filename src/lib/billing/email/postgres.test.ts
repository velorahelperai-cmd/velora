import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const exec = promisify(execFile), name = `velora-billing-email-${randomUUID().slice(0, 8)}`;
let verifiedId: string | null = null;
async function sql(input: string): Promise<string> {
  if (!verifiedId) throw Error("EMAIL_FIXTURE_NOT_VERIFIED");
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", "-u", "postgres", verifiedId!, "psql", "-X", "-U", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", error = ""; child.stdout.on("data", value => { out += value; }); child.stderr.on("data", value => { error += value; });
    child.on("error", reject); child.on("close", code => { if (code === 0) resolve(out.trim()); else reject(Error(error)); });
    child.stdin.end(`set statement_timeout='10s';set lock_timeout='2s';${input}`);
  });
}
describe.runIf(process.env.BILLING_EMAIL_POSTGRES_TESTS === "1")("native private subscription email SQL", () => {
  beforeAll(async () => {
    const started = await exec("docker", ["run", "-d", "--name", name, "--label", "velora.task=billing-email-fixture", "--network", "none", "--log-driver", "none", "--tmpfs", "/var/lib/postgresql/data:rw", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17.6-alpine"]);
    const inspected = JSON.parse((await exec("docker", ["inspect", started.stdout.trim()])).stdout)[0];
    if (inspected.Name !== `/${name}` || inspected.Config.Image !== "postgres:17.6-alpine" || inspected.Config.Labels?.["velora.task"] !== "billing-email-fixture"
      || inspected.HostConfig.NetworkMode !== "none" || inspected.Mounts.some((m: { Type: string }) => m.Type !== "tmpfs") || Object.keys(inspected.HostConfig.PortBindings ?? {}).length) throw Error("UNSAFE_EMAIL_FIXTURE");
    verifiedId = inspected.Id;
    for (let i = 0; i < 60; i++) { try { await exec("docker", ["exec", verifiedId!, "pg_isready", "-U", "postgres"]); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
    await sql(readFileSync("src/lib/billing/email/postgres-fixture.sql", "utf8"));
    const source = readFileSync("supabase/migrations/20261008100000_vel_billing_legacy_evidence_upgrade_acceptance.sql", "utf8").replace(/--[^\r\n]*/g, "");
    const views = source.match(/create view private\.billing_(?:verified_collection_history|proven_entitlement_grants) as[\s\S]*?;/g);
    expect(views).toHaveLength(2); await sql(views!.join("\n"));
    await sql(readFileSync("supabase/migrations/20261013073443_billing_subscription_email_outbox.sql", "utf8"));
  }, 30000);
  afterAll(async () => { if (verifiedId) await exec("docker", ["rm", "-f", verifiedId]); });
  it("queues one verified Live receipt at commit and excludes Test/unverified owners", async () => {
    await sql("select email_fixture(1);select email_fixture(2,'test');select email_fixture(3,'live',false);");
    expect(await sql("select count(*) from private.billing_subscription_email_outbox;")).toBe("1");
    expect(await sql("select count(*) from private.billing_subscription_email_outbox q join billing_orders o on o.id=q.order_id where o.provider_environment<>'live';")).toBe("0");
  });
  it("deduplicates another settled receipt projection and does not expose private recipient data", async () => {
    await sql("insert into billing_settlement_outcomes select md5('duplicate-outcome')::uuid,company_id,order_id,payment_attempt_id,provider,provider_account_ref,provider_environment,provider_transaction_id,provider_event_id,entitlement_application_id,outcome,evidence_marker,authenticity_method,applied_paid_through from billing_settlement_outcomes where entitlement_application_id=md5('receipt-1')::uuid;");
    expect(await sql("select count(*) from private.billing_subscription_email_outbox;")).toBe("1");
    for (const role of ["anon", "authenticated", "service_role"]) await expect(sql(`set role ${role};select recipient_email from private.billing_subscription_email_outbox;`)).rejects.toThrow(/permission denied/);
    await expect(sql("set role authenticated;select billing_claim_subscription_email();")).rejects.toThrow(/permission denied/);
  });
  it("permanently claims once, refuses wrong claim token, and never reclaims an ambiguous result", async () => {
    const result = JSON.parse(await sql("set role service_role;select billing_claim_subscription_email();"));
    expect(result.claim.recipient).toBe("synthetic1@example.test");
    expect(JSON.parse(await sql("set role service_role;select billing_claim_subscription_email();")).claim).toBeNull();
    expect(await sql(`set role service_role;select billing_finish_subscription_email('${result.claim.id}','00000000-0000-4000-8000-000000000000','accepted','provider-id','RESEND_ACCEPTED');`)).toBe("f");
    expect(await sql(`set role service_role;select billing_finish_subscription_email('${result.claim.id}','${result.claim.claimToken}','reconciliation_required',null,'RESEND_OUTCOME_UNKNOWN');`)).toBe("t");
    expect(JSON.parse(await sql("set role service_role;select billing_claim_subscription_email();")).claim).toBeNull();
    await expect(sql("update private.billing_subscription_email_outbox set state='queued',claim_token=null,claimed_at=null;")).rejects.toThrow(/EMAIL_RECEIPT_IMMUTABLE/);
  });
  it("blocks changed owner recipients before handing work to the provider", async () => {
    await sql("select email_fixture(4);update auth.users set email='changed@example.test' where id=md5('owner-4')::uuid;");
    expect(JSON.parse(await sql("set role service_role;select billing_claim_subscription_email();")).claim).toBeNull();
    expect(await sql("select state from private.billing_subscription_email_outbox where id=md5('receipt-4')::uuid;")).toBe("blocked");
  });
  it("enforces authorized admin order scope and reports acceptance separately from delivery", async () => {
    await sql("select email_fixture(5);");const claimed = JSON.parse(await sql("set role service_role;select billing_claim_subscription_email();"));
    await sql(`set role service_role;select billing_finish_subscription_email('${claimed.claim.id}','${claimed.claim.claimToken}','accepted','provider-email-id','RESEND_ACCEPTED');`);
    const c = await sql("select company_id from private.billing_subscription_email_outbox where id=md5('receipt-5')::uuid;"), o = claimed.claim.orderId;
    expect(JSON.parse(await sql(`set role authenticated;select billing_admin_read_subscription_email('${c}','${o}');`)).code).toBe("forbidden");
    const r = JSON.parse(await sql(`set role authenticated;set test.email_admin='true';select billing_admin_read_subscription_email('${c}','${o}');`));
    expect(r.email.state).toBe("accepted"); expect(r.email.delivered).toBe(false); expect(JSON.stringify(r)).not.toContain("synthetic5");
    expect(JSON.parse(await sql(`set role authenticated;set test.email_admin='true';select billing_admin_read_subscription_email(md5('company-1')::uuid,'${o}');`)).code).toBe("not_found");
  });
  it("normalizes a valid padded company name and skips nonfinite email dates without aborting settlement", async () => {
    await sql("begin;select email_fixture(6);update companies set display_name=repeat(' ',10)||repeat('x',120)||repeat(' ',10) where id=md5('company-6')::uuid;commit;");
    expect(await sql("select length(company_name) from private.billing_subscription_email_outbox where id=md5('receipt-6')::uuid;")).toBe("120");
    await sql("begin;select email_fixture(7);update billing_subscriptions set paid_through='infinity' where id=md5('sub-7')::uuid;update billing_entitlement_applications set applied_paid_through='infinity' where id=md5('receipt-7')::uuid;update billing_settlement_outcomes set applied_paid_through='infinity' where entitlement_application_id=md5('receipt-7')::uuid;commit;");
    expect(await sql("select count(*) from private.billing_subscription_email_outbox where id=md5('receipt-7')::uuid;")).toBe("0");
  });
});
