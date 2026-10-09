import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lit, rows, session, sql } from "./postgres.mjs";
import { evidence, fixture, purchaseSql, settle, settleSql, storedEvent } from "./fixtures.mjs";

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const parseResult = (out) => JSON.parse(out.split("\n").filter((line) => line.startsWith("{"))[0]);
async function rejectedSettlement(payload) {
  try {
    assert.equal((await settle(payload)).ok, false, "Invalid evidence returned successful settlement");
  } catch (error) {
    // A SQL rejection is also fail-closed; assertion failures are not.
    if (error instanceof assert.AssertionError) throw error;
    assert.match(error.message, /conflict|mismatch|invalid|bound|tenant|evidence|observation|signature|authentic|event|durable/i);
  }
}
async function waitActivity(name, condition) {
  for (let attempt = 0; attempt < 45; attempt++) {
    const activity = await rows(`SELECT pid,application_name,wait_event_type,wait_event FROM pg_stat_activity WHERE application_name=${lit(name)}`);
    if (activity.some(condition)) return activity;
    await sleep(50);
  }
  throw new Error(`No observed PostgreSQL barrier for ${name}`);
}

export async function runPostgresCases(runCase) {
  await runCase("same transaction replay grants once", async () => {
    const f = await fixture({ providerOrderId: randomUUID() });
    const e = await storedEvent(f, randomUUID());
    assert.equal((await settle(e)).outcome, "granted");
    const before = await rows(`SELECT paid_through FROM billing_subscriptions WHERE company_id=${lit(f.companyId)} AND environment='test'`);
    assert.equal((await settle(e)).outcome, "idempotent_replay");
    assert.deepEqual(await rows(`SELECT paid_through FROM billing_subscriptions WHERE company_id=${lit(f.companyId)} AND environment='test'`), before);
    assert.equal((await rows(`SELECT count(*)::integer n FROM billing_entitlement_applications WHERE order_id=${lit(f.orderId)}`))[0].n, 1);
  });

  await runCase("second collection for same order retained without second grant", async () => {
    const f = await fixture({ providerOrderId: randomUUID() });
    assert.equal((await settle(await storedEvent(f, randomUUID()))).outcome, "granted");
    assert.equal((await settle(await storedEvent(f, randomUUID()))).outcome, "duplicate_collection_review");
    assert.equal((await rows(`SELECT count(*)::integer n FROM billing_entitlement_applications WHERE order_id=${lit(f.orderId)}`))[0].n, 1);
    assert.equal((await rows(`SELECT count(*)::integer n FROM billing_settlement_outcomes WHERE order_id=${lit(f.orderId)}`))[0].n, 2);
  });

  for (const sameTransaction of [true, false]) {
    await runCase(`two independent PostgreSQL sessions ${sameTransaction ? "replay" : "different collections"} serialize under observed lock`, async () => {
      const f = await fixture({ providerOrderId: randomUUID() });
      const e1 = await storedEvent(f, randomUUID());
      const e2 = sameTransaction ? e1 : await storedEvent(f, randomUUID());
      const suffix = randomUUID().slice(0, 8), blockerName = `billing_blocker_${suffix}`, waiterName = `billing_waiter_${suffix}`;
      const a = session(`BEGIN; SET LOCAL statement_timeout='15s'; SELECT 1 FROM companies WHERE id=${lit(f.companyId)} FOR UPDATE; SELECT pg_sleep(4); SET LOCAL ROLE service_role; ${settleSql(e1)} COMMIT;`, blockerName);
      // Require the barrier session to have acquired the company row lock.
      const first = await waitActivity(blockerName, (x) => x.wait_event === "PgSleep");
      const b = session(`BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL ROLE service_role; ${settleSql(e2)} COMMIT;`, waiterName);
      const second = await waitActivity(waiterName, (x) => x.wait_event_type === "Lock");
      assert.notEqual(first[0].pid, second[0].pid);
      console.log("PG_LOCK_EVIDENCE", JSON.stringify({ blocker: first, waiter: second }));
      const aResult = parseResult(await a.done), bResult = parseResult(await b.done);
      assert.equal(aResult.outcome, "granted");
      assert.equal(bResult.outcome, sameTransaction ? "idempotent_replay" : "duplicate_collection_review");
      assert.equal((await rows(`SELECT count(*)::integer n FROM billing_entitlement_applications WHERE order_id=${lit(f.orderId)}`))[0].n, 1);
    });
  }

  await runCase("plan retirement concurrent with purchase rejects retired version after lock wait", async () => {
    const f = await fixture({ providerOrderId: randomUUID() });
    const suffix = randomUUID().slice(0, 8), blockerName = `catalog_retire_${suffix}`, waiterName = `catalog_purchase_${suffix}`;
    const a = session(`BEGIN; SET LOCAL statement_timeout='15s'; UPDATE billing_plan_versions SET status='retired' WHERE id=${lit(f.versionId)}; SELECT pg_sleep(4); COMMIT;`, blockerName);
    const first = await waitActivity(blockerName, (x) => x.wait_event === "PgSleep");
    const b = session(`SET statement_timeout='15s'; SET ROLE service_role; ${purchaseSql(f)}`, waiterName);
    const second = await waitActivity(waiterName, (x) => x.wait_event_type === "Lock");
    assert.notEqual(first[0].pid, second[0].pid);
    console.log("PG_CATALOG_LOCK_EVIDENCE", JSON.stringify({ blocker: first, waiter: second }));
    await a.done;
    assert.equal(parseResult(await b.done).ok, false);
    assert.equal((await rows(`SELECT count(*)::integer n FROM billing_orders WHERE company_id=${lit(f.companyId)}`))[0].n, 1);
  });

  await runCase("parent plan retirement concurrent with purchase rejects inactive catalog", async () => {
    const f = await fixture({ providerOrderId: randomUUID() });
    const suffix = randomUUID().slice(0, 8), blockerName = `parent_retire_${suffix}`, waiterName = `parent_purchase_${suffix}`;
    const a = session(`BEGIN; SET LOCAL statement_timeout='15s'; UPDATE billing_plans SET status='retired' WHERE id=${lit(f.planId)}; SELECT pg_sleep(4); COMMIT;`, blockerName);
    const first = await waitActivity(blockerName, (x) => x.wait_event === "PgSleep");
    const b = session(`SET statement_timeout='15s'; SET ROLE service_role; ${purchaseSql(f)}`, waiterName);
    const second = await waitActivity(waiterName, (x) => x.wait_event_type === "Lock");
    assert.notEqual(first[0].pid, second[0].pid);
    await a.done;
    assert.equal(parseResult(await b.done).ok, false);
  });

  await runCase("plan publication concurrent with purchase waits for committed catalog snapshot", async () => {
    const f = await fixture({ providerOrderId: randomUUID() });
    const draft = randomUUID();
    await sql(`UPDATE billing_orders SET status='cancelled' WHERE id=${lit(f.orderId)};
      INSERT INTO billing_plan_versions(id,plan_id,version,amount_baisa,currency,period_days,period_unit,period_count,status)
      VALUES(${lit(draft)},${lit(f.planId)},2,5000,'OMR',30,'day',30,'draft');`);
    const suffix = randomUUID().slice(0, 8), blockerName = `catalog_publish_${suffix}`, waiterName = `publish_purchase_${suffix}`;
    const a = session(`BEGIN; SET LOCAL statement_timeout='15s'; UPDATE billing_plan_versions SET status='retired' WHERE id=${lit(f.versionId)};
      UPDATE billing_plan_versions SET status='published' WHERE id=${lit(draft)}; SELECT pg_sleep(4); COMMIT;`, blockerName);
    const first = await waitActivity(blockerName, (x) => x.wait_event === "PgSleep");
    const b = session(`SET statement_timeout='15s'; SET ROLE service_role; ${purchaseSql({ ...f, versionId: draft })}`, waiterName);
    const second = await waitActivity(waiterName, (x) => x.wait_event_type === "Lock");
    assert.notEqual(first[0].pid, second[0].pid);
    await a.done;
    const result = parseResult(await b.done);
    assert.equal(result.ok, true);
    assert.equal(result.action, "created");
    assert.equal((await rows(`SELECT plan_version_id FROM billing_orders WHERE id=${lit(result.order_id)}`))[0].plan_version_id, draft);
  });

  await runCase("purchase rejects caller calendar period conflicting with published version", async () => {
    const f = await fixture({ providerOrderId: randomUUID() });
    await sql(`UPDATE billing_orders SET status='cancelled' WHERE id=${lit(f.orderId)};`);
    const query = purchaseSql(f).replace("'day',30,", "'year',99,");
    const result = parseResult(await sql(`SET ROLE service_role; ${query}`));
    assert.equal(result.ok, false, "Caller changed a published 30-day plan into a 99-year order snapshot");
    assert.equal((await rows(`SELECT count(*)::integer n FROM billing_orders WHERE company_id=${lit(f.companyId)}`))[0].n, 1);
  });

  await runCase("same provider id in distinct account/environment scopes accepted; duplicate same scope rejected", async () => {
    const providerOrderId = randomUUID();
    const bound = await fixture({ account: "74002", environment: "test", providerOrderId });
    await fixture({ account: "74003", environment: "test", providerOrderId });
    await fixture({ account: "74002", environment: "live", providerOrderId });
    await assert.rejects(() => fixture({ account: "74002", environment: "test", providerOrderId }), /duplicate key/);
    assert.equal((await rows(`SELECT count(*)::integer n FROM billing_payment_attempts WHERE provider_order_id=${lit(providerOrderId)}`))[0].n, 3);
    await assert.rejects(() => sql(`INSERT INTO billing_payment_attempts(order_id,company_id,status,provider_account_ref,provider_environment,provider_order_id)
      VALUES(${lit(bound.orderId)},${lit(bound.companyId)},'provider_submitted','74099','live',${lit(randomUUID())});`), /ATTEMPT_PROVIDER_SCOPE_MISMATCH/);
    await assert.rejects(() => sql(`INSERT INTO billing_provider_events(payment_attempt_id,company_id,provider_account_ref,provider_environment,provider_transaction_id,event_status,amount_baisa_expected,currency_expected)
      VALUES(${lit(bound.attemptId)},${lit(bound.companyId)},'74002','test',${lit(randomUUID())},'success',6000,'OMR');`), /EVENT_PROVIDER_SCOPE_MISMATCH/);
  });

  await runCase("cross-company evidence rejected and neither tenant receives grant", async () => {
    const f = await fixture({ providerOrderId: randomUUID() });
    const other = await fixture({ providerOrderId: randomUUID() });
    const e = await storedEvent(f, randomUUID());
    await rejectedSettlement({ ...e, company_id: other.companyId });
    assert.equal((await rows(`SELECT count(*)::integer n FROM billing_entitlement_applications WHERE company_id IN (${lit(f.companyId)},${lit(other.companyId)})`))[0].n, 0);
  });

  await runCase("test collection cannot create live entitlement", async () => {
    const f = await fixture({ providerOrderId: randomUUID() });
    await settle(await storedEvent(f, randomUUID()));
    const result = parseResult(await sql(`SET ROLE service_role; SELECT billing_read_company_operational_entitlement(${lit(f.companyId)}::uuid);`));
    assert.equal(result.active, false);
    assert.equal((await rows(`SELECT count(*)::integer n FROM billing_subscriptions WHERE company_id=${lit(f.companyId)} AND environment='live' AND status='active'`))[0].n, 0);
  });

  await runCase("browser roles cannot write payment tables or execute settlement/reversal", async () => {
    for (const role of ["anon", "authenticated"]) {
      await assert.rejects(() => sql(`SET ROLE ${role}; INSERT INTO billing_subscriptions(company_id,environment) VALUES(gen_random_uuid(),'live');`), /permission denied/);
      await assert.rejects(() => sql(`SET ROLE ${role}; SELECT billing_settle_paymob_hmac_verified('{}'::jsonb);`), /permission denied/);
      await assert.rejects(() => sql(`SET ROLE ${role}; SELECT private.billing_apply_reversal(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'refunded','{}'::jsonb);`), /permission denied/);
    }
  });

  await runCase("late payment while order expiration passes is retained for review without grant", async () => {
    const f = await fixture({ providerOrderId: randomUUID(), expiresAt: new Date(Date.now() + 1500).toISOString() });
    const e = await storedEvent(f, randomUUID());
    await sleep(1600);
    const result = await settle(e);
    assert.equal(result.outcome, "late_payment_review");
    assert.equal((await rows(`SELECT count(*)::integer n FROM billing_entitlement_applications WHERE order_id=${lit(f.orderId)}`))[0].n, 0);
    assert.equal((await rows(`SELECT count(*)::integer n FROM billing_provider_events WHERE payment_attempt_id=${lit(f.attemptId)}`))[0].n, 1);
  });

  await runCase("order expires during actual PostgreSQL settlement lock wait", async () => {
    const f = await fixture({ providerOrderId: randomUUID(), expiresAt: new Date(Date.now() + 2200).toISOString() });
    const e = await storedEvent(f, randomUUID());
    const suffix = randomUUID().slice(0, 8), blockerName = `expiry_blocker_${suffix}`, waiterName = `expiry_waiter_${suffix}`;
    const a = session(`BEGIN; SET LOCAL statement_timeout='15s'; SELECT 1 FROM companies WHERE id=${lit(f.companyId)} FOR UPDATE; SELECT pg_sleep(4); COMMIT;`, blockerName);
    const first = await waitActivity(blockerName, (x) => x.wait_event === "PgSleep");
    const b = session(`SET statement_timeout='15s'; SET ROLE service_role; ${settleSql(e)}`, waiterName);
    const second = await waitActivity(waiterName, (x) => x.wait_event_type === "Lock");
    assert.notEqual(first[0].pid, second[0].pid);
    console.log("PG_EXPIRY_LOCK_EVIDENCE", JSON.stringify({ blocker: first, waiter: second }));
    await a.done;
    assert.equal(parseResult(await b.done).outcome, "late_payment_review");
    assert.equal((await rows(`SELECT count(*)::integer n FROM billing_entitlement_applications WHERE order_id=${lit(f.orderId)}`))[0].n, 0);
  });

  await runCase("malformed or missing durable processor evidence does not grant", async () => {
    const f = await fixture({ providerOrderId: randomUUID() });
    await rejectedSettlement(evidence(f, randomUUID()));
    const e = await storedEvent(f, randomUUID(), { flags: { hmac_verified: false } });
    await rejectedSettlement(e);
    assert.equal((await rows(`SELECT count(*)::integer n FROM billing_entitlement_applications WHERE order_id=${lit(f.orderId)}`))[0].n, 0);
  });
}
