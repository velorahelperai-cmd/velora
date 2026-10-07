/**
 * Pure order-create decisions — financial fields from published plan version only.
 * Browser may send planVersionId + clientOpId; never trusted amounts/currency/period.
 */

import { createHash } from "node:crypto";
import { canManageCompanyBilling, type BillingMembershipView } from "@/lib/billing/membership";

export type PublishedPlanVersionSnapshot = {
  id: string;
  status: "published" | "draft" | "retired";
  amountBaisa: number;
  currency: "OMR";
  periodDays: number;
  periodUnit: "day" | "month" | "year";
  periodCount: number;
};

export type ExistingBillingOrder = {
  id: string;
  companyId: string;
  planVersionId: string;
  clientOpId: string;
  inputFingerprint: string;
  amountBaisa: number;
  currency: "OMR";
  specialReference: string;
  status: string;
};

export type CreateOrderInput = {
  /** Must equal session/server-selected company — never browser-asserted alone. */
  companyId: string;
  planVersionId: string;
  clientOpId: string;
  membership: BillingMembershipView | null;
  planVersion: PublishedPlanVersionSnapshot | null;
  existingSameClientOp: ExistingBillingOrder | null;
  /** Optional browser-supplied money — ignored for values; presence may be rejected. */
  untrustedBrowserMoney?: {
    amountBaisa?: number;
    currency?: string;
    periodDays?: number;
  };
};

export type CreateOrderDecision =
  | {
      ok: true;
      action: "insert";
      companyId: string;
      planVersionId: string;
      clientOpId: string;
      inputFingerprint: string;
      amountBaisa: number;
      currency: "OMR";
      periodDays: number;
      periodUnit: "day" | "month" | "year";
      periodCount: number;
      /** provider_amount stays null while OMR conversion NOT_CONFIGURED */
      providerAmount: null;
      providerAmountUnit: null;
      providerEnvironment: "test";
      specialReference: string;
    }
  | {
      ok: true;
      action: "reuse";
      order: ExistingBillingOrder;
    }
  | {
      ok: false;
      code:
        | "not_owner"
        | "plan_not_found"
        | "plan_not_published"
        | "client_op_conflict"
        | "browser_money_rejected"
        | "invalid_client_op";
    };

export function fingerprintBillingOrderInputs(input: {
  companyId: string;
  planVersionId: string;
  amountBaisa: number;
  currency: string;
  periodUnit: string;
  periodCount: number;
}): string {
  const material = [
    input.companyId,
    input.planVersionId,
    String(input.amountBaisa),
    input.currency,
    input.periodUnit,
    String(input.periodCount),
  ].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex").slice(0, 64);
}

export function decideCreateBillingOrder(input: CreateOrderInput): CreateOrderDecision {
  if (!canManageCompanyBilling(input.membership) || input.membership?.companyId !== input.companyId) {
    return { ok: false, code: "not_owner" };
  }

  const clientOpId = input.clientOpId.trim();
  if (clientOpId.length < 1 || clientOpId.length > 128) {
    return { ok: false, code: "invalid_client_op" };
  }

  if (input.untrustedBrowserMoney) {
    const u = input.untrustedBrowserMoney;
    if (
      u.amountBaisa !== undefined ||
      u.currency !== undefined ||
      u.periodDays !== undefined
    ) {
      return { ok: false, code: "browser_money_rejected" };
    }
  }

  if (!input.planVersion || input.planVersion.id !== input.planVersionId) {
    return { ok: false, code: "plan_not_found" };
  }
  if (input.planVersion.status !== "published") {
    return { ok: false, code: "plan_not_published" };
  }

  const fp = fingerprintBillingOrderInputs({
    companyId: input.companyId,
    planVersionId: input.planVersion.id,
    amountBaisa: input.planVersion.amountBaisa,
    currency: input.planVersion.currency,
    periodUnit: input.planVersion.periodUnit,
    periodCount: input.planVersion.periodCount,
  });

  if (input.existingSameClientOp) {
    if (input.existingSameClientOp.inputFingerprint === fp) {
      return { ok: true, action: "reuse", order: input.existingSameClientOp };
    }
    return { ok: false, code: "client_op_conflict" };
  }

  const specialReference = `vel_${input.companyId.slice(0, 8)}_${clientOpId}`.slice(0, 120);

  return {
    ok: true,
    action: "insert",
    companyId: input.companyId,
    planVersionId: input.planVersion.id,
    clientOpId,
    inputFingerprint: fp,
    amountBaisa: input.planVersion.amountBaisa,
    currency: "OMR",
    periodDays: input.planVersion.periodDays,
    periodUnit: input.planVersion.periodUnit,
    periodCount: input.planVersion.periodCount,
    providerAmount: null,
    providerAmountUnit: null,
    providerEnvironment: "test",
    specialReference,
  };
}
