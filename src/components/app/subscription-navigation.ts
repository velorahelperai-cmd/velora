import { choiceFromOffer, currentSubscriptionChoice, type SubscriptionChoice, type SubscriptionOffersView, type SubscriptionPackage, type SubscriptionPersona, type SubscriptionTerm } from "./subscription-offers-view";
import type { BillingReturnDbRow } from "@/lib/billing/wiring/return-status";

export type SubscriptionAccessContext = {
 needsProfileName:boolean;isPlatformAdmin:boolean;needsCompanyContext:boolean;
 company:{status:string}|null;membership:{role:"owner"|"staff"}|null;
};
type Access = {ok:true;context:SubscriptionAccessContext}|{ok:false;code:string};
export type SubscriptionDestination = {href:string;kind:"manage"|"workspace"|"platform"|"chooseCompany"|"login"|"verify"|"profile"|"setup"|"access";note:"staff"|"platform"|"select_company"|null;adminHref?:string};
export function subscriptionSettingsAccess(ctx:SubscriptionAccessContext):"owner"|"staff"|"select_company"|"no_company" {
 if(ctx.needsCompanyContext)return "select_company";
 if(!ctx.company||!ctx.membership)return "no_company";
 return ctx.membership.role;
}
/** Navigation only; existing route/action authorization remains authoritative. */
export function subscriptionDestination(access:Access):SubscriptionDestination {
 if(!access.ok){
  if(access.code==="UNVERIFIED")return {href:"/verify-email",kind:"verify",note:null};
  if(access.code==="FORBIDDEN"||access.code==="UNAVAILABLE")return {href:"/access?code="+access.code,kind:"access",note:null};
  return {href:"/login?next=%2Fapp%2Fsettings%3Ftab%3Dplan",kind:"login",note:null};
 }
 const ctx=access.context,adminHref=ctx.isPlatformAdmin?"/admin":undefined;
 if(ctx.needsProfileName)return {href:"/complete-profile",kind:"profile",note:null};
 if(ctx.needsCompanyContext)return {href:"/app/settings?tab=plan",kind:"chooseCompany",note:"select_company",adminHref};
 if(!ctx.company||!ctx.membership)return ctx.isPlatformAdmin?{href:"/admin",kind:"platform",note:"platform"}:{href:"/setup",kind:"setup",note:null};
 if(ctx.membership.role==="staff")return {href:"/app/conversations",kind:"workspace",note:"staff",adminHref};
 return {href:"/app/settings?tab=plan",kind:"manage",note:null,adminHref};
}
type SelectionParams = Pick<URLSearchParams, "get" | "getAll">;
const selectionKeys = ["persona", "package", "term", "version", "amount", "currency"] as const;
export type SubscriptionIntent = {
 term: SubscriptionTerm;
 persona?: SubscriptionPersona;
 package?: SubscriptionPackage;
 versionId?: string;
 amountBaisa?: number;
 currency?: "OMR";
};

/** URL intent only. The account panel must revalidate it against the current catalog. */
export function subscriptionIntentFromParams(params: SelectionParams): SubscriptionIntent | null {
 if (selectionKeys.some(key => params.getAll(key).length > 1)) return null;
 const persona = params.get("persona"), pack = params.get("package"), term = params.get("term");
 if (term !== "monthly" && term !== "yearly") return null;
 const versionId = params.get("version"), amount = params.get("amount"), currency = params.get("currency");
 if (!persona && !pack && !versionId && !amount && !currency) return { term };
 if (persona !== "level_1" && persona !== "level_2" && persona !== "level_3") return null;
 if (pack !== "basic" && pack !== "premium") return null;
 if (versionId === null && amount === null && currency === null) return { persona, package: pack, term };
 if (!versionId || !/^[A-Za-z0-9_-]{1,128}$/.test(versionId) || !amount || !/^[1-9][0-9]{0,14}$/.test(amount) || currency !== "OMR") return null;
 const amountBaisa = Number(amount);
 if (!Number.isSafeInteger(amountBaisa)) return null;
 return { persona, package: pack, term, versionId, amountBaisa, currency };
}

/** Keep URL/cookie size bounded: feature labels and full offer signatures stay out of it. */
export function subscriptionIntentFromChoice(choice: SubscriptionChoice | null, catalog?: SubscriptionOffersView): SubscriptionIntent | null {
 if (!choice || !currentSubscriptionChoice(choice, choice.term, catalog)) return null;
 const offer = catalog!.offers.find(item => item.versionId === choice.versionId)!;
 return { persona: choice.persona, package: choice.package, term: choice.term, versionId: offer.versionId, amountBaisa: offer.amountBaisa, currency: offer.currency };
}

/** Unpublished or changed versions are inspection intent only, never a checkout choice. */
export function choiceFromSubscriptionIntent(intent: SubscriptionIntent | null, catalog?: SubscriptionOffersView): SubscriptionChoice | null {
 if (!intent?.versionId || catalog?.status !== "ready") return null;
 const offer = catalog.offers.find(item => item.versionId === intent.versionId && item.persona === intent.persona && item.package === intent.package
  && item.term === intent.term && item.amountBaisa === intent.amountBaisa && item.currency === intent.currency);
 return offer ? choiceFromOffer(offer) : null;
}

/** Preserve the exact selected published version through the existing access gates. */
export function subscriptionIntentHref(destination: SubscriptionDestination, intent: SubscriptionIntent | null): string {
 if (!intent || !["manage", "chooseCompany", "login", "verify", "profile", "setup"].includes(destination.kind)) return destination.href;
 const safeHref = destination.href;
 if (!safeHref.startsWith("/") || safeHref.startsWith("//") || safeHref.includes("\\")) return destination.href;
 const direct = destination.kind === "manage" || destination.kind === "chooseCompany";
 const target = new URL(direct ? safeHref : "/app/settings?tab=plan", "https://velora.invalid");
 for (const key of selectionKeys) target.searchParams.delete(key);
 target.searchParams.set("term", intent.term);
 if (intent.persona) target.searchParams.set("persona", intent.persona);
 if (intent.package) target.searchParams.set("package", intent.package);
 if (intent.versionId && intent.amountBaisa && intent.currency) {
  target.searchParams.set("version", intent.versionId);
  target.searchParams.set("amount", String(intent.amountBaisa));
  target.searchParams.set("currency", intent.currency);
 }
 const selectedPath = `${target.pathname}?${target.searchParams}${target.hash}`;
 if (direct) return selectedPath;
 const gate = new URL(safeHref, "https://velora.invalid");
 gate.searchParams.set("next", selectedPath);
 return `${gate.pathname}?${gate.searchParams}${gate.hash}`;
}

/** Navigation from the same company's stored order, never browser success/price queries. */
export function subscriptionReturnHref(requestCompanyId: string, row: BillingReturnDbRow | null, catalog?: SubscriptionOffersView): string {
 const fallback = "/app/settings?tab=plan";
 if (row?.companyId !== requestCompanyId || !row.selection || catalog?.status !== "ready") return fallback;
 const locked = row.selection;
 const offer = catalog.offers.find(item => item.versionId === locked.planVersionId && item.amountBaisa === locked.amountBaisa && item.currency === locked.currency);
 if (!offer) return fallback;
 const intent = subscriptionIntentFromChoice(choiceFromOffer(offer), catalog);
 return subscriptionIntentHref({ href: fallback, kind: "manage", note: null }, intent);
}
