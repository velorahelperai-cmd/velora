/**
 * VEL-BILLING-LOCK-ORDER-AND-UNKNOWN-FIX-03
 * Unit: OPEN_COLLECTION_UNRESOLVED UI mapping + safe-draft semantics notes.
 */

import { describe, expect, it } from "vitest";
import { purchaseGateToUiState, type PurchaseGateDecision } from "@/lib/billing/wiring/purchase-gate";
import { mapAtomicPurchasePersistPayload } from "@/lib/billing/wiring/purchase-persist-rpc";

describe("FIX-03 unknown / lock mapping", () => {
  it("OPEN_COLLECTION_UNRESOLVED blocks checkout and shows manage hint", () => {
    const decision: PurchaseGateDecision = {
      ok: false,
      code: "OPEN_COLLECTION_UNRESOLVED",
      manageSubscriptionHint: true,
      blockNewCollection: true,
    };
    expect(purchaseGateToUiState(decision)).toEqual({
      code: "OPEN_COLLECTION_UNRESOLVED",
      showManageSubscription: true,
      blockCheckout: true,
      upgradeNotConfigured: false,
    });
  });

  it("maps RPC reject with block_new_collection", () => {
    expect(
      mapAtomicPurchasePersistPayload({
        ok: false,
        code: "OPEN_COLLECTION_UNRESOLVED",
        block_new_collection: true,
        manage_subscription_hint: true,
      }),
    ).toEqual({
      ok: false,
      code: "OPEN_COLLECTION_UNRESOLVED",
      blockNewCollection: true,
      manageSubscriptionHint: true,
    });
  });
});
