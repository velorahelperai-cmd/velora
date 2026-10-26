"use server";
import type {StartTestCheckoutResult} from "./test-checkout-actions";
type StartInput={planVersionId:string;clientOpId:string;expectedCompanyId:string;expectedCatalogRevision:number;termsVersion?:string;consentAccepted?:boolean;purchasePurpose?:"initial"|"upgrade"};
/** Live collection is not configured; never creates an order or provider request. */
export async function startLiveCheckoutAction(input:StartInput):Promise<StartTestCheckoutResult>{void input;return {ok:false,code:"live_not_configured"};}
export async function resumeLiveCheckoutAction(input:{orderId:string}):Promise<StartTestCheckoutResult>{void input;return {ok:false,code:"live_not_configured"};}
