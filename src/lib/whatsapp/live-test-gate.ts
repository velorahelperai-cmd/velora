export const LIVE_TEST_ALLOWED_SCOPE = {
  companyId: "40d2d885-8b63-49c4-b3da-d2e9566f2750",
  branchId: "a268f9d8-fe5b-41b2-a337-97046a5eaa5c",
  recipientWaId: "*",
  allowedRecipients: ["*"],
  cutoffIso: "2026-11-05T21:10:00Z",
} as const;

export function isLiveTestScopeActive(): boolean {
  if (process.env.WHATSAPP_LIVE_TEST_SCOPE_ENFORCED === "false") return false;
  return process.env.NODE_ENV === "production" || process.env.WHATSAPP_LIVE_TEST_SCOPE_ENFORCED === "true";
}

export function validateLiveTestScope(params: {
  companyId?: string | null;
  recipientWaId?: string | null;
  branchId?: string | null;
  createdAt?: string | Date | null;
}): { ok: boolean; reason?: string } {
  if (!isLiveTestScopeActive()) return { ok: true };

  const targetCompany = process.env.WHATSAPP_TEST_COMPANY_ID ?? LIVE_TEST_ALLOWED_SCOPE.companyId;
  if (params.companyId && targetCompany !== "*" && params.companyId !== targetCompany) {
    return { ok: false, reason: "COMPANY_NOT_IN_LIVE_TEST_SCOPE" };
  }

  const envRecipient = process.env.WHATSAPP_TEST_RECIPIENT?.replace(/^\+/, "").trim();
  if (params.recipientWaId) {
    const cleanPhone = params.recipientWaId.replace(/^\+/, "").trim();
    const allowedList = LIVE_TEST_ALLOWED_SCOPE.allowedRecipients as readonly string[];
    const isAllowed = envRecipient
      ? (envRecipient === "*" || cleanPhone === envRecipient)
      : (allowedList.includes("*") || allowedList.includes(cleanPhone));
    if (!isAllowed) {
      return { ok: false, reason: "RECIPIENT_NOT_IN_LIVE_TEST_SCOPE" };
    }
  }

  if (params.branchId !== undefined && params.branchId !== null) {
    const targetBranch = process.env.WHATSAPP_TEST_BRANCH_ID ?? LIVE_TEST_ALLOWED_SCOPE.branchId;
    if (targetBranch !== "*" && params.branchId !== targetBranch) {
      return { ok: false, reason: "BRANCH_NOT_IN_LIVE_TEST_SCOPE" };
    }
  }

  if (params.createdAt) {
    const cutoffStr = process.env.WHATSAPP_TEST_CUTOFF_ISO ?? LIVE_TEST_ALLOWED_SCOPE.cutoffIso;
    const cutoffTime = new Date(cutoffStr).getTime();
    const createdTime = new Date(params.createdAt).getTime();
    if (isNaN(createdTime) || createdTime < cutoffTime) {
      return { ok: false, reason: "JOB_PRIOR_TO_ACTIVATION_CUTOFF" };
    }
  }

  return { ok: true };
}
