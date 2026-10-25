"use server";

import {canUseAccountPrepDraft} from "@/lib/tenancy/account-prep-eligibility";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess } from "@/lib/tenancy/access";
import {
  accountPrepDraftFromRow,
  isAccountPrepUuid,
  parseAccountPrepDraftPatch,
  type AccountPrepDraftCode,
  type AccountPrepDraftRecord,
  type AccountPrepDraftResult,
} from "@/lib/tenancy/account-prep-draft";
import type { Json } from "@/lib/database.types";
import { logEvent, withLogContext } from "@/lib/logging/logger.mjs";

const CODES: AccountPrepDraftCode[] = [
  "UNAUTHENTICATED",
  "UNVERIFIED",
  "FORBIDDEN",
  "INVALID_INPUT",
  "CONFLICT",
  "UNAVAILABLE",
  "DRAFT_EXPIRED",
];

function failure(code: unknown): { ok: false; code: AccountPrepDraftCode } {
  return { ok: false, code: CODES.includes(code as AccountPrepDraftCode) ? (code as AccountPrepDraftCode) : "UNAVAILABLE" };
}

type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };

export async function readAccountPrepDraft(
  expectedAccountId: string,
): Promise<AccountPrepDraftResult<AccountPrepDraftRecord | null>> {
  try {
    const access = await getCompanyAccess();
    if (!access.ok) return failure(access.code === "NO_COMPANY" ? "FORBIDDEN" : access.code);
    if (!isAccountPrepUuid(expectedAccountId) || access.context.userId !== expectedAccountId) return failure("FORBIDDEN");
    if (!canUseAccountPrepDraft(access.context)) return failure("FORBIDDEN");
    const client = await createClient();
    const { data, error } = await (client as unknown as RpcClient).rpc("read_account_prep_draft", {
      p_expected_account_id: expectedAccountId,
    });
    if (error) return failure("UNAVAILABLE");
    const receipt = data as { ok?: boolean; code?: unknown; data?: unknown } | null;
    if (!receipt?.ok) return failure(receipt?.code);
    if (receipt.data === null) return { ok: true, data: null };
    const parsed = accountPrepDraftFromRow(receipt.data, expectedAccountId);
    return parsed ? { ok: true, data: parsed } : failure("UNAVAILABLE");
  } catch {
    return failure("UNAVAILABLE");
  }
}

export async function saveAccountPrepDraft(input: {
  expectedAccountId: string;
  expectedVersion: number;
  patch: unknown;
  draftId?: string;
}): Promise<AccountPrepDraftResult<AccountPrepDraftRecord>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return failure("INVALID_INPUT");
  const started = Date.now();
  try {
    const access = await getCompanyAccess();
    if (!access.ok) return failure(access.code === "NO_COMPANY" ? "FORBIDDEN" : access.code);
    if (!isAccountPrepUuid(input.expectedAccountId) || access.context.userId !== input.expectedAccountId) {
      return failure("FORBIDDEN");
    }
    if (!canUseAccountPrepDraft(access.context)) return failure("FORBIDDEN");
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) return failure("INVALID_INPUT");
    if (input.draftId !== undefined && !isAccountPrepUuid(input.draftId)) return failure("INVALID_INPUT");
    const patch = parseAccountPrepDraftPatch(input.patch);
    if (!patch.ok) return failure("INVALID_INPUT");

    const client = await createClient();
    const { data, error } = await (client as unknown as RpcClient).rpc("save_account_prep_draft", {
      p_expected_account_id: input.expectedAccountId,
      p_expected_version: input.expectedVersion,
      p_patch: patch.value as unknown as Json,
      p_draft_id: input.draftId ?? null,
    });
    if (error) {
      await withLogContext({ user_id: input.expectedAccountId }, () =>
        logEvent("error", "account.prep_draft.save_failed", {
          kind: "application",
          target: "account_prep_drafts",
          duration_ms: Date.now() - started,
          error: new Error("ACCOUNT_PREP_DRAFT_SAVE_FAILED"),
        }),
      );
      return failure("UNAVAILABLE");
    }
    const receipt = data as { ok?: boolean; code?: unknown; data?: unknown } | null;
    if (!receipt?.ok) return failure(receipt?.code);
    const parsed = accountPrepDraftFromRow(receipt.data, input.expectedAccountId);
    if (!parsed) return failure("UNAVAILABLE");
    await withLogContext({ user_id: input.expectedAccountId }, () =>
      logEvent("info", "account.prep_draft.saved", {
        kind: "application",
        target: "account_prep_drafts",
        duration_ms: Date.now() - started,
        outcome: "ok",
        // draft id + version only — no payload field values (LOG-001)
        draft_id: parsed.draftId,
        version: parsed.version,
      }),
    );
    return { ok: true, data: parsed };
  } catch {
    await withLogContext({ user_id: input.expectedAccountId }, () =>
      logEvent("error", "account.prep_draft.save_failed", {
        kind: "application",
        target: "account_prep_drafts",
        duration_ms: Date.now() - started,
        error: new Error("ACCOUNT_PREP_DRAFT_SAVE_FAILED"),
      }),
    );
    return failure("UNAVAILABLE");
  }
}
