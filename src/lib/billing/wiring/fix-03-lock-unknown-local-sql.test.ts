/**
 * VEL-BILLING-LOCK-ORDER-AND-UNKNOWN-FIX-03 — local SQL cross-flow.
 * Opt-in: VELORA_FIX03_LOCK_LOCAL_DB=access_local_20261006 VELORA_FIX03_LOCK_ALLOW_DOCKER=1
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mapAtomicPurchasePersistPayload } from "@/lib/billing/wiring/purchase-persist-rpc";

const CONTAINER = "velora-access-local-20261006";
const DB = "access_local_20261006";
const USER = "c1030000-0000-4000-8000-000000000001";
const COMPANY = "c2030000-0000-4000-8000-000000000001";
const COMPANY_B = "c2030000-0000-4000-8000-000000000002";
const PLAN = "c3030000-0000-4000-8000-000000000001";
const VER_M = "c4030000-0000-4000-8000-000000000001";
const VER_Y = "c4030000-0000-4000-8000-000000000002";

const runLocal =
  process.env.VELORA_FIX03_LOCK_LOCAL_DB === "access_local_20261006" &&
  process.env.VELORA_FIX03_LOCK_ALLOW_DOCKER === "1";

function lit(v: string) {
  return `'${String(v).replaceAll("'", "''")}'`;
}

function sql(query: string): Promise<string> {
  return new Promise((ok, bad) => {
    execFile(
      "docker",
      [
        "exec",
        "-u",
        "postgres",
        CONTAINER,
        "psql",
        "-X",
        "-U",
        "postgres",
        "-d",
        DB,
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        query,
      ],
      { maxBuffer: 2 * 1024 * 1024 },
      (err, out, stderr) => {
        if (err) bad(new Error(stderr || String(err)));
        else ok(out.trim());
      },
    );
  });
}

function sqlFile(contents: string): Promise<void> {
  return new Promise((ok, bad) => {
    const child = execFile(
      "docker",
      [
        "exec",
        "-i",
        "-u",
        "postgres",
        CONTAINER,
        "psql",
        "-X",
        "-U",
        "postgres",
        "-d",
        DB,
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { maxBuffer: 8 * 1024 * 1024 },
      (err, _out, stderr) => {
        if (err) bad(new Error(stderr || String(err)));
        else ok();
      },
    );
    child.stdin?.write(contents);
    child.stdin?.end();
  });
}

async function rows(query: string) {
  return JSON.parse(
    await sql(`SELECT coalesce(jsonb_agg(q), '[]'::jsonb) FROM (${query}) q;`),
  ) as Array<Record<string, unknown>>;
}

function persistSql(args: {
  companyId: string;
  purpose: string;
  planVer: string;
  planId: string;
  clientOp: string;
  fp: string;
  special: string;
  periodDays: number;
  periodUnit: string;
  periodCount: number;
}) {
  return `SELECT public.billing_create_or_reuse_subscription_order(
    ${lit(args.companyId)}::uuid,
    'velora_ai_staff',
    ${lit(args.purpose)},
    ${lit(args.planVer)}::uuid,
    ${lit(args.planId)}::uuid,
    ${lit(args.clientOp)},
    ${lit(args.fp)},
    ${lit(args.special)},
    5000,
    'OMR',
    ${args.periodDays},
    ${lit(args.periodUnit)},
    ${args.periodCount},
    '71610',
    'test',
    ${lit(USER)}::uuid
  )`;
}

const describeLocal = runLocal ? describe : describe.skip;

describeLocal("FIX-03 lock order + unknown collection", () => {
  beforeAll(async () => {
    await sqlFile(
      readFileSync(
        resolve(
          process.cwd(),
          "supabase/migrations/20261006310000_vel_billing_lock_order_and_unknown_fix_03.sql",
        ),
        "utf8",
      ),
    );
    await sqlFile(`
BEGIN;
DELETE FROM public.billing_settlement_outcomes WHERE company_id IN (${lit(COMPANY)}, ${lit(COMPANY_B)});
DELETE FROM public.billing_entitlement_applications WHERE company_id IN (${lit(COMPANY)}, ${lit(COMPANY_B)});
DELETE FROM public.billing_provider_events WHERE company_id IN (${lit(COMPANY)}, ${lit(COMPANY_B)});
DELETE FROM public.billing_payment_attempts WHERE company_id IN (${lit(COMPANY)}, ${lit(COMPANY_B)});
DELETE FROM public.billing_orders WHERE company_id IN (${lit(COMPANY)}, ${lit(COMPANY_B)});
DELETE FROM public.billing_subscriptions WHERE company_id IN (${lit(COMPANY)}, ${lit(COMPANY_B)});
DELETE FROM public.billing_plan_versions WHERE id IN (${lit(VER_M)}, ${lit(VER_Y)});
DELETE FROM public.billing_plans WHERE id = ${lit(PLAN)};
DELETE FROM public.companies WHERE id IN (${lit(COMPANY)}, ${lit(COMPANY_B)});
DELETE FROM auth.users WHERE id = ${lit(USER)};

INSERT INTO auth.users (id, email) VALUES (${lit(USER)}, 'fix03-lock@test.invalid');
INSERT INTO public.companies (id, display_name, status, created_by) VALUES
  (${lit(COMPANY)}, 'FIX03_A', 'active', ${lit(USER)}),
  (${lit(COMPANY_B)}, 'FIX03_B', 'active', ${lit(USER)});
INSERT INTO public.billing_plans (id, code, name, status)
VALUES (${lit(PLAN)}, 'FIX03_PLAN', 'Fixture', 'active');
INSERT INTO public.billing_plan_versions (
  id, plan_id, version, amount_baisa, period_days, period_unit, period_count, status
) VALUES
  (${lit(VER_M)}, ${lit(PLAN)}, 1, 5000, 30, 'day', 30, 'published'),
  (${lit(VER_Y)}, ${lit(PLAN)}, 2, 50000, 365, 'day', 365, 'published');
COMMIT;
`);
  }, 120_000);

  afterAll(async () => {
    await sqlFile(`
BEGIN;
DELETE FROM public.billing_settlement_outcomes WHERE company_id IN (${lit(COMPANY)}, ${lit(COMPANY_B)});
DELETE FROM public.billing_entitlement_applications WHERE company_id IN (${lit(COMPANY)}, ${lit(COMPANY_B)});
DELETE FROM public.billing_provider_events WHERE company_id IN (${lit(COMPANY)}, ${lit(COMPANY_B)});
DELETE FROM public.billing_payment_attempts WHERE company_id IN (${lit(COMPANY)}, ${lit(COMPANY_B)});
DELETE FROM public.billing_orders WHERE company_id IN (${lit(COMPANY)}, ${lit(COMPANY_B)});
DELETE FROM public.billing_subscriptions WHERE company_id IN (${lit(COMPANY)}, ${lit(COMPANY_B)});
DELETE FROM public.billing_plan_versions WHERE id IN (${lit(VER_M)}, ${lit(VER_Y)});
DELETE FROM public.billing_plans WHERE id = ${lit(PLAN)};
DELETE FROM public.companies WHERE id IN (${lit(COMPANY)}, ${lit(COMPANY_B)});
DELETE FROM auth.users WHERE id = ${lit(USER)};
COMMIT;
`).catch(() => undefined);
  }, 60_000);

  async function wipeCompany(ids: string[]) {
    const inList = ids.map(lit).join(", ");
    await sql(`DELETE FROM public.billing_settlement_outcomes WHERE company_id IN (${inList})`);
    await sql(`DELETE FROM public.billing_entitlement_applications WHERE company_id IN (${inList})`);
    await sql(`DELETE FROM public.billing_provider_events WHERE company_id IN (${inList})`);
    await sql(`DELETE FROM public.billing_payment_attempts WHERE company_id IN (${inList})`);
    await sql(`DELETE FROM public.billing_orders WHERE company_id IN (${inList})`);
    await sql(`DELETE FROM public.billing_subscriptions WHERE company_id IN (${inList})`);
  }

  it("PASS: purchase+settlement two connections do not deadlock (40P01 closed)", async () => {
    await wipeCompany([COMPANY]);

    const created = mapAtomicPurchasePersistPayload(
      JSON.parse(
        await sql(
          persistSql({
            companyId: COMPANY,
            purpose: "initial",
            planVer: VER_M,
            planId: PLAN,
            clientOp: "fix03-dl-op",
            fp: "fix03-dl-fp",
            special: "FIX03_DL_SPECIAL",
            periodDays: 30,
            periodUnit: "day",
            periodCount: 30,
          }),
        ),
      ),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const def = await sql(
      `SELECT lower(pg_get_functiondef('private.billing_settle_payment_core(jsonb)'::regprocedure))`,
    );
    const companyLockAt = def.indexOf("perform 1 from public.companies");
    const orderLockAt = def.indexOf("select * into v_order");
    expect(companyLockAt).toBeGreaterThan(0);
    expect(orderLockAt).toBeGreaterThan(companyLockAt);
    expect(def).toContain("company -> subscription -> order -> attempt -> provider_event");

    // Two physical sessions: Conn1 holds company; Conn2 starts settle (waits on company, must NOT hold order).
    // Conn1 then runs purchase reuse and commits — no 40P01.
    const settleEvidence = JSON.stringify({
      evidence_marker: "paymob_hmac_v1",
      authenticity: {
        source: "server_adapter_attestation",
        verified: true,
        method: "fixture",
      },
      company_id: COMPANY,
      order_id: created.orderId,
      payment_attempt_id: created.paymentAttemptId,
      provider: "paymob",
      provider_account_ref: "71610",
      provider_environment: "test",
      provider_transaction_id: "fix03-dl-txn",
      special_reference: "FIX03_DL_SPECIAL",
      currency: "OMR",
      event_status: "success",
      amount_baisa: 5000,
      observation_key: "default",
    }).replaceAll("'", "''");

    const session1 = `
BEGIN;
SELECT 1 FROM public.companies WHERE id = '${COMPANY}' FOR UPDATE;
SELECT pg_sleep(2);
SELECT public.billing_create_or_reuse_subscription_order(
  '${COMPANY}'::uuid, 'velora_ai_staff', 'initial', '${VER_M}'::uuid, '${PLAN}'::uuid,
  'fix03-dl-op', 'fix03-dl-fp', 'FIX03_DL_SPECIAL', 5000, 'OMR', 30, 'day', 30, '71610', 'test', '${USER}'::uuid
);
COMMIT;
`;
    const session2 = `
BEGIN;
SELECT private.billing_settle_payment_core('${settleEvidence}'::jsonb);
COMMIT;
`;

    const runSession = (script: string) =>
      new Promise<{ ok: boolean; out: string; err: string }>((resolvePromise) => {
        const child = execFile(
          "docker",
          [
            "exec",
            "-i",
            "-u",
            "postgres",
            CONTAINER,
            "psql",
            "-X",
            "-U",
            "postgres",
            "-d",
            DB,
            "-v",
            "ON_ERROR_STOP=1",
          ],
          { maxBuffer: 2 * 1024 * 1024 },
          (err, out, stderr) => {
            resolvePromise({
              ok: !err,
              out: String(out ?? ""),
              err: String(stderr ?? err ?? ""),
            });
          },
        );
        child.stdin?.write(script);
        child.stdin?.end();
      });

    const [r1, r2] = await Promise.all([runSession(session1), runSession(session2)]);
    const blob = `${r1.out}\n${r1.err}\n${r2.out}\n${r2.err}`;
    expect(blob).not.toMatch(/40P01|deadlock detected/i);
    // Purchase session must succeed (reuse under company lock).
    expect(r1.ok).toBe(true);
    // Settle may reject for business reasons after locks; must not abort via deadlock.
    expect(r2.err).not.toMatch(/40P01|deadlock detected/i);
  }, 120_000);

  it("PASS: submitted+unresolved initial blocks renew; order not cancelled", async () => {
    await wipeCompany([COMPANY]);

    const initial = mapAtomicPurchasePersistPayload(
      JSON.parse(
        await sql(
          persistSql({
            companyId: COMPANY,
            purpose: "initial",
            planVer: VER_M,
            planId: PLAN,
            clientOp: "fix03-unk-op",
            fp: "fix03-unk-fp",
            special: "FIX03_UNK_SPECIAL",
            periodDays: 30,
            periodUnit: "day",
            periodCount: 30,
          }),
        ),
      ),
    );
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;

    await sql(`
      UPDATE public.billing_orders SET status = 'submitted' WHERE id = ${lit(initial.orderId)};
      UPDATE public.billing_payment_attempts
      SET status = 'unresolved', provider_order_id = 'prov-ord-unk'
      WHERE id = ${lit(initial.paymentAttemptId)};
      INSERT INTO public.billing_subscriptions (company_id, status, plan_version_id, paid_through)
      VALUES (${lit(COMPANY)}, 'active', ${lit(VER_M)}, now() + interval '10 days')
      ON CONFLICT (company_id) DO UPDATE
      SET status = 'active', plan_version_id = excluded.plan_version_id, paid_through = excluded.paid_through;
    `);

    const renew = mapAtomicPurchasePersistPayload(
      JSON.parse(
        await sql(
          persistSql({
            companyId: COMPANY,
            purpose: "renew",
            planVer: VER_Y,
            planId: PLAN,
            clientOp: "fix03-renew-blocked",
            fp: "fix03-renew-blocked-fp",
            special: "FIX03_RENEW_BLOCKED",
            periodDays: 365,
            periodUnit: "day",
            periodCount: 365,
          }),
        ),
      ),
    );
    expect(renew).toMatchObject({
      ok: false,
      code: "OPEN_COLLECTION_UNRESOLVED",
      blockNewCollection: true,
    });

    const [st] = await rows(`
      SELECT status, id::text AS id FROM public.billing_orders WHERE id = ${lit(initial.orderId)}
    `);
    expect(st.status).toBe("submitted");

    const [att] = await rows(`
      SELECT status, provider_order_id FROM public.billing_payment_attempts WHERE id = ${lit(initial.paymentAttemptId)}
    `);
    expect(att).toMatchObject({ status: "unresolved", provider_order_id: "prov-ord-unk" });

    const [counts] = await rows(`
      SELECT count(*)::int AS orders FROM public.billing_orders
      WHERE company_id = ${lit(COMPANY)} AND purchase_purpose = 'renew'
    `);
    expect(counts.orders).toBe(0);
  }, 120_000);

  it("PASS: safe locked draft without provider ids is cancelled on renew; renew opens", async () => {
    await wipeCompany([COMPANY]);

    const draft = mapAtomicPurchasePersistPayload(
      JSON.parse(
        await sql(
          persistSql({
            companyId: COMPANY,
            purpose: "initial",
            planVer: VER_M,
            planId: PLAN,
            clientOp: "fix03-draft-op",
            fp: "fix03-draft-fp",
            special: "FIX03_DRAFT_SPECIAL",
            periodDays: 30,
            periodUnit: "day",
            periodCount: 30,
          }),
        ),
      ),
    );
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    await sql(`
      INSERT INTO public.billing_subscriptions (company_id, status, plan_version_id, paid_through)
      VALUES (${lit(COMPANY)}, 'active', ${lit(VER_M)}, now() + interval '10 days')
      ON CONFLICT (company_id) DO UPDATE
      SET status = 'active', plan_version_id = excluded.plan_version_id, paid_through = excluded.paid_through;
    `);

    const renew = mapAtomicPurchasePersistPayload(
      JSON.parse(
        await sql(
          persistSql({
            companyId: COMPANY,
            purpose: "renew",
            planVer: VER_Y,
            planId: PLAN,
            clientOp: "fix03-renew-ok",
            fp: "fix03-renew-ok-fp",
            special: "FIX03_RENEW_OK",
            periodDays: 365,
            periodUnit: "day",
            periodCount: 365,
          }),
        ),
      ),
    );
    expect(renew.ok).toBe(true);
    if (!renew.ok) return;
    expect(renew.action).toBe("insert");

    const [draftSt] = await rows(`
      SELECT status FROM public.billing_orders WHERE id = ${lit(draft.orderId)}
    `);
    expect(draftSt.status).toBe("cancelled");
  }, 120_000);

  it("PASS: provider_submitted initial blocks renew (pending collection)", async () => {
    await wipeCompany([COMPANY]);

    const initial = mapAtomicPurchasePersistPayload(
      JSON.parse(
        await sql(
          persistSql({
            companyId: COMPANY,
            purpose: "initial",
            planVer: VER_M,
            planId: PLAN,
            clientOp: "fix03-pend-op",
            fp: "fix03-pend-fp",
            special: "FIX03_PEND_SPECIAL",
            periodDays: 30,
            periodUnit: "day",
            periodCount: 30,
          }),
        ),
      ),
    );
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;

    await sql(`
      UPDATE public.billing_orders SET status = 'submitted' WHERE id = ${lit(initial.orderId)};
      UPDATE public.billing_payment_attempts
      SET status = 'provider_submitted', provider_order_id = 'prov-pend'
      WHERE id = ${lit(initial.paymentAttemptId)};
      INSERT INTO public.billing_subscriptions (company_id, status, plan_version_id, paid_through)
      VALUES (${lit(COMPANY)}, 'active', ${lit(VER_M)}, now() + interval '10 days')
      ON CONFLICT (company_id) DO UPDATE
      SET status = 'active', plan_version_id = excluded.plan_version_id, paid_through = excluded.paid_through;
    `);

    const renew = mapAtomicPurchasePersistPayload(
      JSON.parse(
        await sql(
          persistSql({
            companyId: COMPANY,
            purpose: "renew",
            planVer: VER_Y,
            planId: PLAN,
            clientOp: "fix03-renew-pend",
            fp: "fix03-renew-pend-fp",
            special: "FIX03_RENEW_PEND",
            periodDays: 365,
            periodUnit: "day",
            periodCount: 365,
          }),
        ),
      ),
    );
    expect(renew).toMatchObject({
      ok: false,
      code: "OPEN_COLLECTION_UNRESOLVED",
      blockNewCollection: true,
    });
    const [st] = await rows(`SELECT status FROM public.billing_orders WHERE id = ${lit(initial.orderId)}`);
    expect(st.status).toBe("submitted");
  }, 120_000);

  it("PASS: legitimate renew when no unsafe open initial", async () => {
    await wipeCompany([COMPANY]);

    await sql(`
      INSERT INTO public.billing_subscriptions (company_id, status, plan_version_id, paid_through)
      VALUES (${lit(COMPANY)}, 'active', ${lit(VER_M)}, now() + interval '10 days');
    `);

    const renew = mapAtomicPurchasePersistPayload(
      JSON.parse(
        await sql(
          persistSql({
            companyId: COMPANY,
            purpose: "renew",
            planVer: VER_Y,
            planId: PLAN,
            clientOp: "fix03-renew-legit",
            fp: "fix03-renew-legit-fp",
            special: "FIX03_RENEW_LEGIT",
            periodDays: 365,
            periodUnit: "day",
            periodCount: 365,
          }),
        ),
      ),
    );
    expect(renew.ok).toBe(true);
    if (!renew.ok) return;
    expect(renew.action).toBe("insert");
    expect(renew.blockNewCollection).toBe(false);
  }, 120_000);

  it("PASS: company B renew isolation while A has unresolved initial", async () => {
    await wipeCompany([COMPANY, COMPANY_B]);

    const a = mapAtomicPurchasePersistPayload(
      JSON.parse(
        await sql(
          persistSql({
            companyId: COMPANY,
            purpose: "initial",
            planVer: VER_M,
            planId: PLAN,
            clientOp: "fix03-iso-a",
            fp: "fix03-iso-a-fp",
            special: "FIX03_ISO_A",
            periodDays: 30,
            periodUnit: "day",
            periodCount: 30,
          }),
        ),
      ),
    );
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    await sql(`
      UPDATE public.billing_orders SET status = 'submitted' WHERE id = ${lit(a.orderId)};
      UPDATE public.billing_payment_attempts
      SET status = 'unresolved', provider_order_id = 'iso-a'
      WHERE id = ${lit(a.paymentAttemptId)};
      INSERT INTO public.billing_subscriptions (company_id, status, plan_version_id, paid_through)
      VALUES (${lit(COMPANY_B)}, 'active', ${lit(VER_M)}, now() + interval '10 days')
      ON CONFLICT (company_id) DO UPDATE
      SET status = 'active', plan_version_id = excluded.plan_version_id, paid_through = excluded.paid_through;
    `);

    const bRenew = mapAtomicPurchasePersistPayload(
      JSON.parse(
        await sql(
          persistSql({
            companyId: COMPANY_B,
            purpose: "renew",
            planVer: VER_Y,
            planId: PLAN,
            clientOp: "fix03-iso-b",
            fp: "fix03-iso-b-fp",
            special: "FIX03_ISO_B",
            periodDays: 365,
            periodUnit: "day",
            periodCount: 365,
          }),
        ),
      ),
    );
    expect(bRenew.ok).toBe(true);
    const [aStill] = await rows(`SELECT status FROM public.billing_orders WHERE id = ${lit(a.orderId)}`);
    expect(aStill.status).toBe("submitted");
  }, 120_000);
});
