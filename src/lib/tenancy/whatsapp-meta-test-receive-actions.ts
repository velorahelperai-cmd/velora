"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { metaTestInboundAssetConfig } from "@/lib/whatsapp/config";
import { getCompanyAccess } from "./access";
import { readOwnedPaidBranchSetupAction } from "./paid-setup-actions";
import {
  META_TEST_RECEIVE_ONLY_RESULT,
  parseMetaTestReceiveProofScope,
  projectMetaTestReceiveProof,
  type MetaTestReceiveJobRow,
  type WhatsappMetaTestReceiveProofRead,
} from "./whatsapp-meta-test-receive-proof";

/**
 * Owner-scoped read of durable Meta test receive-only evidence for the current company/branch.
 * Does not start webhooks, create numbers, mutate links, or change commercial verified/launch.
 */
export async function readOwnedWhatsappMetaTestReceiveProofAction(
  input: unknown,
): Promise<WhatsappMetaTestReceiveProofRead> {
  const scope = parseMetaTestReceiveProofScope(input);
  if (!scope) return { ok: false, code: "invalid_input" };

  const testAsset = metaTestInboundAssetConfig();
  if (testAsset && testAsset.companyId !== scope.companyId) {
    return { ok: true, scope, proof: null };
  }

  const [access, setup] = await Promise.all([
    getCompanyAccess("owner"),
    readOwnedPaidBranchSetupAction({
      expectedAccountId: scope.expectedAccountId,
      companyId: scope.companyId,
      branchId: scope.branchId,
    }),
  ]);

  if (
    !access.ok ||
    access.context.needsCompanyContext ||
    access.context.membership?.role !== "owner" ||
    access.context.userId !== scope.expectedAccountId ||
    access.context.company?.id !== scope.companyId
  ) {
    return { ok: false, code: "forbidden" };
  }
  if (
    setup.companyId !== scope.companyId ||
    setup.selectedBranchId !== scope.branchId ||
    setup.sourceStatus === "unavailable" ||
    !setup.branches.some((branch) => branch.id === scope.branchId)
  ) {
    return { ok: false, code: "forbidden" };
  }

  const admin = createAdminClient();
  if (!admin) return { ok: false, code: "unavailable" };

  const jobs = await admin
    .from("whatsapp_inbound_jobs")
    .select("completed_at, message_id")
    .eq("company_id", scope.companyId)
    .eq("status", "completed")
    .eq("result_code", META_TEST_RECEIVE_ONLY_RESULT)
    .order("completed_at", { ascending: false })
    .limit(10);
  if (jobs.error) return { ok: false, code: "unavailable" };
  const jobRows = Array.isArray(jobs.data) ? jobs.data : [];
  if (!jobRows.length) return { ok: true, scope, proof: null };

  const messageIds = jobRows
    .map((row) => (typeof row.message_id === "string" ? row.message_id : null))
    .filter((id): id is string => !!id);
  if (!messageIds.length) return { ok: true, scope, proof: null };

  // Messages need job ids; conversations can load in parallel when the authorized
  // Meta test phone is known, otherwise they wait on message conversation ids.
  const messagesQuery = admin
    .from("whatsapp_messages")
    .select("id, conversation_id, received_at, direction")
    .eq("company_id", scope.companyId)
    .in("id", messageIds)
    .eq("direction", "inbound");

  let messageRows: Array<{
    id: string;
    conversation_id: string | null;
    received_at: string | null;
    direction: string | null;
  }>;
  let conversationRows: Array<{
    id: string;
    phone_number_id: string | null;
    automation_allowed: boolean | null;
  }>;

  if (testAsset?.phoneNumberId) {
    const [messages, conversations] = await Promise.all([
      messagesQuery,
      admin
        .from("whatsapp_conversations")
        .select("id, phone_number_id, automation_allowed")
        .eq("company_id", scope.companyId)
        .eq("phone_number_id", testAsset.phoneNumberId)
        .limit(20),
    ]);
    if (messages.error || conversations.error) return { ok: false, code: "unavailable" };
    messageRows = Array.isArray(messages.data) ? messages.data : [];
    conversationRows = Array.isArray(conversations.data) ? conversations.data : [];
  } else {
    const messages = await messagesQuery;
    if (messages.error) return { ok: false, code: "unavailable" };
    messageRows = Array.isArray(messages.data) ? messages.data : [];
    if (!messageRows.length) return { ok: true, scope, proof: null };
    const conversationIds = [
      ...new Set(
        messageRows
          .map((row) => (typeof row.conversation_id === "string" ? row.conversation_id : null))
          .filter((id): id is string => !!id),
      ),
    ];
    const conversations = conversationIds.length
      ? await admin
          .from("whatsapp_conversations")
          .select("id, phone_number_id, automation_allowed")
          .eq("company_id", scope.companyId)
          .in("id", conversationIds)
      : { data: [], error: null };
    if (conversations.error) return { ok: false, code: "unavailable" };
    conversationRows = Array.isArray(conversations.data) ? conversations.data : [];
  }

  if (!messageRows.length) return { ok: true, scope, proof: null };

  const conversationById = new Map(conversationRows.map((row) => [row.id, row]));
  const messageById = new Map(messageRows.map((row) => [row.id, row]));

  const rows: MetaTestReceiveJobRow[] = [];
  for (const job of jobRows) {
    if (typeof job.message_id !== "string") continue;
    const message = messageById.get(job.message_id);
    if (!message || typeof message.conversation_id !== "string") continue;
    const conversation = conversationById.get(message.conversation_id);
    if (!conversation) continue;
    rows.push({
      completed_at: typeof job.completed_at === "string" ? job.completed_at : null,
      message_id: job.message_id,
      received_at: typeof message.received_at === "string" ? message.received_at : null,
      phone_number_id: typeof conversation.phone_number_id === "string" ? conversation.phone_number_id : null,
      direction: typeof message.direction === "string" ? message.direction : null,
      automation_allowed:
        typeof conversation.automation_allowed === "boolean" ? conversation.automation_allowed : null,
    });
  }

  return { ok: true, scope, proof: projectMetaTestReceiveProof(rows) };
}
