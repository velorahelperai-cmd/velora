import type { CatalogResult, PublicCatalogVersion } from "@/lib/billing/catalog-backend/contract";
/** UI projection boundary. Populate from the backend catalog contract; never seed UI prices. */
export type SubscriptionPersona = "level_1" | "level_2" | "level_3";
export type SubscriptionPackage = "basic" | "premium";
export type SubscriptionTerm = "monthly" | "yearly";
export type SubscriptionFeatureView = {
  id: string;
  label: { ar: string; en: string };
  availability: "ready" | "planned" | "configuration_required" | "not_verified";
};
export type SubscriptionOfferView = {
  versionId: string;
  catalogVersion?: number;
  planId: string;
  persona: SubscriptionPersona;
  package: SubscriptionPackage;
  term: SubscriptionTerm;
  amountBaisa: number;
  currency: "OMR";
  automatedOutboundPerMonth: number | null;
  quotaEnforcement: "ready" | "not_verified";
  /** Public catalog currently forbids production checkout; Test has separate server flags. */
  checkoutEnabled?: false;
  features: readonly SubscriptionFeatureView[];
};
export type SubscriptionOffersView = {
  status: "ready" | "empty" | "unconfigured" | "error";
  offers: readonly SubscriptionOfferView[];
};
export type SubscriptionChoice = {
  persona: SubscriptionPersona;
  package: SubscriptionPackage;
  versionId: string;
  term: SubscriptionTerm;
  offerSignature: string;
};

/** A selection is only valid against the same published server offer. */
export function subscriptionOfferSignature(offer: SubscriptionOfferView): string {
  return JSON.stringify([offer.planId, offer.amountBaisa, offer.currency, offer.automatedOutboundPerMonth, offer.quotaEnforcement, offer.checkoutEnabled ?? false, offer.features]);
}
export function choiceFromOffer(offer: SubscriptionOfferView): SubscriptionChoice {
  return { persona: offer.persona, package: offer.package, versionId: offer.versionId, term: offer.term, offerSignature: subscriptionOfferSignature(offer) };
}
export function currentSubscriptionChoice(choice: SubscriptionChoice | null, term: SubscriptionTerm, catalog?: SubscriptionOffersView): SubscriptionChoice | null {
  if (!choice || choice.term !== term || catalog?.status !== "ready") return null;
  const offer = catalog.offers.find(item => item.versionId === choice.versionId && item.persona === choice.persona && item.package === choice.package && item.term === term);
  return offer && subscriptionOfferSignature(offer) === choice.offerSignature ? choice : null;
}
export function findOffer(offers: readonly SubscriptionOfferView[], persona: SubscriptionPersona, pack: SubscriptionPackage, term: SubscriptionTerm): SubscriptionOfferView | undefined {
  return offers.find(item => item.persona === persona && item.package === pack && item.term === term);
}
export function catalogHasTerm(catalog: SubscriptionOffersView | undefined, term: SubscriptionTerm): boolean {
  return catalog?.status === "ready" && catalog.offers.some(item => item.term === term);
}

const personaByCode = { noor: "level_1", lina: "level_2", dana: "level_3" } as const;
export const featureLabels: Record<string, { ar: string; en: string }> = {
 faq:{ar:"الأسئلة الشائعة",en:"Frequently asked questions"}, knowledge:{ar:"معرفة الشركة",en:"Company knowledge"}, enquiry_handoff:{ar:"تحويل الاستفسارات",en:"Enquiry handoff"},
 website:{ar:"الموقع الإلكتروني",en:"Website"}, lead_followup:{ar:"متابعة العملاء المحتملين",en:"Lead follow-up"}, reports:{ar:"التقارير",en:"Reports"}, pos:{ar:"نقاط البيع",en:"Point of sale"}, orders:{ar:"الطلبات",en:"Orders"}, endcustomer_payment:{ar:"دفع العملاء",en:"Customer payments"}, accounting:{ar:"المحاسبة",en:"Accounting"}
};

/** Inherited Test-selection variant gate; it does not authorize production checkout. */
export function isApprovedOffer(persona: SubscriptionPersona, pack: SubscriptionPackage, term: SubscriptionTerm): boolean {
  return persona === "level_1" && pack === "basic" && term === "monthly";
}

/**
 * Display eligibility for Paymob Test only; never production checkout authorization.
 * A test offer is selectable ONLY IF:
 * 1. It matches the inherited Noura Basic Monthly Test-selection reference.
 *    This reference is not evidence of owner/processor Live approval.
 * 2. Real backend public catalog projection status is 'ready'
 * 3. The matching offer is actually published and returned by the catalog
 */
export function isPurchasableOffer(
  persona: SubscriptionPersona,
  pack: SubscriptionPackage,
  term: SubscriptionTerm,
  offer: SubscriptionOfferView | undefined,
  catalogStatus?: SubscriptionOffersView["status"]
): boolean {
  return isApprovedOffer(persona, pack, term) && catalogStatus === "ready"
    && offer?.persona === persona && offer.package === pack && offer.term === term
    && offer.currency === "OMR" && offer.amountBaisa === 45000;
}

/** Formats integer baisa into strict 3-decimal OMR string (e.g. 45.000 OMR / 45.000 ر.ع.). */
export function formatOmrBaisa(amountBaisa: number, locale: "ar" | "en"): string {
  const whole = Math.floor(amountBaisa / 1000);
  const frac = (amountBaisa % 1000).toString().padStart(3, "0");
  const wholeStr = whole.toLocaleString("en-US");
  return locale === "ar" ? `${wholeStr}.${frac} ر.ع.` : `${wholeStr}.${frac} OMR`;
}

/** Display the validated public RPC projection; never invent prices or ready capabilities. */
export function offersViewFromCatalog(result: CatalogResult<PublicCatalogVersion[]>): SubscriptionOffersView {
 if (!result.ok) return {status:"error",offers:[]};
 const offers: SubscriptionOfferView[] = result.data.map(row => ({
  versionId:row.version_id,catalogVersion:row.version,planId:row.plan_id,persona:personaByCode[row.persona],package:row.variant,term:"monthly",amountBaisa:row.amount_baisa,currency:row.currency,
  automatedOutboundPerMonth:row.automated_outbound_per_month,quotaEnforcement:"not_verified",checkoutEnabled:row.checkout_enabled,
  features:Object.entries(row.feature_availability).map(([id,state])=>({id,label:featureLabels[id],availability:state==="target"?"planned":"not_verified"}))
 }));
 return {status:offers.length?"ready":"empty",offers};
}
