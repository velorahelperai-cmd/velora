"use server";
import { VELORA_SUBSCRIPTION_PRODUCT_CODE, type EarlyRenewConfirmation, type PurchaseKind, type PurchasePurpose } from "./purchase-gate";
export type CreateBillingOrderActionResult =
  | {
      ok: true;
      action: "insert" | "reuse" | "repaired";
      orderId: string;
      specialReference: string;
      paymentAttemptId: string;
      providerConnection: "blocked";
      providerConnectionBlock: string;
      blockNewCollection: boolean;
      purchaseKind: PurchasePurpose;
      purchasePurpose: PurchasePurpose;
      productCode: typeof VELORA_SUBSCRIPTION_PRODUCT_CODE;
    }
  | {
      ok: false;
      code: string;
      blockNewCollection?: boolean;
      manageSubscriptionHint?: true;
      purchasePurpose?: PurchasePurpose;
    };

export async function createBillingOrderAction(input: {
  planVersionId: string;
  clientOpId: string;
  expectedCompanyId?: string;
  /** Default initial. renew requires confirmation. upgrade returns UPGRADE_NOT_CONFIGURED. */
  purchaseKind?: PurchaseKind;
  purchasePurpose?: PurchasePurpose;
  earlyRenewConfirmation?: EarlyRenewConfirmation;
  /** Rejected if any financial field present. */
  untrustedBrowserMoney?: {
    amountBaisa?: number;
    currency?: string;
    periodDays?: number;
  };
}): Promise<CreateBillingOrderActionResult> {
  void input; return { ok: false, code: "provider_retired" };
}
