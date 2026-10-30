"use server";

import { randomUUID } from "node:crypto";
import { readSessionIdentity } from "@/lib/auth/server-identity";
import { withLogContext } from "@/lib/logging/logger.mjs";
import { createClient } from "@/lib/supabase/server";
import {
  isReplyLanguageContract,
  type ReplyLanguageContract,
  type ReplyLanguageScope,
  type ReplyLanguageSnapshot,
} from "@/lib/tenancy/reply-language-contract";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validScope(s: unknown): s is ReplyLanguageScope {
  if (!s || typeof s !== "object") return false;
  const scope = s as Record<string, unknown>;
  return (
    typeof scope.expectedAccountId === "string" &&
    UUID.test(scope.expectedAccountId) &&
    typeof scope.companyId === "string" &&
    UUID.test(scope.companyId) &&
    typeof scope.branchId === "string" &&
    UUID.test(scope.branchId)
  );
}

export async function readOwnedBranchReplyLanguageAction(
  scope: ReplyLanguageScope
): Promise<ReplyLanguageSnapshot | null> {
  const requestId = randomUUID();
  return withLogContext({ request_id: requestId, user_id: scope?.expectedAccountId }, async () => {
    if (!validScope(scope)) return null;
    const identity = await readSessionIdentity();
    if (!identity.ok || identity.userId !== scope.expectedAccountId) return null;

    const client = await createClient();
    const res = await client.rpc("es02_read_owned_branch_reply_language" as never, {
      p_expected_account_id: scope.expectedAccountId,
      p_company_id: scope.companyId,
      p_branch_id: scope.branchId,
    } as never);

    const payload = res.data as unknown as { ok?: boolean; data?: { snapshot: ReplyLanguageSnapshot } };
    if (res.error || !payload || payload.ok !== true) return null;
    return payload.data?.snapshot ?? null;
  });
}

export async function confirmOwnedBranchReplyLanguageAction(
  input: ReplyLanguageScope & { expectedVersion: number; replyLanguage: ReplyLanguageContract }
): Promise<ReplyLanguageSnapshot | null> {
  const requestId = randomUUID();
  return withLogContext({ request_id: requestId, user_id: input?.expectedAccountId }, async () => {
    if (!validScope(input) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || !isReplyLanguageContract(input.replyLanguage)) return null;
    const identity = await readSessionIdentity();
    if (!identity.ok || identity.userId !== input.expectedAccountId) return null;

    const client = await createClient();
    const res = await client.rpc("es02_confirm_owned_branch_reply_language" as never, {
      p_expected_account_id: input.expectedAccountId,
      p_company_id: input.companyId,
      p_branch_id: input.branchId,
      p_expected_version: input.expectedVersion,
      p_reply_language: input.replyLanguage,
    } as never);

    const payload = res.data as unknown as { ok?: boolean; data?: { snapshot: ReplyLanguageSnapshot } };
    if (res.error || !payload || payload.ok !== true) return null;
    return payload.data?.snapshot ?? null;
  });
}
