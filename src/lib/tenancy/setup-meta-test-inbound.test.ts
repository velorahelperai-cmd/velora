import { afterEach, describe, expect, it, vi } from "vitest";
import {
  evaluateSetupMetaTestInbound,
  saveSetupMetaTestInboundReceiveOnly,
  SetupMetaTestInboundRejectError,
  SETUP_META_TEST_RECEIVE_ONLY_RESULT_CODE,
} from "./setup-meta-test-inbound";
import { signatureMatches } from "@/lib/whatsapp/webhook";
import { externalSendAllowed, whatsappRoutingMode } from "@/lib/whatsapp/config";
import { isLiveAnsweringEnabled } from "@/lib/answers/guards";
import { createHmac, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const exec = promisify(execFile);

async function isolatedPostgres() {
  const name = "velora-meta-test-" + randomUUID();
  const run = randomUUID();
  const docker = async (args: string[]) =>
    (
      await exec("docker", ["--host", "npipe:////./pipe/docker_engine", ...args], {
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 8 * 1024 * 1024,
      })
    ).stdout.trim();
  await docker([
    "run",
    "--pull=never",
    "-d",
    "--name",
    name,
    "--label",
    "velora.meta.test=" + run,
    "--network",
    "none",
    "--tmpfs",
    "/var/lib/postgresql/data:rw,size=256m",
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "postgres:17.6-alpine",
  ]);
  const verify = async () => {
    const inspected = JSON.parse(await docker(["inspect", name])) as Array<{
      Config: { Labels: Record<string, string> };
      HostConfig: { NetworkMode: string; PortBindings?: Record<string, unknown> };
    }>;
    const c = inspected[0];
    if (
      c.Config.Labels["velora.meta.test"] !== run ||
      c.HostConfig.NetworkMode !== "none" ||
      Object.keys(c.HostConfig.PortBindings ?? {}).length
    ) {
      throw new Error("UNSAFE_LOCAL_DATABASE");
    }
  };
  const sql = async (text: string) => {
    await verify();
    return new Promise<string>((ok, fail) => {
      const p = spawn(
        "docker",
        [
          "--host",
          "npipe:////./pipe/docker_engine",
          "exec",
          "-i",
          "-u",
          "postgres",
          name,
          "psql",
          "-X",
          "-Atq",
          "-v",
          "ON_ERROR_STOP=1",
        ],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        p.kill();
        fail(new Error("LOCAL_SQL_TIMEOUT"));
      }, 60000);
      p.stdout.on("data", (b: Buffer) => {
        stdout += b.toString();
      });
      p.stderr.on("data", (b: Buffer) => {
        stderr += b.toString();
      });
      p.on("error", (e) => {
        clearTimeout(timer);
        fail(e);
      });
      p.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) ok(stdout.trim());
        else fail(new Error(stderr || "LOCAL_SQL_FAILED"));
      });
      p.stdin.end(text);
    });
  };
  for (let i = 0; i < 50; i++) {
    try {
      await sql("select 1");
      break;
    } catch {
      if (i === 49) throw new Error("LOCAL_DATABASE_NOT_READY");
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return {
    sql,
    file: async (filePath: string) => sql(readFileSync(filePath, "utf8")),
    close: async () => {
      await verify();
      await docker(["rm", "-f", name]);
    },
  };
}

const TAG = {
  accountId: "177ef439-3fb0-4e3e-96b8-2a9e8661386d",
  companyId: "40d2d885-8b63-49c4-b3da-d2e9566f2750",
  branchId: "a268f9d8-fe5b-41b2-a337-97046a5eaa5c",
  phoneNumberId: "1261345677073276",
  wabaId: "2057350774985092",
  recipientWaId: "96876351423",
  appId: "123456789012345",
} as const;

const now = Date.parse("2026-10-29T12:00:00.000Z");

function openEnv(patch: Record<string, string> = {}) {
  return {
    WHATSAPP_CONFIGURATION_MODE: "meta_test",
    VELORA_SETUP_META_TEST_ENABLED: "true",
    VELORA_SETUP_META_TEST_ACCOUNT_ID: TAG.accountId,
    VELORA_SETUP_META_TEST_COMPANY_ID: TAG.companyId,
    VELORA_SETUP_META_TEST_BRANCH_ID: TAG.branchId,
    VELORA_SETUP_META_TEST_EXPIRES_AT: "2026-10-31T06:05:04.643Z",
    VELORA_SETUP_META_TEST_RECIPIENT_WA_ID: TAG.recipientWaId,
    WHATSAPP_TEST_COMPANY_ID: TAG.companyId,
    WHATSAPP_TEST_PHONE_NUMBER_ID: TAG.phoneNumberId,
    WHATSAPP_TEST_WABA_ID: TAG.wabaId,
    WHATSAPP_EMBEDDED_SIGNUP_APP_ID: TAG.appId,
    WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION: "v26.0",
    ...patch,
  };
}

const message = {
  wabaId: TAG.wabaId,
  phoneNumberId: TAG.phoneNumberId,
  customerWaId: TAG.recipientWaId,
  customerName: "Synthetic",
  waMessageId: "wamid.setup-meta-test",
  body: "synthetic",
  messageType: "text",
  receivedAt: "2026-10-29T12:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("evaluateSetupMetaTestInbound server fence", () => {
  it("allows only the pinned TAG CITY company/branch/WABA/phone/recipient while the gateway is open", () => {
    expect(evaluateSetupMetaTestInbound(TAG.companyId, message, openEnv(), now)).toMatchObject({
      ok: true,
      recipientWaId: TAG.recipientWaId,
      wabaId: TAG.wabaId,
      phoneNumberId: TAG.phoneNumberId,
    });
  });

  it.each([
    ["setup_meta_test_gateway_closed", { VELORA_SETUP_META_TEST_ENABLED: "false" }],
    ["setup_meta_test_gateway_closed", { VELORA_SETUP_META_TEST_EXPIRES_AT: "2026-10-28T00:00:00.000Z" }],
    ["setup_meta_test_gateway_closed", { VELORA_SETUP_META_TEST_BRANCH_ID: "99999999-9999-4999-8999-999999999999" }],
    ["test_company_pin_mismatch", { WHATSAPP_TEST_COMPANY_ID: "7c5e429d-2be3-4578-bf15-8db2fdb5647f" }],
    ["recipient_mismatch", { VELORA_SETUP_META_TEST_RECIPIENT_WA_ID: "15550001111" }],
  ] as const)("rejects %s", (code, patch) => {
    expect(evaluateSetupMetaTestInbound(TAG.companyId, message, openEnv(patch), now)).toEqual({
      ok: false,
      code,
    });
  });

  it("rejects WABA, phone, company and foreign recipient mismatches", () => {
    const env = openEnv();
    expect(
      evaluateSetupMetaTestInbound(TAG.companyId, { ...message, wabaId: "0000000000000000" }, env, now),
    ).toEqual({ ok: false, code: "waba_mismatch" });
    expect(
      evaluateSetupMetaTestInbound(TAG.companyId, { ...message, phoneNumberId: "000000000000000" }, env, now),
    ).toEqual({ ok: false, code: "phone_mismatch" });
    expect(
      evaluateSetupMetaTestInbound(TAG.companyId, { ...message, customerWaId: "15551234567" }, env, now),
    ).toEqual({ ok: false, code: "recipient_mismatch" });
    expect(
      evaluateSetupMetaTestInbound("11111111-1111-4111-8111-111111111111", message, env, now),
    ).toEqual({ ok: false, code: "company_mismatch" });
  });

  it("requires a valid Meta signature independently of the inbound fence", () => {
    const body = Buffer.from('{"object":"whatsapp_business_account"}');
    const secret = "synthetic-only-app-secret";
    const good = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(signatureMatches(body, good, secret)).toBe(true);
    expect(signatureMatches(body, good, "other-secret")).toBe(false);
    expect(signatureMatches(body, "sha256=" + "0".repeat(64), secret)).toBe(false);
  });

  it("does not enable worker rollout under meta_test merely by turning WHATSAPP_WORKER_ENABLED on", () => {
    for (const [key, value] of Object.entries({
      ...openEnv(),
      WHATSAPP_WORKER_ENABLED: "true",
      WHATSAPP_ALLOW_EXTERNAL_SEND: "true",
      WHATSAPP_TEST_ALLOW_EXTERNAL_SEND: "true",
      WHATSAPP_ROUTING_MODE: "tenant_registry",
      AI_LIVE_ANSWERING: "true",
    })) {
      vi.stubEnv(key, value);
    }
    // Mirrors src/lib/whatsapp/integration-store.ts workerRolloutEnabled().
    // meta_test forces single_tenant, so rollout stays off even with worker=true.
    const routing = whatsappRoutingMode();
    expect(routing).toBe("single_tenant");
    const rollout =
      process.env.WHATSAPP_WORKER_ENABLED === "true" &&
      isLiveAnsweringEnabled() &&
      externalSendAllowed() &&
      routing === "tenant_registry";
    expect(rollout).toBe(false);
  });
});

describe("saveSetupMetaTestInboundReceiveOnly", () => {
  it("saves and prevents the processing job atomically in a single RPC call without post-save claim/complete RPCs", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const admin = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === "save_whatsapp_inbound_receive_only") {
          return {
            data: {
              ok: true,
              inserted: true,
              message_id: "11111111-1111-4111-8111-111111111111",
              conversation_id: "22222222-2222-4222-8222-222222222222",
              job_id: "33333333-3333-4333-8333-333333333333",
              job_status: "completed",
              result_code: SETUP_META_TEST_RECEIVE_ONLY_RESULT_CODE,
            },
            error: null,
          };
        }
        throw new Error(`unexpected rpc ${name}`);
      },
    } as unknown as SupabaseClient<Database>;

    const saved = await saveSetupMetaTestInboundReceiveOnly(admin, TAG.companyId, message, openEnv(), now);
    expect(calls.map((c) => c.name)).toEqual(["save_whatsapp_inbound_receive_only"]);
    expect(calls.some((c) => c.name === "review_store_whatsapp_inbound")).toBe(false);
    expect(calls.some((c) => c.name === "save_whatsapp_inbound")).toBe(false);
    expect(calls.some((c) => c.name === "claim_whatsapp_inbound_job")).toBe(false);
    expect(calls.some((c) => c.name === "complete_whatsapp_inbound_job")).toBe(false);
    expect(saved).toMatchObject({
      inserted: true,
      jobId: "33333333-3333-4333-8333-333333333333",
      jobStatus: "completed",
    });
  });

  it("keeps duplicate wa_message_id as inserted=false and requires atomic receive-only prevention", async () => {
    const admin = {
      rpc: async (name: string) => {
        if (name === "save_whatsapp_inbound_receive_only") {
          return {
            data: {
              ok: true,
              inserted: false,
              message_id: "11111111-1111-4111-8111-111111111111",
              conversation_id: "22222222-2222-4222-8222-222222222222",
              job_id: "33333333-3333-4333-8333-333333333333",
              job_status: "completed",
              result_code: SETUP_META_TEST_RECEIVE_ONLY_RESULT_CODE,
            },
            error: null,
          };
        }
        throw new Error(`unexpected rpc ${name}`);
      },
    } as unknown as SupabaseClient<Database>;
    const saved = await saveSetupMetaTestInboundReceiveOnly(admin, TAG.companyId, message, openEnv(), now);
    expect(saved.inserted).toBe(false);
    expect(saved.jobStatus).toBe("completed");
  });

  it("rejects if the RPC ever returns a runnable or unprevented job status", async () => {
    const admin = {
      rpc: async () => ({
        data: {
          ok: true,
          inserted: true,
          message_id: "11111111-1111-4111-8111-111111111111",
          conversation_id: "22222222-2222-4222-8222-222222222222",
          job_id: "33333333-3333-4333-8333-333333333333",
          job_status: "pending",
          result_code: null,
        },
        error: null,
      }),
    } as unknown as SupabaseClient<Database>;
    await expect(
      saveSetupMetaTestInboundReceiveOnly(admin, TAG.companyId, message, openEnv(), now),
    ).rejects.toThrow("setup_meta_test_atomic_job_prevention_required");
  });

  it("throws a permanent reject before any RPC when the gateway is expired", async () => {
    const rpc = vi.fn();
    const admin = { rpc } as unknown as SupabaseClient<Database>;
    await expect(
      saveSetupMetaTestInboundReceiveOnly(
        admin,
        TAG.companyId,
        message,
        openEnv({ VELORA_SETUP_META_TEST_EXPIRES_AT: "2026-10-28T00:00:00.000Z" }),
        now,
      ),
    ).rejects.toBeInstanceOf(SetupMetaTestInboundRejectError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it(
    "proves single-transaction atomicity, step-failure rollback, and worker race prevention in real PostgreSQL",
    async () => {
      const pg = await isolatedPostgres();
      try {
        await pg.sql(`
          create extension if not exists pgcrypto;
          create schema if not exists private;
          do $$
          begin
            if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
            if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
            if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
          end $$;
          grant usage on schema public to anon, authenticated, service_role;
          grant select on all tables in schema public to service_role;
          alter default privileges in schema public grant select on tables to service_role;

          create table public.companies (
            id uuid primary key,
            status text not null default 'setup'
          );
          create table public.whatsapp_company_links (
            company_id uuid not null references public.companies(id) on delete cascade,
            provider_phone_number_id text not null,
            status text not null default 'connected',
            keep_on_phone boolean not null default false,
            primary key (company_id, provider_phone_number_id)
          );
          create table public.whatsapp_conversations (
            id uuid primary key default gen_random_uuid(),
            company_id uuid not null references public.companies(id) on delete cascade,
            phone_number_id text not null,
            customer_wa_id text not null,
            customer_name text not null default '',
            status text not null default 'open',
            automation_allowed boolean not null default false,
            human_control boolean not null default false,
            last_message_at timestamptz not null default now(),
            created_at timestamptz not null default now(),
            unique (company_id, phone_number_id, customer_wa_id)
          );
          create table public.whatsapp_messages (
            id uuid primary key default gen_random_uuid(),
            company_id uuid not null references public.companies(id) on delete cascade,
            conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
            wa_message_id text not null unique,
            direction text not null,
            sender text not null,
            body text not null,
            message_type text not null default 'text',
            received_at timestamptz not null,
            created_at timestamptz not null default now(),
            delivery_state text,
            delivery_rank integer not null default 0,
            delivery_updated_at timestamptz
          );
          create table public.whatsapp_send_intents (
            id uuid primary key default gen_random_uuid(),
            company_id uuid not null references public.companies(id) on delete cascade,
            original_job_id uuid,
            outcome text not null default 'pending',
            wa_message_id text
          );
          create table public.whatsapp_inbound_jobs (
            id uuid primary key default gen_random_uuid(),
            message_id uuid not null unique references public.whatsapp_messages(id) on delete cascade,
            company_id uuid not null references public.companies(id) on delete cascade,
            wa_message_id text not null unique,
            status text not null default 'pending' check (status in ('pending', 'claimed', 'completed', 'failed', 'retry_wait', 'dead_letter', 'review_required')),
            claim_token uuid,
            claimed_at timestamptz,
            claim_expires_at timestamptz,
            attempt_count integer not null default 0,
            completed_at timestamptz,
            result_code text,
            next_retry_at timestamptz,
            last_error_code text,
            usage_status text not null default 'none',
            send_intent_id uuid references public.whatsapp_send_intents(id),
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
          );

          create or replace function private.whatsapp_inbox_intervention(
            p_company_id uuid,
            p_conversation_id uuid,
            p_human_control boolean
          ) returns text language sql stable security definer set search_path = '' as $$
            select case
              when exists (
                select 1
                  from public.whatsapp_inbound_jobs j
                  join public.whatsapp_messages m
                    on m.id = j.message_id
                   and m.company_id = j.company_id
                 where j.company_id = p_company_id
                   and m.conversation_id = p_conversation_id
                   and j.status = 'review_required'
              ) then 'worker_review'
              when exists (
                select 1
                  from public.whatsapp_inbound_jobs j
                  join public.whatsapp_messages m
                    on m.id = j.message_id
                   and m.company_id = j.company_id
                 where j.company_id = p_company_id
                   and m.conversation_id = p_conversation_id
                   and j.status in ('failed', 'dead_letter')
              ) then 'worker_failed'
              when p_human_control then 'manual_takeover'
              else null
            end;
          $$;

          create or replace function private.wa_save_inbound_pre_coexistence(
            p_company_id uuid,
            p_phone_number_id text,
            p_customer_wa_id text,
            p_customer_name text,
            p_wa_message_id text,
            p_body text,
            p_message_type text,
            p_received_at timestamptz
          ) returns jsonb language plpgsql security definer set search_path = '' as $$
          declare
            v_now timestamptz := pg_catalog.clock_timestamp();
            v_wa_id text := pg_catalog.btrim(p_wa_message_id);
            v_phone_id text := pg_catalog.btrim(p_phone_number_id);
            v_customer_wa text := pg_catalog.btrim(p_customer_wa_id);
            v_customer_name text := coalesce(nullif(pg_catalog.btrim(p_customer_name), ''), v_customer_wa);
            v_received_at timestamptz := coalesce(p_received_at, v_now);
            v_existing_msg public.whatsapp_messages%rowtype;
            v_existing_conv public.whatsapp_conversations%rowtype;
            v_conversation_id uuid;
            v_message_id uuid;
            v_job_id uuid;
            v_job_status text;
            v_inserted boolean := false;
          begin
            perform pg_catalog.pg_advisory_xact_lock(87420101, pg_catalog.hashtext(v_wa_id));
            select * into v_existing_msg from public.whatsapp_messages where wa_message_id = v_wa_id for update;
            if found then
              v_message_id := v_existing_msg.id;
              v_conversation_id := v_existing_msg.conversation_id;
            else
              insert into public.whatsapp_conversations (
                company_id, phone_number_id, customer_wa_id, customer_name, status, automation_allowed, last_message_at, created_at
              ) values (
                p_company_id, v_phone_id, v_customer_wa, v_customer_name, 'open', true, v_received_at, v_now
              )
              on conflict (company_id, phone_number_id, customer_wa_id) do update
                set last_message_at = greatest(public.whatsapp_conversations.last_message_at, excluded.last_message_at)
              returning id into v_conversation_id;

              insert into public.whatsapp_messages (
                company_id, conversation_id, wa_message_id, direction, sender, body, message_type, received_at, created_at
              ) values (
                p_company_id, v_conversation_id, v_wa_id, 'inbound', 'customer', coalesce(p_body, ''), coalesce(p_message_type, 'text'), v_received_at, v_now
              ) returning id into v_message_id;
              v_inserted := true;
            end if;

            insert into public.whatsapp_inbound_jobs (
              message_id, company_id, wa_message_id, status, attempt_count, created_at, updated_at
            ) values (
              v_message_id, p_company_id, v_wa_id, 'pending', 0, v_now, v_now
            )
            on conflict (message_id) do nothing
            returning id, status into v_job_id, v_job_status;

            if v_job_id is null then
              select id, status into v_job_id, v_job_status from public.whatsapp_inbound_jobs where message_id = v_message_id;
            end if;

            return pg_catalog.jsonb_build_object(
              'ok', true,
              'inserted', v_inserted,
              'message_id', v_message_id,
              'conversation_id', v_conversation_id,
              'job_id', v_job_id,
              'job_status', v_job_status
            );
          end $$;

          create or replace function public.save_whatsapp_inbound(
            p_company_id uuid,
            p_phone_number_id text,
            p_customer_wa_id text,
            p_customer_name text,
            p_wa_message_id text,
            p_body text,
            p_message_type text,
            p_received_at timestamptz
          ) returns jsonb language plpgsql security definer set search_path = '' as $$
          declare coex boolean;
          begin
            if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
              raise exception 'SERVER_ROLE_REQUIRED' using errcode = '42501';
            end if;
            perform 1 from public.companies where id = p_company_id for share;
            select keep_on_phone into coex from public.whatsapp_company_links where company_id = p_company_id and provider_phone_number_id = p_phone_number_id for share;
            if coex then return pg_catalog.jsonb_build_object('ok', false, 'code', 'COEXISTENCE_AI_DISABLED'); end if;
            return private.wa_save_inbound_pre_coexistence(
              p_company_id, p_phone_number_id, p_customer_wa_id, p_customer_name, p_wa_message_id, p_body, p_message_type, p_received_at
            );
          end $$;
          grant execute on function public.save_whatsapp_inbound(uuid, text, text, text, text, text, text, timestamptz) to service_role;

          create or replace function public.claim_whatsapp_inbound_job(p_job_id uuid, p_lease_seconds integer default 120)
          returns jsonb language plpgsql security definer set search_path = '' as $$
          declare
            v_now timestamptz := pg_catalog.clock_timestamp();
            v_job public.whatsapp_inbound_jobs%rowtype;
          begin
            if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
              return pg_catalog.jsonb_build_object('ok', false, 'code', 'server_role_required');
            end if;
            update public.whatsapp_inbound_jobs
               set status = 'claimed',
                   claim_token = public.gen_random_uuid(),
                   claimed_at = v_now,
                   claim_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
                   attempt_count = attempt_count + 1,
                   updated_at = v_now
             where id = p_job_id
               and (
                 status = 'pending'
                 or (status = 'retry_wait' and (next_retry_at is null or next_retry_at <= v_now))
                 or (status = 'claimed' and claim_expires_at <= v_now)
               )
             returning * into v_job;
            if not found then
              return pg_catalog.jsonb_build_object('ok', false, 'code', 'not_claimable');
            end if;
            return pg_catalog.jsonb_build_object(
              'ok', true,
              'job_id', v_job.id,
              'message_id', v_job.message_id,
              'company_id', v_job.company_id,
              'wa_message_id', v_job.wa_message_id,
              'claim_token', v_job.claim_token,
              'claim_expires_at', v_job.claim_expires_at,
              'attempt_count', v_job.attempt_count
            );
          end $$;
          grant execute on function public.claim_whatsapp_inbound_job(uuid, integer) to service_role;

          create or replace function public.complete_whatsapp_inbound_job(
            p_job_id uuid,
            p_claim_token uuid,
            p_ok boolean,
            p_result_code text default null
          ) returns jsonb language plpgsql security definer set search_path = '' as $$
          declare
            v_now timestamptz := pg_catalog.clock_timestamp();
            v_job public.whatsapp_inbound_jobs%rowtype;
          begin
            update public.whatsapp_inbound_jobs
               set status = case when p_ok then 'completed' else 'failed' end,
                   claim_token = null,
                   claim_expires_at = null,
                   completed_at = v_now,
                   result_code = p_result_code,
                   updated_at = v_now
             where id = p_job_id
               and status = 'claimed'
               and claim_token = p_claim_token
               and claim_expires_at > v_now
             returning * into v_job;
            if not found then
              return pg_catalog.jsonb_build_object('ok', false, 'code', 'claim_rejected');
            end if;
            return pg_catalog.jsonb_build_object('ok', true, 'job_id', v_job.id, 'status', v_job.status);
          end $$;
          grant execute on function public.complete_whatsapp_inbound_job(uuid, uuid, boolean, text) to service_role;

          create or replace function public.whatsapp_claim_inbound_batch(p_batch_size integer default 5, p_lease_seconds integer default 120)
          returns jsonb language plpgsql security definer set search_path = '' as $$
          declare
            v_items jsonb;
          begin
            with candidates as (
              select j.id
                from public.whatsapp_inbound_jobs j
                join public.whatsapp_messages m on m.id = j.message_id and m.company_id = j.company_id
                join public.whatsapp_conversations c on c.id = m.conversation_id and c.company_id = j.company_id
               where c.status = 'open'
                 and c.automation_allowed = true
                 and (
                   j.status = 'pending'
                   or (j.status = 'retry_wait' and (j.next_retry_at is null or j.next_retry_at <= clock_timestamp()))
                   or (j.status = 'claimed' and j.claim_expires_at <= clock_timestamp())
                 )
               order by j.created_at asc
               for update of j skip locked
               limit p_batch_size
            ),
            claimed as (
              update public.whatsapp_inbound_jobs j
                 set status = 'claimed',
                     claim_token = public.gen_random_uuid(),
                     claimed_at = pg_catalog.clock_timestamp(),
                     claim_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
                     attempt_count = j.attempt_count + 1,
                     updated_at = pg_catalog.clock_timestamp()
                from candidates k
               where j.id = k.id
               returning j.id, j.wa_message_id, j.claim_token
            )
            select coalesce(jsonb_agg(jsonb_build_object('job_id', id, 'wa_message_id', wa_message_id, 'claim_token', claim_token)), '[]'::jsonb)
              into v_items
              from claimed;
            return jsonb_build_object('ok', true, 'items', v_items);
          end $$;
          grant execute on function public.whatsapp_claim_inbound_batch(integer, integer) to service_role;

          insert into public.companies (id, status) values ('${TAG.companyId}'::uuid, 'setup');
        `);

        await pg.file(
          path.resolve(
            process.cwd(),
            "supabase/migrations/20261029165000_setup_meta_test_inbound_receive_only.sql",
          ),
        );

        // 1. Atomic single-transaction save + prevention:
        // Even with automation_allowed = true on the conversation, the committed job is already
        // status='completed', result_code='SETUP_META_TEST_RECEIVE_ONLY', claim_token=null,
        // and private.whatsapp_inbox_intervention is NULL (not 'worker_failed').
        const rpcRes = JSON.parse(
          await pg.sql(`
            set role service_role;
            select public.save_whatsapp_inbound_receive_only(
              '${TAG.companyId}'::uuid,
              '${TAG.phoneNumberId}',
              '${TAG.recipientWaId}',
              'Synthetic',
              'wamid.atomic-1',
              'hello atomic',
              'text',
              '2026-10-29T12:00:00Z'::timestamptz
            )::text;
          `),
        );
        const postCommit = JSON.parse(
          await pg.sql(`
            set role service_role;
            select jsonb_build_object(
              'job', (select to_jsonb(j) from public.whatsapp_inbound_jobs j where j.wa_message_id = 'wamid.atomic-1'),
              'batch_claim', public.whatsapp_claim_inbound_batch(5, 120),
              'direct_claim', public.claim_whatsapp_inbound_job(
                (select id from public.whatsapp_inbound_jobs where wa_message_id = 'wamid.atomic-1'),
                120
              )
            )::text;
          `),
        );
        const intervention = await pg.sql(`
          select coalesce(
            private.whatsapp_inbox_intervention(c.company_id, c.id, c.human_control),
            'NONE'
          )
          from public.whatsapp_conversations c
          where c.company_id = '${TAG.companyId}'::uuid
          limit 1;
        `);

        expect(rpcRes).toMatchObject({
          ok: true,
          inserted: true,
          job_status: "completed",
          result_code: SETUP_META_TEST_RECEIVE_ONLY_RESULT_CODE,
        });
        expect(postCommit.job).toMatchObject({
          status: "completed",
          result_code: SETUP_META_TEST_RECEIVE_ONLY_RESULT_CODE,
          claim_token: null,
          claim_expires_at: null,
        });
        expect(intervention).toBe("NONE");
        expect(postCommit.batch_claim).toEqual({ ok: true, items: [] });
        expect(postCommit.direct_claim).toEqual({ ok: false, code: "not_claimable" });

        // 2. Failure between message insert and job prevention inside the transaction rolls back EVERYTHING:
        // Install a trigger that raises an exception when updating whatsapp_inbound_jobs to 'completed'
        // for wamid.fail-between-steps. Verify 0 messages and 0 jobs exist after failure.
        await pg.sql(`
          create or replace function private.inject_step_failure() returns trigger
          language plpgsql as $$
          begin
            if new.wa_message_id = 'wamid.fail-between-steps' and new.status = 'completed' then
              raise exception 'INJECTED_PREVENTION_STEP_FAILURE';
            end if;
            return new;
          end $$;
          create trigger z_inject_step_failure
            before update on public.whatsapp_inbound_jobs
            for each row execute function private.inject_step_failure();
        `);

        await expect(
          pg.sql(`
            set role service_role;
            select public.save_whatsapp_inbound_receive_only(
              '${TAG.companyId}'::uuid,
              '${TAG.phoneNumberId}',
              '${TAG.recipientWaId}',
              'Synthetic',
              'wamid.fail-between-steps',
              'must rollback completely',
              'text',
              '2026-10-29T12:01:00Z'::timestamptz
            );
          `),
        ).rejects.toThrow(/INJECTED_PREVENTION_STEP_FAILURE/);

        const afterRollback = JSON.parse(
          await pg.sql(`
            select jsonb_build_object(
              'messages', (select count(*) from public.whatsapp_messages where wa_message_id = 'wamid.fail-between-steps'),
              'jobs', (select count(*) from public.whatsapp_inbound_jobs where wa_message_id = 'wamid.fail-between-steps'),
              'pending_jobs', (select count(*) from public.whatsapp_inbound_jobs where status in ('pending', 'retry_wait', 'claimed'))
            )::text;
          `),
        );
        expect(afterRollback).toEqual({ messages: 0, jobs: 0, pending_jobs: 0 });

        await pg.sql(`drop trigger z_inject_step_failure on public.whatsapp_inbound_jobs;`);

        // 3. Concurrent worker race test:
        // Session A runs save_whatsapp_inbound_receive_only while Session B concurrently loops
        // whatsapp_claim_inbound_batch + claim_whatsapp_inbound_job across parallel connections.
        // Also test duplicate redelivery racing against a worker that already claimed a legacy pending job:
        // save_whatsapp_inbound_receive_only revokes claim_token in-transaction so complete_whatsapp_inbound_job rejects!
        const [raceSave, workerLoop] = await Promise.all([
          pg.sql(`
            set role service_role;
            select jsonb_agg(
              public.save_whatsapp_inbound_receive_only(
                '${TAG.companyId}'::uuid,
                '${TAG.phoneNumberId}',
                '${TAG.recipientWaId}',
                'Synthetic',
                'wamid.race-' || g::text,
                'race body ' || g::text,
                'text',
                '2026-10-29T12:02:00Z'::timestamptz
              )
            )::text
            from generate_series(1, 15) as g;
          `),
          pg.sql(`
            set role service_role;
            select jsonb_agg(public.whatsapp_claim_inbound_batch(10, 120))::text
            from generate_series(1, 25);
          `),
        ]);

        const savedBatch = JSON.parse(raceSave) as Array<Record<string, unknown>>;
        const workerClaims = JSON.parse(workerLoop) as Array<{ ok: boolean; items: unknown[] }>;
        expect(savedBatch).toHaveLength(15);
        expect(
          savedBatch.every(
            (r) =>
              r.ok === true &&
              r.job_status === "completed" &&
              r.result_code === SETUP_META_TEST_RECEIVE_ONLY_RESULT_CODE,
          ),
        ).toBe(true);
        expect(workerClaims.flatMap((w) => w.items)).toEqual([]);

        // 4. Duplicate redelivery when a legacy job was already claimed by a worker:
        // Prove that save_whatsapp_inbound_receive_only atomically revokes the claim token and
        // marks the job completed/SETUP_META_TEST_RECEIVE_ONLY so the worker's completion fails with claim_rejected.
        // 4. Duplicate redelivery when a legacy job is claimed or in-flight:
        // Do NOT pull or revoke the active claim on duplicate redelivery.
        // It preserves the worker claim and rejects conversion with RECEIVE_ONLY_UNRESOLVED_JOB,
        // allowing the worker to complete its work safely.
        const legacySaved = JSON.parse(
          await pg.sql(`
            set role service_role;
            select public.save_whatsapp_inbound(
              '${TAG.companyId}'::uuid,
              '${TAG.phoneNumberId}',
              '${TAG.recipientWaId}',
              'Synthetic',
              'wamid.pre-claimed-dup',
              'legacy save',
              'text',
              '2026-10-29T12:03:00Z'::timestamptz
            )::text;
          `),
        );
        const workerClaim = JSON.parse(
          await pg.sql(`
            set role service_role;
            select public.claim_whatsapp_inbound_job('${String(legacySaved.job_id)}'::uuid, 120)::text;
          `),
        );
        expect(workerClaim.ok).toBe(true);

        // Webhook duplicate redelivery must NOT pull the active claim: it rejects conversion.
        await expect(
          pg.sql(`
            set role service_role;
            select public.save_whatsapp_inbound_receive_only(
              '${TAG.companyId}'::uuid,
              '${TAG.phoneNumberId}',
              '${TAG.recipientWaId}',
              'Synthetic',
              'wamid.pre-claimed-dup',
              'legacy save',
              'text',
              '2026-10-29T12:03:00Z'::timestamptz
            );
          `),
        ).rejects.toThrow(/RECEIVE_ONLY_UNRESOLVED_JOB/);

        // Worker claim token is preserved intact and completes successfully:
        const workerComplete = JSON.parse(
          await pg.sql(`
            set role service_role;
            select public.complete_whatsapp_inbound_job(
              '${String(workerClaim.job_id)}'::uuid,
              '${String(workerClaim.claim_token)}'::uuid,
              true,
              'SENT'
            )::text;
          `),
        );
        expect(workerComplete).toEqual({
          ok: true,
          job_id: workerClaim.job_id,
          status: "completed",
        });

        // 5. Ordinary duplicate replay of an already-saved receive-only message:
        // Returns the saved state with inserted=false without mutating the earlier job.
        const replayRes = JSON.parse(
          await pg.sql(`
            set role service_role;
            select public.save_whatsapp_inbound_receive_only(
              '${TAG.companyId}'::uuid,
              '${TAG.phoneNumberId}',
              '${TAG.recipientWaId}',
              'Synthetic',
              'wamid.atomic-1',
              'hello atomic replay',
              'text',
              '2026-10-29T12:04:00Z'::timestamptz
            )::text;
          `),
        );
        expect(replayRes).toMatchObject({
          ok: true,
          inserted: false,
          job_status: "completed",
          result_code: SETUP_META_TEST_RECEIVE_ONLY_RESULT_CODE,
        });
      } finally {
        await pg.close();
      }
    },
    60000,
  );
});
