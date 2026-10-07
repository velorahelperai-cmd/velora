export const VARIANT_CODES = ["noor_basic","noor_premium","lina_basic","lina_premium","dana_basic","dana_premium"] as const;
export const FEATURE_KEYS = ["faq","knowledge","enquiry_handoff","website","lead_followup","reports","pos","orders","endcustomer_payment","accounting"] as const;
export type VariantCode = typeof VARIANT_CODES[number];
export type FeatureAvailability = Partial<Record<typeof FEATURE_KEYS[number],"target"|"not_verified">>;
export type CatalogDraft = {code:VariantCode;currency:"OMR";amount_baisa:number;period_unit:"month";period_count:1;automated_outbound_per_month:number;feature_availability:FeatureAvailability};
export type PublicCatalogVersion = CatalogDraft & {product_code:"velora_ai_staff";plan_id:string;version_id:string;version:number;persona:"noor"|"lina"|"dana";variant:"basic"|"premium";checkout_enabled:false};
export type CatalogAdminSnapshot = {revision:number;versions:Record<string,unknown>[]};
export type CatalogResult<T> = {ok:true;data:T}|{ok:false;code:"forbidden"|"unavailable"|"invalid_input"|"conflict"|"not_found"|"immutable"};
const object = (v:unknown):v is Record<string,unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const positive = (v:unknown):v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
export function validateDraft(input:unknown):CatalogDraft|null {
 if(!object(input)||!VARIANT_CODES.includes(input.code as VariantCode)||input.currency!=="OMR"||!positive(input.amount_baisa)||!positive(input.automated_outbound_per_month)||input.automated_outbound_per_month>100_000_000||input.period_unit!=="month"||input.period_count!==1||!object(input.feature_availability)) return null;
 const features:FeatureAvailability={};
 for(const [k,v] of Object.entries(input.feature_availability)) {
  if(!FEATURE_KEYS.includes(k as typeof FEATURE_KEYS[number])||(v!=="target"&&v!=="not_verified")) return null;
  features[k as typeof FEATURE_KEYS[number]]=v;
 }
 return {code:input.code as VariantCode,currency:"OMR",amount_baisa:input.amount_baisa,period_unit:"month",period_count:1,automated_outbound_per_month:input.automated_outbound_per_month,feature_availability:features};
}
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
export function projectPublicCatalog(input:unknown):PublicCatalogVersion[] {
 if(!Array.isArray(input)) return [];
 return input.flatMap(row=>{
  const draft=validateDraft(row);
  if(!draft||!object(row)||row.product_code!=="velora_ai_staff"||!uuid(row.plan_id)||!uuid(row.version_id)||!positive(row.version)||row.checkout_enabled!==false) return [];
  const [persona,variant]=draft.code.split("_");
  if(row.persona!==persona||row.variant!==variant) return [];
  return [{...draft,product_code:"velora_ai_staff",plan_id:row.plan_id,version_id:row.version_id,version:row.version,persona:persona as PublicCatalogVersion["persona"],variant:variant as PublicCatalogVersion["variant"],checkout_enabled:false}];
 });
}
