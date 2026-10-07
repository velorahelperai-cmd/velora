/**
 * VEL-PAYMOB-FAILURE-EVIDENCE-FIX-05 — local SQL evidence cases.
 * Opt-in: VELORA_FIX05_LOCAL_DB=access_local_20261006 VELORA_FIX05_ALLOW_DOCKER=1
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  mapConfirmFailedRpcPayload,
  mapOpenAfterFailedRpcPayload,
} from "@/lib/billing/wiring/attempt-resolve-rpc";

const CONTAINER = "velora-access-local-20261006";
const DB = "access_local_20261006";
const USER = "a1050000-0000-4000-8000-000000000001";
const COMPANY = "a2050000-0000-4000-8000-000000000001";
const PLAN = "a3050000-0000-4000-8000-000000000001";
const PLAN_VER = "a4050000-0000-4000-8000-000000000001";
const ORDER = "a6050000-0000-4000-8000-000000000001";

const runLocal =
  process.env.VELORA_FIX05_LOCAL_DB === "access_local_20261006" &&
  process.env.VELORA_FIX05_ALLOW_DOCKER === "1";

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

async function resetAttempts() {
  await sql(`DELETE FROM public.billing_provider_events WHERE company_id = ${lit(COMPANY)}`);
  await sql(`DELETE FROM public.billing_payment_attempts WHERE order_id = ${lit(ORDER)}`);
}

async function createAttempt(): Promise<string> {
  const created = JSON.parse(
    await sql(
      `SELECT public.billing_resolve_or_create_payment_attempt(${lit(ORDER)}::uuid, ${lit(COMPANY)}::uuid)`,
    ),
  );
  expect(created.ok).toBe(true);
  await sql(
    `SELECT public.billing_set_payment_attempt_lifecycle_status(${lit(created.payment_attempt_id)}::uuid, ${lit(COMPANY)}::uuid, 'unresolved')`,
  );
  return created.payment_attempt_id as string;
}

const describeLocal = runLocal ? describe : describe.skip;

describeLocal("FIX-05 gate local SQL (four review findings)", () => {
  beforeAll(async () => {
    await sqlFile(
      readFileSync(
        resolve(
          process.cwd(),
          "supabase/migrations/20261006300000_vel_paymob_failure_evidence_fix_05.sql",
        ),
        "utf8",
      ),
    );
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
VALUES (${lit(USER)}, 'fix05-evidence@test.invalid');
INSERT INTO public.companies (id, display_name, status, created_by)
VALUES (${lit(COMPANY)}, 'FIX05_EVIDENCE', 'active', ${lit(USER)});
INSERT INTO public.billing_plans (id, code, name, status)
VALUES (${lit(PLAN)}, 'FIX05_EVIDENCE', 'Fixture', 'active');
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
  'FIX05_EVIDENCE_ORDER', 'fix05-op', 'fix05-fp', 'locked',
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

  it("PASS: different-txn failed does not clear pending A (finding 1)", async () => {
    await resetAttempts();
    const attemptId = await createAttempt();
    const evtFail = "b8050000-0000-4000-8000-000000000001";
    const evtPend = "b8050000-0000-4000-8000-000000000002";

    await sql(`
      INSERT INTO public.billing_provider_events (
        id, payment_attempt_id, provider, provider_account_ref, provider_environment,
        provider_transaction_id, event_status, observation_key, company_id
      ) VALUES
      (${lit(evtPend)}, ${lit(attemptId)}, 'paymob', '71610', 'test', '840050', 'pending', 'obs-a', ${lit(COMPANY)}),
      (${lit(evtFail)}, ${lit(attemptId)}, 'paymob', '71610', 'test', '840051', 'failed', 'obs-b', ${lit(COMPANY)})
    `);

    await expect(
      sql(
        `SELECT public.billing_confirm_payment_attempt_failed(${lit(attemptId)}::uuid, ${lit(COMPANY)}::uuid, ${lit(
          JSON.stringify({
            provider_event_id: evtFail,
            provider_transaction_id: "840050",
            observation_key: "obs-a",
          }),
        )}::jsonb)`,
      ),
    ).rejects.toThrow(/transaction identity mismatch/i);

    await expect(
      sql(
        `SELECT public.billing_confirm_payment_attempt_failed(${lit(attemptId)}::uuid, ${lit(COMPANY)}::uuid, ${lit(
          JSON.stringify({ provider_event_id: evtFail }),
        )}::jsonb)`,
      ),
    ).rejects.toThrow(/other transaction outcome still open/i);

    const [st] = await rows(`
      SELECT status FROM public.billing_payment_attempts where id = ${lit(attemptId)}
    `);
    expect(st.status).toBe("unresolved");
    const [counts] = await rows(`
      SELECT
        count(*) FILTER (WHERE event_status = 'pending')::int AS pending,
        count(*) FILTER (WHERE event_status = 'failed')::int AS failed
      FROM public.billing_provider_events WHERE payment_attempt_id = ${lit(attemptId)}
    `);
    expect(counts).toEqual({ pending: 1, failed: 1 });
  }, 120_000);

  it("PASS: event id vs txn id conflict rejects (finding 1)", async () => {
    await resetAttempts();
    const attemptId = await createAttempt();
    const evtFail = "b8050000-0000-4000-8000-000000000011";
    await sql(`
      INSERT INTO public.billing_provider_events (
        id, payment_attempt_id, provider, provider_account_ref, provider_environment,
        provider_transaction_id, event_status, observation_key, company_id
      ) VALUES (
        ${lit(evtFail)}, ${lit(attemptId)}, 'paymob', '71610', 'test',
        'txn-real', 'failed', 'obs-1', ${lit(COMPANY)}
      )
    `);

    await expect(
      sql(
        `SELECT public.billing_confirm_payment_attempt_failed(${lit(attemptId)}::uuid, ${lit(COMPANY)}::uuid, ${lit(
          JSON.stringify({
            provider_event_id: evtFail,
            provider_transaction_id: "txn-OTHER",
          }),
        )}::jsonb)`,
      ),
    ).rejects.toThrow(/transaction identity mismatch/i);

    const [st] = await rows(`
      SELECT status from public.billing_payment_attempts where id = ${lit(attemptId)}
    `);
    expect(st.status).toBe("unresolved");
  }, 60_000);

  it("PASS: success then stale failed blocks confirm+open; success kept (finding 2)", async () => {
    await resetAttempts();
    const attemptId = await createAttempt();
    const evtOk = "b8050000-0000-4000-8000-000000000021";
    const evtFail = "b8050000-0000-4000-8000-000000000022";

    // First only failed → confirm marks failed; then success arrives (awaiting settlement).
    await sql(`
      INSERT INTO public.billing_provider_events (
        id, payment_attempt_id, provider, provider_account_ref, provider_environment,
        provider_transaction_id, event_status, observation_key, company_id
      ) VALUES (
        ${lit(evtFail)}, ${lit(attemptId)}, 'paymob', '71610', 'test',
        '840060', 'failed', 'failed-notice', ${lit(COMPANY)}
      )
    `);
    const confirmed = mapConfirmFailedRpcPayload(
      JSON.parse(
        await sql(
          `SELECT public.billing_confirm_payment_attempt_failed(${lit(attemptId)}::uuid, ${lit(COMPANY)}::uuid, ${lit(
            JSON.stringify({ provider_event_id: evtFail }),
          )}::jsonb)`,
        ),
      ),
    );
    expect(confirmed).toMatchObject({ ok: true, status: "failed" });

    await sql(`
      INSERT INTO public.billing_provider_events (
        id, payment_attempt_id, provider, provider_account_ref, provider_environment,
        provider_transaction_id, event_status, observation_key, company_id
      ) VALUES (
        ${lit(evtOk)}, ${lit(attemptId)}, 'paymob', '71610', 'test',
        '840060', 'success', 'captured', ${lit(COMPANY)}
      )
    `);

    // Stale re-confirm of failed must not win over stored success.
    await expect(
      sql(
        `SELECT public.billing_confirm_payment_attempt_failed(${lit(attemptId)}::uuid, ${lit(COMPANY)}::uuid, ${lit(
          JSON.stringify({ provider_event_id: evtFail }),
        )}::jsonb)`,
      ),
    ).rejects.toThrow(/stored success awaiting settlement blocks failed confirm/i);

    await expect(
      sql(
        `SELECT public.billing_open_payment_attempt_after_confirmed_failed(${lit(ORDER)}::uuid, ${lit(COMPANY)}::uuid, ${lit(attemptId)}::uuid, 'fix05-open')`,
      ),
    ).rejects.toThrow(/stored success awaiting settlement blocks retry open/i);

    const [counts] = await rows(`
      SELECT
        (SELECT count(*)::int FROM public.billing_payment_attempts WHERE order_id = ${lit(ORDER)}) AS attempts,
        (SELECT count(*)::int FROM public.billing_provider_events WHERE id = ${lit(evtOk)} AND event_status = 'success') AS success_kept,
        (SELECT count(*)::int FROM public.billing_provider_events WHERE id = ${lit(evtFail)} AND event_status = 'failed') AS failed_kept
    `);
    expect(counts).toEqual({ attempts: 1, success_kept: 1, failed_kept: 1 });
  }, 120_000);

  it("PASS: concurrent success+failed: no new collection; both events retained", async () => {
    await resetAttempts();
    const attemptId = await createAttempt();
    const evtOk = "b8050000-0000-4000-8000-000000000031";
    const evtFail = "b8050000-0000-4000-8000-000000000032";

    await sql(`
      INSERT INTO public.billing_provider_events (
        id, payment_attempt_id, provider, provider_account_ref, provider_environment,
        provider_transaction_id, event_status, observation_key, company_id
      ) VALUES
      (${lit(evtOk)}, ${lit(attemptId)}, 'paymob', '71610', 'test', '840070', 'success', 'captured', ${lit(COMPANY)}),
      (${lit(evtFail)}, ${lit(attemptId)}, 'paymob', '71610', 'test', '840070', 'failed', 'failed-notice', ${lit(COMPANY)})
    `);

    const confirmSql = `SELECT public.billing_confirm_payment_attempt_failed(${lit(attemptId)}::uuid, ${lit(COMPANY)}::uuid, ${lit(
      JSON.stringify({ provider_event_id: evtFail }),
    )}::jsonb)`;

    const [r1, r2] = await Promise.allSettled([sql(confirmSql), sql(confirmSql)]);
    expect(r1.status).toBe("rejected");
    expect(r2.status).toBe("rejected");

    await expect(
      sql(
        `SELECT public.billing_open_payment_attempt_after_confirmed_failed(${lit(ORDER)}::uuid, ${lit(COMPANY)}::uuid, ${lit(attemptId)}::uuid, 'fix05-concurrent-open')`,
      ),
    ).rejects.toThrow(/success|failed|prior must/i);

    const [ev] = await rows(`
      SELECT
        (SELECT count(*)::int FROM public.billing_payment_attempts WHERE order_id = ${lit(ORDER)}) AS attempts,
        (SELECT count(*)::int FROM public.billing_provider_events WHERE payment_attempt_id = ${lit(attemptId)} AND event_status = 'success') AS success,
        (SELECT count(*)::int FROM public.billing_provider_events WHERE payment_attempt_id = ${lit(attemptId)} AND event_status = 'failed') AS failed
    `);
    expect(ev).toEqual({ attempts: 1, success: 1, failed: 1 });
    void mapOpenAfterFailedRpcPayload;
  }, 120_000);
});
