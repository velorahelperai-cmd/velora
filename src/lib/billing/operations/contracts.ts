export type OperationResult<T>={ok:true;data:T}|{ok:false;code:string};
export type JourneyOrder={id:string;plan_version_id:string;amount_baisa:number;currency:"OMR";purchase_purpose:"initial"|"renew"|"upgrade";status:string;created_at:string;paid_through:string|null;payment_state:"confirmed"|"awaiting_processing"|"failed"|"verifying"|"unresolved"};
export type JourneySnapshot={subscription:{id:string;company_id:string;plan_version_id:string|null;status:string;paid_through:string|null;cancel_at_period_end:boolean;cap:number|null}|null;orders:JourneyOrder[]};
export type OfferDraft={code:string;plan_version_id:string;company_id:string|null;discount_baisa:number;valid_from:string;valid_until:string;max_claims:number;max_company_claims:number};
export type Offer=OfferDraft&{id:string;revision:number;status:"draft"|"active"|"retired"};
export type QuoteInput={price:number;discount:number;now:number;validFrom:number;validUntil:number;companyEligible:boolean;planEligible:boolean;remaining:number};
export function quoteOffer(i:QuoteInput):{ok:true;amountBaisa:number}|{ok:false;code:string}{
 if(!Number.isSafeInteger(i.price)||!Number.isSafeInteger(i.discount)||i.price<=0||i.discount<=0||i.discount>=i.price||!Number.isFinite(i.now)||!Number.isFinite(i.validFrom)||!Number.isFinite(i.validUntil)||i.validUntil<=i.validFrom||i.now<i.validFrom||i.now>=i.validUntil||!i.companyEligible||!i.planEligible||!Number.isSafeInteger(i.remaining)||i.remaining<1)return {ok:false,code:"offer_ineligible"};
 return {ok:true,amountBaisa:i.price-i.discount};
}
export function technicalUpgrade(){return {ok:false as const,code:"upgrade_pricing_not_configured"};}
export function retryDelay(attempt:number):number|null{return Number.isInteger(attempt)&&attempt>=1&&attempt<5?Math.min(300000,10000*2**(attempt-1)):null;}
export function canUseFeature(i:{authorized:boolean;companyStatus:string;paidThrough:number|null;now:number;operation:string;enabled:string[]}):boolean{
 if(!i.authorized||i.companyStatus==="suspended")return false;
 if(i.operation==="read"||i.operation==="export")return true;
 if(i.companyStatus!=="active"||i.paidThrough===null||!Number.isFinite(i.paidThrough)||!Number.isFinite(i.now)||i.now>=i.paidThrough)return false;
 return i.operation==="automated_outbound"||i.enabled.includes(i.operation);
}
