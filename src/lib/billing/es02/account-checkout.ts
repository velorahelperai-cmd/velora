import "server-only";
import { beginThawaniTestCheckout } from "./thawani-account-checkout";
import type { Preparation } from "@/lib/tenancy/prepayment-preparation";
import type { Es02OfferSelection } from "./commercial-offer";
import type { Es02AccountOrderView, Es02Result } from "./contracts";
export type AccountCheckoutInput = {
  accountId: string;
  sessionId: string;
  clientOpId: string;
  selection: Es02OfferSelection;
  preparation?: Preparation;
};
export type AccountCheckoutData = { order: Es02AccountOrderView; action: "insert" | "reuse"; checkoutUrl: string };

export async function beginAccountTestCheckout(input: AccountCheckoutInput): Promise<Es02Result<AccountCheckoutData>> {
  return beginThawaniTestCheckout(input);
}
