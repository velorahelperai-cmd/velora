/**
 * VEL-AI-CHANNEL-ADAPTER-01 — internal inbound answer preparation.
 *
 * NOT a customer/admin session entry. NOT wired to webhook, scheduler, or send.
 * Does not call completeInboundJob. Provider + live answering stay off.
 *
 * Trust: company / conversation / phone / message identity from stored job→message→conversation.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadApprovedAnswerContext,
  verifyAnswerCitationsStillValid,
} from "@/lib/answers/context";
import { ANSWER_MAX_QUESTION_CHARS } from "@/lib/answers/constants";
import { assertEligibleAnswerChunks, isLiveAnsweringEnabled } from "@/lib/answers/guards";
import { getAnswerProvider } from "@/lib/answers/provider";
import type { AnswerCitation, AnswerContextChunk, AnswerUsage } from "@/lib/answers/types";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  automationResultStillValid,
  fetchWhatsappAutomationGate,
} from "@/lib/whatsapp/automation-gate";

export type ChannelProcessCode =
  | "PROCESSING_DISABLED"
  | "NEEDS_SETUP"
  | "APPROVAL_FOUNDATION_UNAVAILABLE"
  | "CLAIM_INVALID"
  | "CLAIM_EXPIRED"
  | "AUTOMATION_PAUSED"
  | "COMPANY_SUSPENDED"
  | "NO_KNOWLEDGE"
  | "APPROVAL_INCOMPLETE"
  | "CONTEXT_OVERFLOW"
  | "INVALID_INPUT"
  | "UNAVAILABLE";

export type ChannelProcessFailure = {
  ok: false;
  code: ChannelProcessCode;
  /** Never means the inbound job was completed or a message was sent. */
  jobCompleted: false;
  message?: string;
};

export type ChannelProcessStaged = {
  ok: true;
  /**
   * Staged answer draft only. Not delivery, not job completion.
   * With live answering off, callers typically never reach ok:true.
   */
  jobCompleted: false;
  jobId: string;
  companyId: string;
  conversationId: string;
  messageId: string;
  phoneNumberId: string;
  automationGeneration: number;
  text: string;
  citations: AnswerCitation[];
  usage: AnswerUsage;
};

export type ChannelProcessResult = ChannelProcessStaged | ChannelProcessFailure;

type Admin = SupabaseClient<Database>;

export type ClaimedJobRow = {
  id: string;
  company_id: string;
  message_id: string;
  wa_message_id: string;
  status: string;
  claim_token: string | null;
  claim_expires_at: string | null;
};

export type MessageRow = {
  id: string;
  company_id: string;
  conversation_id: string;
  wa_message_id: string;
  body: string | null;
  direction: string;
  sender: string;
};

export type ConversationRow = {
  id: string;
  company_id: string;
  phone_number_id: string;
};

function fail(code: ChannelProcessCode, message?: string): ChannelProcessFailure {
  return { ok: false, code, jobCompleted: false, message };
}

/** Active claim only — expired or mismatched token is rejected. */
export function evaluateInboundClaim(
  row: ClaimedJobRow | null,
  claimToken: string,
  nowMs = Date.now(),
): ChannelProcessCode | null {
  if (!row) return "CLAIM_INVALID";
  if (row.status !== "claimed") return "CLAIM_INVALID";
  if (!row.claim_token || row.claim_token !== claimToken) return "CLAIM_INVALID";
  if (!row.claim_expires_at) return "CLAIM_EXPIRED";
  const expires = Date.parse(row.claim_expires_at);
  if (!Number.isFinite(expires) || expires <= nowMs) return "CLAIM_EXPIRED";
  return null;
}

/**
 * Job ↔ message ↔ conversation identity: same company, inbound customer message,
 * matching wa_message_id, and conversation phone binding.
 */
export function evaluateMessageIdentity(input: {
  job: ClaimedJobRow;
  message: MessageRow | null;
  conversation: ConversationRow | null;
  expectedConversationId?: string;
  expectedPhoneNumberId?: string;
  /** Original inbound message id pinned before provider work. */
  expectedMessageId?: string;
  /** Original wa_message_id pinned before provider work. */
  expectedWaMessageId?: string;
}): ChannelProcessCode | null {
  const { job, message, conversation } = input;
  if (!message) return "INVALID_INPUT";
  if (message.company_id !== job.company_id) return "INVALID_INPUT";
  if (message.id !== job.message_id) return "INVALID_INPUT";
  if (message.wa_message_id !== job.wa_message_id) return "INVALID_INPUT";
  if (message.direction !== "inbound") return "INVALID_INPUT";
  if (message.sender !== "customer") return "INVALID_INPUT";
  if (input.expectedMessageId && message.id !== input.expectedMessageId) {
    return "INVALID_INPUT";
  }
  if (input.expectedWaMessageId && message.wa_message_id !== input.expectedWaMessageId) {
    return "INVALID_INPUT";
  }
  if (input.expectedMessageId && job.message_id !== input.expectedMessageId) {
    return "INVALID_INPUT";
  }
  if (input.expectedWaMessageId && job.wa_message_id !== input.expectedWaMessageId) {
    return "INVALID_INPUT";
  }
  if (!conversation) return "INVALID_INPUT";
  if (conversation.company_id !== job.company_id) return "INVALID_INPUT";
  if (conversation.id !== message.conversation_id) return "INVALID_INPUT";
  if (input.expectedConversationId && conversation.id !== input.expectedConversationId) {
    return "INVALID_INPUT";
  }
  if (
    input.expectedPhoneNumberId
    && conversation.phone_number_id !== input.expectedPhoneNumberId
  ) {
    return "INVALID_INPUT";
  }
  return null;
}

async function loadClaimedJob(
  admin: Admin,
  jobId: string,
): Promise<ClaimedJobRow | null> {
  const { data, error } = await admin
    .from("whatsapp_inbound_jobs")
    .select("id, company_id, message_id, wa_message_id, status, claim_token, claim_expires_at")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ClaimedJobRow | null) ?? null;
}

async function loadTrustedMessage(
  admin: Admin,
  messageId: string,
  companyId: string,
): Promise<MessageRow | null> {
  const { data, error } = await admin
    .from("whatsapp_messages")
    .select("id, company_id, conversation_id, wa_message_id, body, direction, sender")
    .eq("id", messageId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MessageRow | null) ?? null;
}

async function loadTrustedConversation(
  admin: Admin,
  conversationId: string,
  companyId: string,
): Promise<ConversationRow | null> {
  const { data, error } = await admin
    .from("whatsapp_conversations")
    .select("id, company_id, phone_number_id")
    .eq("id", conversationId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ConversationRow | null) ?? null;
}

function mapKnowledgeCode(
  code:
    | "NO_KNOWLEDGE"
    | "APPROVAL_INCOMPLETE"
    | "APPROVAL_FOUNDATION_UNAVAILABLE"
    | "CONTEXT_OVERFLOW"
    | "UNAVAILABLE",
): ChannelProcessCode {
  return code;
}

/**
 * Prepare an answer for a claimed inbound job using trusted DB relations only.
 * Inject `admin` in tests; production workers pass service-role client.
 * `now` is read fresh on every claim check (do not freeze one timestamp across provider work).
 * Never marks the job complete and never sends.
 */
export async function processInboundJobAnswer(input: {
  jobId: string;
  claimToken: string;
  locale?: "ar" | "en";
  admin?: Admin | null;
  /** Test-only clock; each call must observe current time. Production uses Date.now. */
  now?: () => number;
}): Promise<ChannelProcessResult> {
  const jobId = (input.jobId ?? "").trim();
  const claimToken = (input.claimToken ?? "").trim();
  if (!jobId || !claimToken) return fail("INVALID_INPUT");

  const admin = input.admin === undefined ? createAdminClient() : input.admin;
  if (!admin) return fail("UNAVAILABLE", "admin_client_unavailable");
  const now = input.now ?? (() => Date.now());

  try {
    const job = await loadClaimedJob(admin, jobId);
    const claimErr = evaluateInboundClaim(job, claimToken, now());
    if (claimErr || !job) return fail(claimErr ?? "CLAIM_INVALID");

    const message = await loadTrustedMessage(admin, job.message_id, job.company_id);
    const conversation = message
      ? await loadTrustedConversation(admin, message.conversation_id, job.company_id)
      : null;
    const identityErr = evaluateMessageIdentity({ job, message, conversation });
    if (identityErr || !message || !conversation) {
      return fail(identityErr ?? "INVALID_INPUT", "message_identity");
    }

    const gate = await fetchWhatsappAutomationGate(admin, conversation.id);
    if (!gate.ok) {
      if (gate.code === "company_suspended") return fail("COMPANY_SUSPENDED");
      return fail("UNAVAILABLE", gate.code);
    }
    if (gate.companyId !== job.company_id) {
      return fail("INVALID_INPUT", "gate_company_mismatch");
    }
    if (gate.companyStatus === "suspended") return fail("COMPANY_SUSPENDED");
    if (!gate.eligible || !gate.automationAllowed) return fail("AUTOMATION_PAUSED");

    const stagedGeneration = gate.automationGeneration;
    const stagedConversationId = conversation.id;
    const stagedPhoneNumberId = conversation.phone_number_id;
    const stagedMessageId = message.id;
    const stagedWaMessageId = message.wa_message_id;
    const stagedCompanyId = job.company_id;
    const question = (message.body ?? "").trim();
    if (!question || question.length > ANSWER_MAX_QUESTION_CHARS) {
      return fail("INVALID_INPUT", "empty_or_oversized_body");
    }

    const packed = await loadApprovedAnswerContext(job.company_id, admin);
    if (!packed.ok) return fail(mapKnowledgeCode(packed.code));

    assertEligibleAnswerChunks(packed.chunks);

    // Live channel + provider stay locked in this package.
    if (!isLiveAnsweringEnabled()) {
      return fail("PROCESSING_DISABLED");
    }
    const provider = getAnswerProvider();
    if (!provider) return fail("NEEDS_SETUP");

    const locale = input.locale === "en" ? "en" : "ar";
    const result = await provider.complete({
      question,
      locale,
      chunks: packed.chunks,
    });
    if (!result.ok) {
      if (result.code === "NEEDS_SETUP") return fail("NEEDS_SETUP");
      if (result.code === "CONTEXT_OVERFLOW") return fail("CONTEXT_OVERFLOW");
      if (result.code === "NO_KNOWLEDGE") return fail("NO_KNOWLEDGE");
      if (result.code === "APPROVAL_INCOMPLETE") return fail("APPROVAL_INCOMPLETE");
      if (result.code === "APPROVAL_FOUNDATION_UNAVAILABLE") {
        return fail("APPROVAL_FOUNDATION_UNAVAILABLE");
      }
      return fail("UNAVAILABLE", result.code);
    }

    // Re-verify claim with a fresh clock read — lease may expire during provider work.
    const jobAgain = await loadClaimedJob(admin, jobId);
    const claimAgain = evaluateInboundClaim(jobAgain, claimToken, now());
    if (claimAgain || !jobAgain) return fail(claimAgain ?? "CLAIM_INVALID");
    if (jobAgain.company_id !== stagedCompanyId) return fail("INVALID_INPUT", "company_changed");
    if (jobAgain.message_id !== stagedMessageId || jobAgain.wa_message_id !== stagedWaMessageId) {
      return fail("INVALID_INPUT", "job_message_identity_changed");
    }

    // Reload the originally staged message id — do not follow a swapped job.message_id.
    const messageAgain = await loadTrustedMessage(admin, stagedMessageId, stagedCompanyId);
    const conversationAgain = messageAgain
      ? await loadTrustedConversation(admin, messageAgain.conversation_id, stagedCompanyId)
      : null;
    const identityAgain = evaluateMessageIdentity({
      job: jobAgain,
      message: messageAgain,
      conversation: conversationAgain,
      expectedConversationId: stagedConversationId,
      expectedPhoneNumberId: stagedPhoneNumberId,
      expectedMessageId: stagedMessageId,
      expectedWaMessageId: stagedWaMessageId,
    });
    if (identityAgain) return fail(identityAgain, "message_identity_changed");

    const gateAgain = await fetchWhatsappAutomationGate(admin, stagedConversationId);
    if (!automationResultStillValid(gateAgain, stagedGeneration)) {
      if (gateAgain.ok && gateAgain.companyStatus === "suspended") {
        return fail("COMPANY_SUSPENDED");
      }
      return fail("AUTOMATION_PAUSED");
    }

    const citationsOk = await verifyAnswerCitationsStillValid(
      stagedCompanyId,
      packed.chunks as AnswerContextChunk[],
      admin,
    );
    if (!citationsOk) return fail("UNAVAILABLE", "citations_stale");

    return {
      ok: true,
      jobCompleted: false,
      jobId: job.id,
      companyId: stagedCompanyId,
      conversationId: stagedConversationId,
      messageId: stagedMessageId,
      phoneNumberId: stagedPhoneNumberId,
      automationGeneration: stagedGeneration,
      text: result.text,
      citations: packed.chunks.map((c) => ({
        sourceId: c.sourceId,
        title: c.title,
        contentVersion: c.contentVersion,
      })),
      usage: {
        promptChars: question.length,
        contextChars: packed.contextChars,
        sourceCount: packed.chunks.length,
      },
    };
  } catch {
    return fail("UNAVAILABLE");
  }
}
