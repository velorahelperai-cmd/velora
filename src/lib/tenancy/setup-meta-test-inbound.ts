import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { setupMetaTestConfig, type SetupMetaTestScope } from "@/lib/tenancy/setup-meta-test";
import type { InboundMessage } from "@/lib/whatsapp/webhook";
import { type SaveInboundResult } from "@/lib/whatsapp/store-types";

/** Result code stamped atomically inside the receive-only database transaction. */
export const SETUP_META_TEST_RECEIVE_ONLY_RESULT_CODE = "SETUP_META_TEST_RECEIVE_ONLY";

/** Owner-approved TAG CITY Setup Meta-test pin for receive/save-only webhook ingress. */
export const SETUP_META_TEST_INBOUND_SCOPE: SetupMetaTestScope = {
  expectedAccountId: "177ef439-3fb0-4e3e-96b8-2a9e8661386d",
  companyId: "40d2d885-8b63-49c4-b3da-d2e9566f2750",
  branchId: "a268f9d8-fe5b-41b2-a337-97046a5eaa5c",
};

/** Thrown when the pinned Setup Meta-test inbound fence permanently rejects a message. */
export class SetupMetaTestInboundRejectError extends Error {
  readonly code: string;
  readonly permanent = true as const;
  constructor(code: string) {
    super(code);
    this.name = "SetupMetaTestInboundRejectError";
    this.code = code;
  }
}

export type SetupMetaTestInboundAllow =
  | {
      ok: true;
      scope: SetupMetaTestScope;
      expiresAt: string;
      phoneNumberId: string;
      wabaId: string;
      recipientWaId: string;
    }
  | { ok: false; code: string };

const recipientRe = /^[0-9]{7,20}$/;

function envMap(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) {
  return source as Record<string, string | undefined>;
}

function asRecord(value: Json | null | undefined): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Server-only inbound fence: gateway + company/branch pins + Meta test assets + approved recipient. */
export function evaluateSetupMetaTestInbound(
  companyId: string,
  message: Pick<InboundMessage, "wabaId" | "phoneNumberId" | "customerWaId">,
  source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  now = Date.now(),
): SetupMetaTestInboundAllow {
  const env = envMap(source);
  if (env.WHATSAPP_CONFIGURATION_MODE !== "meta_test") {
    return { ok: false, code: "not_meta_test" };
  }
  const scope = SETUP_META_TEST_INBOUND_SCOPE;
  const config = setupMetaTestConfig(scope, env, now);
  if (!config) return { ok: false, code: "setup_meta_test_gateway_closed" };
  if (companyId !== scope.companyId) return { ok: false, code: "company_mismatch" };
  if ((env.WHATSAPP_TEST_COMPANY_ID ?? "").trim() !== scope.companyId) {
    return { ok: false, code: "test_company_pin_mismatch" };
  }
  if (message.wabaId !== config.wabaId) return { ok: false, code: "waba_mismatch" };
  if (message.phoneNumberId !== config.phoneNumberId) return { ok: false, code: "phone_mismatch" };
  const recipientWaId = (env.VELORA_SETUP_META_TEST_RECIPIENT_WA_ID ?? "").trim();
  if (!recipientRe.test(recipientWaId) || message.customerWaId !== recipientWaId) {
    return { ok: false, code: "recipient_mismatch" };
  }
  return {
    ok: true,
    scope,
    expiresAt: config.expiresAt,
    phoneNumberId: config.phoneNumberId,
    wabaId: config.wabaId,
    recipientWaId,
  };
}

/**
 * Persist inbound message + conversation and lock/terminalize its processing job atomically
 * inside a single database transaction via save_whatsapp_inbound_receive_only.
 * Receive/save only: no grant, no review send authority, no pending AI/send eligibility.
 */
export async function saveSetupMetaTestInboundReceiveOnly(
  admin: SupabaseClient<Database>,
  companyId: string,
  message: InboundMessage,
  source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  now = Date.now(),
): Promise<SaveInboundResult> {
  const allow = evaluateSetupMetaTestInbound(companyId, message, source, now);
  if (!allow.ok) throw new SetupMetaTestInboundRejectError(allow.code);

  const args = {
    p_company_id: companyId,
    p_phone_number_id: message.phoneNumberId,
    p_customer_wa_id: message.customerWaId,
    p_customer_name: message.customerName,
    p_wa_message_id: message.waMessageId,
    p_body: message.body,
    p_message_type: message.messageType,
    p_received_at: message.receivedAt,
  };
  const rpc = (
    admin as unknown as {
      rpc: (name: string, rpcArgs: Record<string, unknown>) => PromiseLike<{ data: Json; error: unknown }>;
    }
  ).rpc.bind(admin);
  const { data, error } = await rpc("save_whatsapp_inbound_receive_only", args);
  if (error) throw error;
  const row = asRecord(data);
  if (!row || row.ok !== true) throw new Error("save_inbound_failed");
  if (typeof row.inserted !== "boolean") throw new Error("whatsapp_rpc_inserted");
  if (
    row.job_status !== "completed" ||
    row.result_code !== SETUP_META_TEST_RECEIVE_ONLY_RESULT_CODE
  ) {
    throw new Error("setup_meta_test_atomic_job_prevention_required");
  }
  const result: SaveInboundResult = {
    inserted: row.inserted,
    messageId: String(row.message_id ?? "").trim(),
    conversationId: String(row.conversation_id ?? "").trim(),
    jobId: String(row.job_id ?? "").trim(),
    jobStatus: row.job_status,
  };
  if (!result.messageId || !result.conversationId || !result.jobId) throw new Error("save_inbound_ids");
  return result;
}
