/**
 * VEL-PAYMOB-ATTEMPT-LIFECYCLE-FIX-04 — local SQL full lifecycle path.
 * Opt-in: VELORA_FIX04_LOCAL_DB=access_local_20261006 VELORA_FIX04_ALLOW_DOCKER=1
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  mapConfirmFailedRpcPayload,
  mapOpenAfterFailedRpcPayload,
  mapResolveOrCreateRpcPayload,
} from "@/lib/billing/wiring/attempt-resolve-rpc";

const CONTAINER = "velora-access-local-20261006";
const DB = "access_local_20261006";
const USER = "f1040000-0000-4000-8000-000000000001";
const COMPANY = "f2040000-0000-4000-8000-000000000001";
const PLAN = "f3040000-0000-4000-8000-000000000001";
const PLAN_VER = "f4040000-0000-4000-8000-000000000001";
const ORDER = "f6040000-0000-4000-8000-000000000001";
const EVENT = "f8040000-0000-4000-8000-000000000001";

const runLocal =
  process.env.VELORA_FIX04_LOCAL_DB === "access_local_20261006" &&
  process.env.VELORA_FIX04_ALLOW_DOCKER === "1";

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

const describeLocal = runLocal ? describe : describe.skip;

describeLocal("FIX-04 local SQL lifecycle", () => {
  beforeAll(async () => {
    const mig04 = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20261006280000_vel_paymob_attempt_lifecycle_fix_04.sql",
      ),
      "utf8",
    );
    const mig05 = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20261006300000_vel_paymob_failure_evidence_fix_05.sql",
      ),
      "utf8",
    );
    await sqlFile(mig04);
    await sqlFile(mig05);
    await sqlFile(`
BEGIN;
DELETE FROM public.billing_provider_events WHERE company_id = ${lit(COMPANY)};
DELETE FROM public.billing_payment_attempts WHERE company_id = ${lit(COMPANY)};
DELETE FROM public.billing_orders WHERE company_id = ${lit(COMPANY)};
DELETE FROM public.billing_plan_versions WHERE id = ${lit(PLAN_VER)};
DELETE FROM public.billing_plans WHERE id = ${lit(PLAN)};
DELETE FROM public.companies WHERE id = ${lit(COMPANY)};
DELETE FROM auth.users WHERE id = ${lit(USER)};

INSERT INTO auth.users (id, email)
VALUES (${lit(USER)}, 'fix04-lifecycle@test.invalid');
INSERT INTO public.companies (id, display_name, status, created_by)
VALUES (${lit(COMPANY)}, 'FIX04_LIFECYCLE', 'active', ${lit(USER)});
INSERT INTO public.billing_plans (id, code, name, status)
VALUES (${lit(PLAN)}, 'FIX04_LIFECYCLE', 'Fixture', 'active');
INSERT INTO public.billing_plan_versions (
  id, plan_id, version, amount_baisa, period_days, period_unit, period_count, status
) VALUES (${lit(PLAN_VER)}, ${lit(PLAN)}, 1, 5000, 30, 'day', 30, 'published');
INSERT INTO public.billing_orders (
  id, company_id, plan_version_id, amount_baisa, currency,
  period_days, period_unit, period_count,
  provider, provider_account_ref, provider_environment,
  special_reference, client_op_id, input_fingerprint, status,
  product_code, purchase_purpose
) VALUES (
  ${lit(ORDER)}, ${lit(COMPANY)}, ${lit(PLAN_VER)}, 5000, 'OMR',
  30, 'day', 30,
  'paymob', '71610', 'test',
  'FIX04_LIFECYCLE_ORDER', 'fix04-op', 'fix04-fp', 'locked',
  'velora_ai_staff', 'initial'
);
COMMIT;
`);
  }, 120_000);

  afterAll(async () => {
    await sqlFile(`
BEGIN;
DELETE FROM public.billing_provider_events WHERE company_id = ${lit(COMPANY)};
DELETE FROM public.billing_payment_attempts WHERE company_id = ${lit(COMPANY)};
DELETE FROM public.billing_orders WHERE company_id = ${lit(COMPANY)};
DELETE FROM public.billing_plan_versions WHERE id = ${lit(PLAN_VER)};
DELETE FROM public.billing_plans WHERE id = ${lit(PLAN)};
DELETE FROM public.companies WHERE id = ${lit(COMPANY)};
DELETE FROM auth.users WHERE id = ${lit(USER)};
COMMIT;
`).catch(() => undefined);
  }, 60_000);

  it("unresolved blocks status-failed; evidenced confirm → concurrent open same id → resolve returns new", async () => {
    await sql(`DELETE FROM public.billing_provider_events WHERE company_id = ${lit(COMPANY)}`);
    await sql(`DELETE FROM public.billing_payment_attempts WHERE order_id = ${lit(ORDER)}`);

    const created = mapResolveOrCreateRpcPayload(
      JSON.parse(
        await sql(
          `SELECT public.billing_resolve_or_create_payment_attempt(${lit(ORDER)}::uuid, ${lit(COMPANY)}::uuid)`,
        ),
      ),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const priorId = created.paymentAttemptId;

    await sql(
      `SELECT public.billing_set_payment_attempt_lifecycle_status(${lit(priorId)}::uuid, ${lit(COMPANY)}::uuid, 'unresolved')`,
    );

    // Status-only failed must fail.
    await expect(
      sql(
        `SELECT public.billing_set_payment_attempt_lifecycle_status(${lit(priorId)}::uuid, ${lit(COMPANY)}::uuid, 'failed')`,
      ),
    ).rejects.toThrow(/not allowed|failed requires/i);

    // Cosmetic flag rejected.
    await expect(
      sql(
        `SELECT public.billing_confirm_payment_attempt_failed(${lit(priorId)}::uuid, ${lit(COMPANY)}::uuid, '{"confirmed":true}'::jsonb)`,
      ),
    ).rejects.toThrow(/cosmetic|not accepted/i);

    // No event → stays unresolved.
    await expect(
      sql(
        `SELECT public.billing_confirm_payment_attempt_failed(${lit(priorId)}::uuid, ${lit(COMPANY)}::uuid, '{"provider_event_id":"${EVENT}"}'::jsonb)`,
      ),
    ).rejects.toThrow(/no failed provider event|bound/i);

    const unresolvedResolve = mapResolveOrCreateRpcPayload(
      JSON.parse(
        await sql(
          `SELECT public.billing_resolve_or_create_payment_attempt(${lit(ORDER)}::uuid, ${lit(COMPANY)}::uuid)`,
        ),
      ),
    );
    expect(unresolvedResolve).toMatchObject({
      ok: true,
      paymentAttemptId: priorId,
      status: "unresolved",
    });

    await sql(`
      INSERT INTO public.billing_provider_events (
        id, payment_attempt_id, provider, provider_account_ref, provider_environment,
        provider_transaction_id, event_status, observation_key, company_id
      ) VALUES (
        ${lit(EVENT)}, ${lit(priorId)}, 'paymob', '71610', 'test',
        'fix04-txn-fail', 'failed', 'fix04-obs', ${lit(COMPANY)}
      )
    `);

    const confirmed = mapConfirmFailedRpcPayload(
      JSON.parse(
        await sql(
          `SELECT public.billing_confirm_payment_attempt_failed(${lit(priorId)}::uuid, ${lit(COMPANY)}::uuid, ${lit(JSON.stringify({ provider_event_id: EVENT }))}::jsonb)`,
        ),
      ),
    );
    expect(confirmed).toMatchObject({ ok: true, paymentAttemptId: priorId, status: "failed" });

    const openSql = `SELECT public.billing_open_payment_attempt_after_confirmed_failed(${lit(ORDER)}::uuid, ${lit(COMPANY)}::uuid, ${lit(priorId)}::uuid, 'fix04-open-op')`;
    const [a, b] = await Promise.all([
      sql(openSql).then((out) => mapOpenAfterFailedRpcPayload(JSON.parse(out))),
      sql(openSql).then((out) => mapOpenAfterFailedRpcPayload(JSON.parse(out))),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (!(a.ok && b.ok)) return;
    expect(a.paymentAttemptId).toBe(b.paymentAttemptId);
    expect(a.paymentAttemptId).not.toBe(priorId);

    // Mismatched open_client_op rejected.
    await expect(
      sql(
        `SELECT public.billing_open_payment_attempt_after_confirmed_failed(${lit(ORDER)}::uuid, ${lit(COMPANY)}::uuid, ${lit(priorId)}::uuid, 'fix04-open-OTHER')`,
      ),
    ).rejects.toThrow(/mismatch|conflict/i);

    const after = mapResolveOrCreateRpcPayload(
      JSON.parse(
        await sql(
          `SELECT public.billing_resolve_or_create_payment_attempt(${lit(ORDER)}::uuid, ${lit(COMPANY)}::uuid)`,
        ),
      ),
    );
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.paymentAttemptId).toBe(a.paymentAttemptId);
    expect(after.status).toBe("intent_created");

    const [counts] = await rows(`
      SELECT
        count(*)::int AS attempts,
        count(*) FILTER (WHERE status = 'failed')::int AS failed,
        count(*) FILTER (WHERE status = 'intent_created')::int AS bootstrap,
        count(*) FILTER (WHERE status = 'unresolved')::int AS unresolved
      FROM public.billing_payment_attempts
      WHERE order_id = ${lit(ORDER)}
    `);
    expect(counts).toEqual({ attempts: 2, failed: 1, bootstrap: 1, unresolved: 0 });
  }, 120_000);
});
