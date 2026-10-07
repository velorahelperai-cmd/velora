/**
 * VEL-PAYMOB-ATTEMPT-REPAIR-FIX-03 — two-connection SQL race (local docker only).
 * Opt-in: VELORA_FIX03_LOCAL_DB=access_local_20261006 VELORA_FIX03_ALLOW_DOCKER=1
 * No Paymob HTTP. Fixtures cleaned in afterAll.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveAttemptForOrder } from "@/lib/billing/wiring/order-create-persist";
import { mapResolveOrCreateRpcPayload } from "@/lib/billing/wiring/attempt-resolve-rpc";

const CONTAINER = "velora-access-local-20261006";
const DB = "access_local_20261006";
const USER = "f1030000-0000-4000-8000-000000000001";
const COMPANY = "f2030000-0000-4000-8000-000000000001";
const PLAN = "f3030000-0000-4000-8000-000000000001";
const PLAN_VER = "f4030000-0000-4000-8000-000000000001";
const ORDER = "f6030000-0000-4000-8000-000000000001";

const runLocal =
  process.env.VELORA_FIX03_LOCAL_DB === "access_local_20261006" &&
  process.env.VELORA_FIX03_ALLOW_DOCKER === "1";

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

function lit(v: string) {
  return `'${String(v).replaceAll("'", "''")}'`;
}

async function rows(query: string) {
  const out = await sql(
    `SELECT coalesce(jsonb_agg(q), '[]'::jsonb) FROM (${query}) q;`,
  );
  return JSON.parse(out) as Array<Record<string, unknown>>;
}

const describeLocal = runLocal ? describe : describe.skip;

describeLocal("FIX-03 local SQL two-connection lifecycle race", () => {
  beforeAll(async () => {
    const mig = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20261006260000_vel_paymob_attempt_repair_fix_03.sql",
      ),
      "utf8",
    );
    await sqlFile(mig);

    await sqlFile(`
BEGIN;
DELETE FROM public.billing_payment_attempts WHERE company_id = ${lit(COMPANY)};
DELETE FROM public.billing_orders WHERE company_id = ${lit(COMPANY)};
DELETE FROM public.billing_plan_versions WHERE id = ${lit(PLAN_VER)};
DELETE FROM public.billing_plans WHERE id = ${lit(PLAN)};
DELETE FROM public.companies WHERE id = ${lit(COMPANY)};
DELETE FROM auth.users WHERE id = ${lit(USER)};

INSERT INTO auth.users (id, email)
VALUES (${lit(USER)}, 'fix03-attempt-repair@test.invalid');

INSERT INTO public.companies (id, display_name, status, created_by)
VALUES (${lit(COMPANY)}, 'FIX03_ATTEMPT_REPAIR', 'active', ${lit(USER)});

INSERT INTO public.billing_plans (id, code, name, status)
VALUES (${lit(PLAN)}, 'FIX03_ATTEMPT_REPAIR', 'Fixture', 'active');

INSERT INTO public.billing_plan_versions (
  id, plan_id, version, amount_baisa, period_days, period_unit, period_count, status
) VALUES (
  ${lit(PLAN_VER)}, ${lit(PLAN)}, 1, 5000, 30, 'day', 30, 'published'
);

INSERT INTO public.billing_orders (
  id, company_id, plan_version_id, amount_baisa, currency,
  period_days, period_unit, period_count,
  provider, provider_account_ref, provider_environment,
  special_reference, client_op_id, input_fingerprint, status
) VALUES (
  ${lit(ORDER)}, ${lit(COMPANY)}, ${lit(PLAN_VER)}, 5000, 'OMR',
  30, 'day', 30,
  'paymob', '71610', 'test',
  'FIX03_RACE_ORDER', 'fix03-race-op', 'fix03-race-fp', 'locked'
);
COMMIT;
`);
  }, 120_000);

  afterAll(async () => {
    await sqlFile(`
BEGIN;
DELETE FROM public.billing_payment_attempts WHERE company_id = ${lit(COMPANY)};
DELETE FROM public.billing_orders WHERE company_id = ${lit(COMPANY)};
DELETE FROM public.billing_plan_versions WHERE id = ${lit(PLAN_VER)};
DELETE FROM public.billing_plans WHERE id = ${lit(PLAN)};
DELETE FROM public.companies WHERE id = ${lit(COMPANY)};
DELETE FROM auth.users WHERE id = ${lit(USER)};
COMMIT;
`).catch(() => undefined);
  }, 60_000);

  it("two connections: create→unresolved then second resolve → one attempt, same id", async () => {
    await sql(`DELETE FROM public.billing_payment_attempts WHERE order_id = ${lit(ORDER)}`);

    const resolveRpc = async () => {
      const out = await sql(
        `SELECT public.billing_resolve_or_create_payment_attempt(${lit(ORDER)}::uuid, ${lit(COMPANY)}::uuid)`,
      );
      return mapResolveOrCreateRpcPayload(JSON.parse(out));
    };

    let firstId: string | null = null;
    let releaseSecond!: () => void;
    const gate = new Promise<void>((r) => {
      releaseSecond = r;
    });

    const first = (async () => {
      const r = await resolveRpc();
      expect(r.ok).toBe(true);
      if (!r.ok) return r;
      firstId = r.paymentAttemptId;
      await sql(
        `SELECT public.billing_set_payment_attempt_lifecycle_status(${lit(r.paymentAttemptId)}::uuid, ${lit(COMPANY)}::uuid, 'unresolved')`,
      );
      releaseSecond();
      return r;
    })();

    const second = (async () => {
      const pending = resolveRpc();
      await gate;
      return pending;
    })();

    const viaTs = resolveAttemptForOrder({
      deps: {
        resolveOrCreateAttempt: async () => {
          await gate;
          return resolveRpc();
        },
        findLatestAttempt: async () => null,
        insertAttempt: async () => ({ ok: false as const, code: "no" }),
      },
      orderId: ORDER,
      companyId: COMPANY,
    });

    const [a, b, c] = await Promise.all([first, second, viaTs]);
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!(a.ok && b.ok && c.ok)) return;
    expect(a.paymentAttemptId).toBe(firstId);
    expect(b.paymentAttemptId).toBe(firstId);
    expect(c.paymentAttemptId).toBe(firstId);

    const [counts] = await rows(`
      SELECT
        count(*)::int AS attempts,
        count(*) FILTER (WHERE status = 'unresolved')::int AS unresolved,
        count(*) FILTER (WHERE status = 'intent_created')::int AS bootstrap
      FROM public.billing_payment_attempts
      WHERE order_id = ${lit(ORDER)}
    `);
    expect(counts).toEqual({ attempts: 1, unresolved: 1, bootstrap: 0 });
  }, 120_000);

  it("explicit after confirmed failed opens a new attempt", async () => {
    await sql(`DELETE FROM public.billing_payment_attempts WHERE order_id = ${lit(ORDER)}`);
    await sql(`DELETE FROM public.billing_provider_events WHERE company_id = ${lit(COMPANY)}`);
    // FIX-03 local suite may run before FIX-04 migration; skip if confirm RPC absent.
    const hasConfirm = await sql(
      `SELECT to_regprocedure('public.billing_confirm_payment_attempt_failed(uuid,uuid,jsonb)') IS NOT NULL`,
    );
    if (hasConfirm !== "t") {
      // Legacy FIX-03 path only — do not assert failed via lifecycle after FIX-04.
      return;
    }
    const created = JSON.parse(
      await sql(
        `SELECT public.billing_resolve_or_create_payment_attempt(${lit(ORDER)}::uuid, ${lit(COMPANY)}::uuid)`,
      ),
    );
    const id1 = String(created.payment_attempt_id);
    const eventId = "f8030000-0000-4000-8000-000000000099";
    await sql(`
      INSERT INTO public.billing_provider_events (
        id, payment_attempt_id, provider, provider_account_ref, provider_environment,
        provider_transaction_id, event_status, observation_key, company_id
      ) VALUES (
        ${lit(eventId)}, ${lit(id1)}, 'paymob', '71610', 'test',
        'fix03-compat-fail', 'failed', 'fix03-obs', ${lit(COMPANY)}
      )
    `);
    await sql(
      `SELECT public.billing_confirm_payment_attempt_failed(${lit(id1)}::uuid, ${lit(COMPANY)}::uuid, ${lit(JSON.stringify({ provider_event_id: eventId }))}::jsonb)`,
    );
    const opened = JSON.parse(
      await sql(
        `SELECT public.billing_open_payment_attempt_after_confirmed_failed(${lit(ORDER)}::uuid, ${lit(COMPANY)}::uuid, ${lit(id1)}::uuid, 'fix03-compat-open')`,
      ),
    );
    expect(String(opened.payment_attempt_id)).not.toBe(id1);
    const [counts] = await rows(`
      SELECT count(*)::int AS attempts
      FROM public.billing_payment_attempts
      WHERE order_id = ${lit(ORDER)}
    `);
    expect(counts).toEqual({ attempts: 2 });
  }, 60_000);
});
