import { lookupWhatsappAccessSecret } from "@/lib/whatsapp/access-secrets";
import {
  classifyPreGraphSettlement,
  replyFromPreGraphSettlement,
  sendFinalizeKind,
  type PreGraphActionResult,
} from "@/lib/whatsapp/send-failure";
import {
  decideOutboundGraphAttempt,
  evaluateOutboundBinding,
  type WhatsappTenantResolveFail,
  type WhatsappTenantResolveOk,
} from "@/lib/whatsapp/tenant-resolve";

export type ClaimedSendDecision =
  | { action: "graph"; accessToken: string }
  | { action: "rejected"; code: string }
  | { action: "unknown"; code: string };

/**
 * Real post-claim gate used by replyWhatsappConversation (tenant_registry).
 * Reuses stored intent link identity/generation — not a freshly guessed number.
 */
export function decideClaimedTenantSend(input: {
  companyId: string;
  phoneNumberId: string;
  recipientWaId: string;
  conversation: { companyId: string; phoneNumberId: string; customerWaId: string };
  resolved: WhatsappTenantResolveOk | WhatsappTenantResolveFail;
  intentLinkId: string | null;
  intentLinkGeneration: number | null;
  /** Production actions supply the current Vault lookup; pure legacy callers remain compatible. */
  secret?: ReturnType<typeof lookupWhatsappAccessSecret>;
}): ClaimedSendDecision {
  if (
    !input.intentLinkId?.trim()
    || input.intentLinkGeneration == null
    || !Number.isSafeInteger(input.intentLinkGeneration)
    || input.intentLinkGeneration < 1
  ) {
    return { action: "rejected", code: "link_changed" };
  }
  const binding = evaluateOutboundBinding({
    companyId: input.companyId,
    phoneNumberId: input.phoneNumberId,
    recipientWaId: input.recipientWaId,
    conversation: input.conversation,
    resolved: input.resolved,
    intentLinkId: input.intentLinkId,
    intentLinkGeneration: input.intentLinkGeneration,
  });
  const secret = input.secret ?? (binding.ok
    ? lookupWhatsappAccessSecret({
      companyId: binding.companyId,
      providerPhoneNumberId: binding.providerPhoneNumberId,
      linkId: binding.linkId,
      linkGeneration: binding.linkGeneration,
    })
    : { ok: false as const, code: "NEEDS_SETUP" as const });
  const attempt = decideOutboundGraphAttempt({
    binding,
    secret: secret.ok ? { ok: true, accessToken: secret.accessToken } : { ok: false, code: "NEEDS_SETUP" },
  });
  if (attempt.ok) return { action: "graph", accessToken: attempt.accessToken };
  const kind = sendFinalizeKind(attempt.code);
  if (kind === "unknown") return { action: "unknown", code: attempt.code };
  return { action: "rejected", code: attempt.code };
}

/**
 * Post-claim, pre-Graph: persist rejected via the real finalizer RPC shape, then classify.
 * Never calls Graph. Caller must not send after this returns.
 */
export async function applyClaimedPreGraphOutcome(input: {
  decision: Extract<ClaimedSendDecision, { action: "rejected" | "unknown" }>;
  clientOpId: string;
  finalize: (args: {
    result: "rejected" | "unknown";
    errorCode: string;
  }) => Promise<{ error: unknown; data: unknown }>;
}): Promise<PreGraphActionResult> {
  const result = sendFinalizeKind(input.decision.code);
  let rpc: { error: unknown; data: unknown };
  try {
    rpc = await input.finalize({ result, errorCode: input.decision.code });
  } catch {
    rpc = { error: true, data: null };
  }
  return replyFromPreGraphSettlement(
    classifyPreGraphSettlement(rpc),
    input.clientOpId,
    input.decision.code,
  );
}
