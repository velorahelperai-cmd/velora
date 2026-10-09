// TEST ONLY: two independent-session company-lock races in the verified isolated DB.
// Run after fixtures.sql and the forward staff-paid migration. No provider calls.
// Direct execution: node scripts/whatsapp-integration/staff-paid-concurrency.mjs
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sql, rows, lit, session, verify } from "./postgres.mjs";

const assert = (ok, code) => { if (!ok) throw Error(code); };
const delay = ms => new Promise(done => setTimeout(done, ms));
const json = output => JSON.parse(output.split(/\r?\n/).find(line => line.startsWith("{")));
const failures = new Set([
  "STAFF_PAID_FIXTURE_SOURCE_CHANGED", "STAFF_PAID_FIXTURE_NOT_CURRENT", "STAFF_PAID_FIXTURE_NOT_READY",
  "STAFF_PAID_COORDINATOR_NOT_READY", "STAFF_PAID_LOCK_NOT_OBSERVED", "STAFF_PAID_BACKENDS_NOT_INDEPENDENT",
  "STAFF_PAID_CLAIM_STARTED_AFTER_EXPIRY", "STAFF_PAID_EXPIRY_NOT_OBSERVED", "STAFF_PAID_CLAIM_DID_NOT_DENY",
  "STAFF_PAID_DENIAL_ALLOCATED_ATTEMPT", "STAFF_PAID_REVOCATION_NOT_COMMITTED",
]);

async function installFixture() {
  // Reuse the exact financial fixture from the already verified regression.
  // Only its test schema changes so independent sessions can share its rows.
  const source = readFileSync(new URL("./staff-paid-entitlement.sql", import.meta.url), "utf8");
  const start = source.indexOf("create function pg_temp.staff_paid_fixture(");
  const end = source.indexOf("\nset local role service_role;", start);
  assert(start >= 0 && end > start, "STAFF_PAID_FIXTURE_SOURCE_CHANGED");
  const definition = source.slice(start, end).replace("create function pg_temp.staff_paid_fixture(",
    "create or replace function test_fixture.staff_paid_fixture(");
  await sql(`${definition}
    REVOKE ALL ON FUNCTION test_fixture.staff_paid_fixture(text,interval,boolean,boolean) FROM PUBLIC,anon,authenticated;
    GRANT EXECUTE ON FUNCTION test_fixture.staff_paid_fixture(text,interval,boolean,boolean) TO service_role;`);
}

async function observe(name, predicate, failure, deadline) {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    const state = (await rows(`SELECT pid,state,query,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers,
      query_start < ${lit(deadline)}::timestamptz AS started_before_deadline
      FROM pg_stat_activity WHERE application_name=${lit(name)}`))[0];
    if (state && predicate(state)) return state;
    await delay(40);
  }
  throw Error(failure);
}

async function race(kind) {
  const f = json(await sql(`SET ROLE service_role;SELECT test_fixture.staff_paid_fixture('live',
    interval '${kind === "expiry" ? "12 seconds" : "1 day"}');`));
  const proof = json(await sql(`SET ROLE service_role;SELECT billing_read_company_operational_entitlement(${lit(f.company)}::uuid);`));
  assert(proof.ok === true && proof.active === true && proof.environment === "live", "STAFF_PAID_FIXTURE_NOT_CURRENT");
  const before = (await rows(`SELECT to_jsonb(i) AS snapshot FROM public.whatsapp_send_intents i
    WHERE id=${lit(f.intent)}::uuid`))[0]?.snapshot;
  assert(before?.outcome === "ready" && before.attempt_token === null && before.attempt_started_at === null,
    "STAFF_PAID_FIXTURE_NOT_READY");

  const tag = crypto.randomUUID().slice(0, 8), ownerName = `staff_paid_owner_${tag}`, claimName = `staff_paid_claim_${tag}`;
  const coordinator = session(`BEGIN;SET LOCAL idle_in_transaction_session_timeout='40s';
    SELECT id FROM public.companies WHERE id=${lit(f.company)}::uuid FOR NO KEY UPDATE;`, ownerName, { keepOpen: true });
  coordinator.done.catch(() => {});
  let claimant, released = false;
  try {
    const owner = await observe(ownerName, row => row.state === "idle in transaction" && row.wait_event === "ClientRead"
      && /FOR NO KEY UPDATE;?\s*$/i.test(row.query),
      "STAFF_PAID_COORDINATOR_NOT_READY", f.deadline);
    claimant = session(`SET statement_timeout='35s';SET ROLE service_role;
      SELECT public.claim_whatsapp_send_attempt(${lit(f.intent)}::uuid,${lit(f.user)}::uuid,90);`, claimName);
    claimant.done.catch(() => {});
    const blocked = await observe(claimName, row => row.wait_event_type === "Lock" && row.blockers.includes(owner.pid),
      "STAFF_PAID_LOCK_NOT_OBSERVED", f.deadline);
    assert(owner.pid !== blocked.pid, "STAFF_PAID_BACKENDS_NOT_INDEPENDENT");
    console.log("REAL_STAFF_PAID_LOCK", JSON.stringify({ case: kind, coordinatorPid: owner.pid, claimPid: blocked.pid, wait: "Lock" }));

    if (kind === "expiry") {
      assert(blocked.started_before_deadline === true, "STAFF_PAID_CLAIM_STARTED_AFTER_EXPIRY");
      // Bound this wait to 15 seconds; verify the database wall clock separately.
      await sql(`SET statement_timeout='20s';SELECT pg_sleep(least(15,greatest(0,
        extract(epoch FROM (${lit(f.deadline)}::timestamptz-clock_timestamp())))+0.05));`);
      const clock = (await rows(`SELECT clock_timestamp() >= ${lit(f.deadline)}::timestamptz AS after_deadline`))[0];
      assert(clock?.after_deadline === true, "STAFF_PAID_EXPIRY_NOT_OBSERVED");
      // Keep the claimant blocked until after the observed wall-clock expiry.
      await observe(claimName, row => row.wait_event_type === "Lock" && row.blockers.includes(owner.pid),
        "STAFF_PAID_LOCK_NOT_OBSERVED", f.deadline);
      console.log("STAFF_PAID_EXPIRY_BARRIER", JSON.stringify({ startedBeforeDeadline: true, releasedAfterDeadline: true }));
      coordinator.child.stdin.end("COMMIT;\n");
    } else {
      // Receipt status revocation is the reviewed one-way financial-history transition.
      // Commit it while holding the company lock before the blocked claim can recheck.
      coordinator.child.stdin.end(`SET LOCAL ROLE service_role;
        UPDATE public.billing_entitlement_applications SET status='revoked' WHERE id=${lit(f.grant)}::uuid;
        COMMIT;\n`);
    }
    released = true;
    const [, output] = await Promise.all([coordinator.done, claimant.done]);
    const result = json(output);
    assert(result.ok === false && result.code === "subscription_inactive", "STAFF_PAID_CLAIM_DID_NOT_DENY");
    assert(!Object.hasOwn(result, "attempt_token") && !Object.hasOwn(result, "manual_paid_entitlement"),
      "STAFF_PAID_DENIAL_ALLOCATED_ATTEMPT");
    const state = (await rows(`SELECT i.outcome,i.attempt_token IS NULL AS no_token,i.attempt_started_at IS NULL AS no_start,
      i.attempt_expires_at IS NULL AS no_expiry,to_jsonb(i)=${lit(JSON.stringify(before))}::jsonb AS unchanged,
      NOT EXISTS(SELECT 1 FROM public.whatsapp_messages m WHERE m.company_id=i.company_id AND m.direction='outbound') AS no_outbound
      FROM public.whatsapp_send_intents i WHERE i.id=${lit(f.intent)}::uuid`))[0];
    assert(state?.outcome === "ready" && state.no_token && state.no_start && state.no_expiry && state.unchanged && state.no_outbound,
      "STAFF_PAID_DENIAL_ALLOCATED_ATTEMPT");
    if (kind === "revocation") {
      const receipt = (await rows(`SELECT status FROM public.billing_entitlement_applications WHERE id=${lit(f.grant)}::uuid`))[0];
      assert(receipt?.status === "revoked", "STAFF_PAID_REVOCATION_NOT_COMMITTED");
    }
    console.log("STAFF_PAID_RACE_OUTCOME", JSON.stringify({ case: kind, code: result.code, outcome: state.outcome, attempted: false }));
  } finally {
    if (!released && !coordinator.child.stdin.destroyed) coordinator.child.stdin.end("ROLLBACK;\n");
    await Promise.allSettled([coordinator.done, ...(claimant ? [claimant.done] : [])]);
  }
}

export async function runStaffPaidConcurrency() {
  await verify(); // Fail before fixture provisioning unless the target is labelled, isolated and networkless.
  const results = [];
  try {
    await installFixture();
    for (const [kind, name] of [
      ["expiry", "staff paid deadline expiring during an observed company lock wait prevents dispatch"],
      ["revocation", "staff receipt revocation committed during an observed company lock wait prevents dispatch"],
    ]) {
      try { await race(kind); results.push({ name, status: "PASS" }); console.log(`PASS|${name}`); }
      catch (error) {
        const code = failures.has(error.message) ? error.message : "ISOLATED_DATABASE_COMMAND_FAILED";
        results.push({ name, status: "FAIL", code }); console.log(`FAIL|${name}|${code}`);
      }
    }
  } catch (error) {
    throw Error(failures.has(error.message) ? error.message : "ISOLATED_DATABASE_COMMAND_FAILED");
  } finally {
    try { await sql("DROP FUNCTION IF EXISTS test_fixture.staff_paid_fixture(text,interval,boolean,boolean);"); }
    catch { throw Error("STAFF_PAID_FIXTURE_CLEANUP_FAILED"); }
  }
  console.log("STAFF_PAID_CONCURRENCY_RESULTS", JSON.stringify({ passed: results.filter(row => row.status === "PASS").length,
    failed: results.filter(row => row.status === "FAIL").length, notRun: 0 }));
  if (results.some(row => row.status === "FAIL")) process.exitCode = 1;
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await runStaffPaidConcurrency(); }
  catch { console.log("FAIL|Staff paid concurrency setup|ISOLATED_DATABASE_COMMAND_FAILED"); process.exitCode = 1; }
}
