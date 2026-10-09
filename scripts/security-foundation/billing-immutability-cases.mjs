import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, settle, storedEvent } from "../billing-acceptance/fixtures.mjs";
import { lit, rows, sql, verifyLocalContainer } from "../billing-acceptance/postgres.mjs";

// Uses only the root-validated, already migrated, ephemeral C1 PostgreSQL DB.
// No bootstrap, database reset, provider request, cloud transport or credentials.
await verifyLocalContainer();
let passed = 0;
const failures = [];
async function run(name, action) {
  try { await action(); passed++; console.log(`PASS|${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL|${name}|${error.message}`); }
}
async function payment(options) {
  const f = await fixture({ providerOrderId: randomUUID(), ...options });
  const e = await storedEvent(f, randomUUID());
  assert.equal((await settle(e)).outcome, "granted");
  return { f, e };
}
async function immutableMutation(query, snapshotQuery, role = "service_role") {
  const before = await rows(snapshotQuery);
  await assert.rejects(sql(`SET ROLE ${role}; ${query}`), /immutable|append.only|permission denied/i);
  assert.deepEqual(await rows(snapshotQuery), before, "Rejected mutation changed the durable record");
}

for (const flag of ["is_auth", "is_capture"]) {
  await run(`${flag} receipt cannot be rewritten into a collected payment`, async () => {
    const f = await fixture({ providerOrderId: randomUUID() });
    const e = await storedEvent(f, randomUUID(), { eventStatus: "other", flags: { [flag]: true } });
    assert.equal((await settle(e)).ok, false);
    const query = `UPDATE public.billing_provider_events SET event_status='success',
      raw_summary=raw_summary||jsonb_build_object('event_status','success',${lit(flag)},false)
      WHERE company_id=${lit(f.companyId)} AND provider_transaction_id=${lit(e.provider_transaction_id)};`;
    let rejection;
    try { await sql(`SET ROLE service_role; ${query}`); } catch (error) { rejection = error; }
    if (!rejection) {
      const result = await settle({ ...e, event_status: "success" });
      assert.fail(`Signed ${flag}=true was rewritten; settlement=${JSON.stringify(result)}`);
    }
    assert.match(rejection.message, /immutable|append.only|permission denied/i);
    assert.equal((await settle(e)).ok, false);
    assert.equal((await rows(`SELECT count(*)::integer n FROM public.billing_entitlement_applications WHERE order_id=${lit(f.orderId)}`))[0].n, 0);
  });
}

await run("granted HMAC receipt remains immutable", async () => {
  const { f } = await payment();
  await immutableMutation(`UPDATE public.billing_provider_events SET raw_summary=raw_summary||'{"hmac_verified":false}'::jsonb WHERE company_id=${lit(f.companyId)};`,
    `SELECT * FROM public.billing_provider_events WHERE company_id=${lit(f.companyId)}`);
});

await run("unprocessed refund cannot be erased to permit a stale success", async () => {
  const f = await fixture({ providerOrderId: randomUUID() });
  await storedEvent(f, randomUUID(), { eventStatus: "refunded", flags: { is_refunded: true } });
  await immutableMutation(`DELETE FROM public.billing_provider_events WHERE company_id=${lit(f.companyId)};`,
    `SELECT * FROM public.billing_provider_events WHERE company_id=${lit(f.companyId)}`);
  const result = await settle(await storedEvent(f, randomUUID()));
  assert.equal(result.outcome, "lifecycle_review");
  assert.equal((await rows(`SELECT count(*)::integer n FROM public.billing_entitlement_applications WHERE order_id=${lit(f.orderId)}`))[0].n, 0);
});

await run("grant applied period cannot be altered", async () => {
  const { f } = await payment();
  await immutableMutation(`UPDATE public.billing_entitlement_applications SET applied_paid_through=applied_paid_through+interval '99 years' WHERE order_id=${lit(f.orderId)};`,
    `SELECT * FROM public.billing_entitlement_applications WHERE order_id=${lit(f.orderId)}`);
});

await run("revoked grant cannot be reactivated by a record update", async () => {
  const { f, e } = await payment();
  await sql(`SET ROLE service_role; UPDATE public.billing_entitlement_applications SET status='revoked' WHERE order_id=${lit(f.orderId)};`);
  await immutableMutation(`UPDATE public.billing_entitlement_applications SET status='active' WHERE order_id=${lit(f.orderId)};`,
    `SELECT * FROM public.billing_entitlement_applications WHERE order_id=${lit(f.orderId)}`);
  assert.equal((await settle(e)).outcome, "lifecycle_review");
});

await run("settlement authenticity and period cannot be rewritten", async () => {
  const { f } = await payment();
  await immutableMutation(`UPDATE public.billing_settlement_outcomes SET evidence_marker='forged', applied_paid_through=applied_paid_through+interval '99 years' WHERE order_id=${lit(f.orderId)};`,
    `SELECT * FROM public.billing_settlement_outcomes WHERE order_id=${lit(f.orderId)}`);
});

await run("settlement receipt cannot be deleted", async () => {
  const { f } = await payment();
  await immutableMutation(`DELETE FROM public.billing_settlement_outcomes WHERE order_id=${lit(f.orderId)};`,
    `SELECT * FROM public.billing_settlement_outcomes WHERE order_id=${lit(f.orderId)}`);
});

await run("financial receipt tables do not grant TRUNCATE to service_role", async () => {
  const privileges = await rows(`SELECT t,has_table_privilege('service_role','public.'||t,'TRUNCATE') allowed
    FROM unnest(ARRAY['billing_provider_events','billing_entitlement_applications','billing_settlement_outcomes']) t`);
  assert.deepEqual(privileges.map(row => row.allowed), [false, false, false]);
});

await run("privileged receipt mutation is rejected by the record trigger", async () => {
  const { f } = await payment();
  await immutableMutation(`UPDATE public.billing_provider_events SET raw_summary=raw_summary||'{"hmac_verified":false}'::jsonb WHERE company_id=${lit(f.companyId)};`,
    `SELECT * FROM public.billing_provider_events WHERE company_id=${lit(f.companyId)}`, "supabase_admin");
});

await run("privileged grant mutation is rejected by the record trigger", async () => {
  const { f } = await payment();
  await immutableMutation(`UPDATE public.billing_entitlement_applications SET period_count=99 WHERE order_id=${lit(f.orderId)};`,
    `SELECT * FROM public.billing_entitlement_applications WHERE order_id=${lit(f.orderId)}`, "supabase_admin");
});

await run("privileged outcome mutation is rejected by the record trigger", async () => {
  const { f } = await payment();
  await immutableMutation(`UPDATE public.billing_settlement_outcomes SET evidence_marker='forged' WHERE order_id=${lit(f.orderId)};`,
    `SELECT * FROM public.billing_settlement_outcomes WHERE order_id=${lit(f.orderId)}`, "supabase_admin");
});

await run("privileged TRUNCATE is rejected before financial records change", async () => {
  const before = await rows("SELECT count(*)::integer n FROM public.billing_provider_events");
  await assert.rejects(sql("BEGIN; TRUNCATE public.billing_provider_events CASCADE; ROLLBACK;"), /append.only/i);
  assert.deepEqual(await rows("SELECT count(*)::integer n FROM public.billing_provider_events"), before);
});

await run("idempotent replay may update replay detail without changing financial proof", async () => {
  const { f, e } = await payment();
  const before = await rows(`SELECT to_jsonb(x)-'detail' financial FROM public.billing_settlement_outcomes x WHERE order_id=${lit(f.orderId)}`);
  assert.equal((await settle(e)).outcome, "idempotent_replay");
  assert.deepEqual(await rows(`SELECT to_jsonb(x)-'detail' financial FROM public.billing_settlement_outcomes x WHERE order_id=${lit(f.orderId)}`), before);
  assert.equal((await rows(`SELECT detail ? 'replayed_at' recorded FROM public.billing_settlement_outcomes WHERE order_id=${lit(f.orderId)}`))[0].recorded, true);
});

await run("catalog replacement preserves an earlier order's locked price and period", async () => {
  const f = await fixture({ providerOrderId: randomUUID() });
  await sql(`SET ROLE service_role; UPDATE public.billing_plan_versions SET status='retired' WHERE id=${lit(f.versionId)};
    INSERT INTO public.billing_plan_versions(id,plan_id,version,amount_baisa,currency,period_days,period_unit,period_count,status)
    VALUES(${lit(randomUUID())},${lit(f.planId)},2,99000,'OMR',365,'year',1,'published');`);
  assert.equal((await settle(await storedEvent(f, randomUUID()))).outcome, "granted");
  assert.deepEqual((await rows(`SELECT amount_baisa,period_unit,period_count FROM public.billing_orders WHERE id=${lit(f.orderId)}`))[0],
    { amount_baisa: 5000, period_unit: "day", period_count: 30 });
});

console.log(`BILLING_IMMUTABILITY_RESULT|${passed} passed|${failures.length} failed`);
if (failures.length) process.exitCode = 1;
