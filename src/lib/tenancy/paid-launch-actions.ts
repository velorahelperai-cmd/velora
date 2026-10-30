"use server";

import { randomUUID } from "node:crypto";
import { readSessionIdentity } from "@/lib/auth/server-identity";
import { withLogContext } from "@/lib/logging/logger.mjs";
import { createClient } from "@/lib/supabase/server";
import { readOwnedPaidBranchSetupAction } from "./paid-setup-actions";
import { readOwnedBranchReplyLanguageAction } from "./paid-reply-language-actions";
import { normalizePaidLaunchSnapshot } from "./paid-launch-projection";
import type {
  LaunchScope,
  LaunchSummarySnapshot,
} from "@/components/app/paid-launch-summary";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validScope(s: unknown): s is LaunchScope {
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

export async function readOwnedBranchLaunchSummaryAction(
  scope: LaunchScope
): Promise<LaunchSummarySnapshot | null> {
  const requestId = randomUUID();
  return withLogContext({ request_id: requestId, user_id: scope?.expectedAccountId }, async () => {
    if (!validScope(scope)) return null;
    const identity = await readSessionIdentity();
    if (!identity.ok || identity.userId !== scope.expectedAccountId) return null;

    const client = await createClient();
    const authority = await client.rpc("es02_read_owned_branch_setup" as never, {
      p_expected_account_id: scope.expectedAccountId, p_company_id: scope.companyId, p_branch_id: scope.branchId,
    } as never);
    if (authority.error || (authority.data as unknown as { ok?: boolean })?.ok !== true) return null;
    const res = await client.rpc("es02_read_owned_branch_launch_summary" as never, {
      p_expected_account_id: scope.expectedAccountId,
      p_company_id: scope.companyId,
      p_branch_id: scope.branchId,
    } as never);

    const payload = res.data as unknown as { ok?: boolean; data?: { snapshot: LaunchSummarySnapshot } };
    if (res.error || !payload || payload.ok !== true) return null;
    const branch = await readOwnedPaidBranchSetupAction(scope);
    const langRes = await readOwnedBranchReplyLanguageAction(scope).catch(() => null);
    return normalizePaidLaunchSnapshot(payload.data?.snapshot, scope, branch, langRes);
  });
}

export async function confirmOwnedBranchLaunchAction(
  input: LaunchScope & { expectedVersion: number; readinessRevision: string; operationId: string; confirmed: true }
): Promise<LaunchSummarySnapshot | null> {
  const requestId = randomUUID();
  return withLogContext({ request_id: requestId, user_id: input?.expectedAccountId }, async () => {
    if (!validScope(input) || !input.operationId || !UUID.test(input.operationId) || input.confirmed !== true) return null;
    const identity = await readSessionIdentity();
    if (!identity.ok || identity.userId !== input.expectedAccountId) return null;

    const client = await createClient();
    const authority = await client.rpc("es02_read_owned_branch_setup" as never, {
      p_expected_account_id: input.expectedAccountId, p_company_id: input.companyId, p_branch_id: input.branchId,
    } as never);
    if (authority.error || (authority.data as unknown as { ok?: boolean })?.ok !== true) return null;

    // Server-side readiness verification
    const summaryRes = await client.rpc("es02_read_owned_branch_launch_summary" as never, {
      p_expected_account_id: input.expectedAccountId,
      p_company_id: input.companyId,
      p_branch_id: input.branchId,
    } as never);
    const summaryPayload = summaryRes.data as unknown as { ok?: boolean; data?: { snapshot: LaunchSummarySnapshot } };
    if (summaryRes.error || !summaryPayload || summaryPayload.ok !== true) return null;

    const branch = await readOwnedPaidBranchSetupAction(input);
    const langRes = await readOwnedBranchReplyLanguageAction(input).catch(() => null);
    const verifiedSummary = normalizePaidLaunchSnapshot(summaryPayload.data?.snapshot, input, branch, langRes);

    if (
      !verifiedSummary ||
      verifiedSummary.readiness.status !== "ready" ||
      verifiedSummary.readiness.blockers.length > 0
    ) {
      return null;
    }

    const res = await client.rpc("es02_confirm_owned_branch_launch" as never, {
      p_expected_account_id: input.expectedAccountId,
      p_company_id: input.companyId,
      p_branch_id: input.branchId,
      p_expected_version: input.expectedVersion,
      p_readiness_revision: input.readinessRevision,
      p_operation_id: input.operationId,
      p_confirmed: true,
    } as never);

    const payload = res.data as unknown as { ok?: boolean; data?: { snapshot: LaunchSummarySnapshot } };
    if (res.error || !payload || payload.ok !== true) return null;
    return normalizePaidLaunchSnapshot(payload.data?.snapshot, input, branch, langRes);
  });
}
