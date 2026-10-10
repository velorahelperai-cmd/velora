"use server";
import {getCompanyAccess} from "@/lib/tenancy/access";
import {operationRpc} from "./db";
import {technicalUpgrade,type JourneySnapshot,type OfferDraft,type Offer,type OperationResult} from "./contracts";
export async function readSubscriptionJourneyAction():Promise<{status:"ready";data:JourneySnapshot}|{status:"forbidden"|"unavailable";reason:string}>{
 const access=await getCompanyAccess("owner");
 if(!access.ok||!access.context.company||!access.context.membership)return {status:access.ok?"forbidden":access.code==="UNAVAILABLE"?"unavailable":"forbidden",reason:"owner_required"};
 const result=await operationRpc<JourneySnapshot>("billing_read_company_journey",{p_company_id:access.context.company.id});
 if(!result.ok)return {status:result.code==="forbidden"?"forbidden":"unavailable",reason:result.code};
 return {status:"ready",data:result.data};
}
export async function cancelSubscriptionAtPeriodEndAction():Promise<OperationResult<{cancel_at_period_end:true}>>{
 const access=await getCompanyAccess("owner");if(!access.ok||!access.context.company||!access.context.membership)return {ok:false,code:"forbidden"};
 return operationRpc("billing_cancel_at_period_end",{p_company_id:access.context.company.id});
}
export async function readOfferDraftsAction():Promise<OperationResult<Offer[]>>{return operationRpc("billing_offer_admin_read",{});}
export async function saveOfferDraftAction(draft:OfferDraft,expectedRevision:number,id:string|null=null):Promise<OperationResult<Offer>>{
 if(!Number.isSafeInteger(draft.discount_baisa)||draft.discount_baisa<=0||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)return {ok:false,code:"invalid_input"};
 return operationRpc("billing_offer_admin_save",{p_offer_id:id,p_expected_revision:expectedRevision,p_draft:draft});
}
export async function prepareDiscountedSubscriptionOrderAction(input:{planVersionId:string;purpose:"initial"|"renew";clientOpId:string;offerId:string|null}):Promise<OperationResult<Record<string,unknown>>>{
 void input;
 // A callable Server Action is a public boundary even without a UI button.
 // No discount contract is installed; do not call or alias the absent RPC.
 return {ok:false,code:"discount_not_configured"};
}
export async function previewTechnicalUpgradeAction(){return technicalUpgrade();}

export async function readSubscriptionUsageAction():Promise<OperationResult<{month_start:string;successful_automated_outbound:number;held_outbound_capacity:number;cap:number|null}>>{
 const access=await getCompanyAccess("owner");if(!access.ok||!access.context.company||!access.context.membership)return {ok:false,code:"forbidden"};
 return operationRpc("billing_read_company_usage",{p_company_id:access.context.company.id});
}
