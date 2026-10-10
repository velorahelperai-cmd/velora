/** The inherited Test offer is not a Live merchant/catalog approval. */
export const PUBLIC_TEST_OFFER_AMOUNT_BAISA = 45000;
export type PublicTestOfferSnapshot = {
 id: string; plan_id: string; status: "published"; plan_status: "active";
 plan_code: "noor_basic"; amount_baisa: number; currency: "OMR";
 period_days: number; period_unit: "month"; period_count: 1;
 service_code: "noura"; tier: "basic"; capabilities: ["noura.knowledge.read"]; bound: true;
};
export const billingUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
/** Parse a server read only. The mutation independently repeats policy under locks. */
export function evaluatePublicOffer(value: unknown, versionId: string): PublicTestOfferSnapshot | null {
 if (!value || typeof value !== "object" || Array.isArray(value)) return null;
 const v=value as Record<string,unknown>;
 if (!billingUuid(v.id) || v.id!==versionId || !billingUuid(v.plan_id)
  || v.status!=="published" || v.plan_status!=="active" || v.plan_code!=="noor_basic"
  || v.amount_baisa!==PUBLIC_TEST_OFFER_AMOUNT_BAISA || v.currency!=="OMR"
  || !Number.isSafeInteger(v.period_days) || Number(v.period_days)<1
  || v.period_unit!=="month" || v.period_count!==1 || v.bound!==true
  || v.service_code!=="noura" || v.tier!=="basic" || !Array.isArray(v.capabilities)
  || v.capabilities.length!==1 || v.capabilities[0]!=="noura.knowledge.read") return null;
 return v as PublicTestOfferSnapshot;
}
