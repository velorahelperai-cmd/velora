export type EmailClaim = { id: string; claimToken: string; idempotencyKey: string; recipient: string; companyName: string; orderId: string; amountBaisa: number; paidThrough: string };
export type EmailOutcome = { kind: "accepted"; providerId: string; code: "RESEND_ACCEPTED" } | { kind: "rejected"; code: "RESEND_REJECTED" } | { kind: "reconciliation_required"; code: "RESEND_OUTCOME_UNKNOWN" };
export type ClaimResult = { ok: true; claim: EmailClaim | null } | { ok: false; code: "EMAIL_STORE_UNAVAILABLE" };
export type EmailWorkerResult = { ok: true; processed: number; accepted: number; delivered: 0; reconciliationRequired: boolean } | { ok: false; code: "EMAIL_DISABLED" | "EMAIL_NOT_CONFIGURED" | "EMAIL_STORE_UNAVAILABLE" | "EMAIL_RECONCILIATION_REQUIRED" };
export const emailUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const emailAddress = (value: unknown): value is string => typeof value === "string" && value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(value);
