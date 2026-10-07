import { describe, it, expect } from "vitest";
import { validateDraft, projectPublicCatalog } from "./contract";
const valid = { code:"noor_basic", currency:"OMR", amount_baisa:45000, period_unit:"month", period_count:1, automated_outbound_per_month:1000, feature_availability:{faq:"target"} };
describe("catalog backend boundary",()=>{
 it("accepts positive business baisa and successful automated outbound cap",()=>expect(validateDraft(valid)).toEqual(valid));
 it.each([0,-1,1.5,Number.MAX_SAFE_INTEGER+1])("rejects unsafe price %s",amount_baisa=>expect(validateDraft({...valid,amount_baisa})).toBeNull());
 it.each([0,-1,1.5])("rejects invalid cap %s",automated_outbound_per_month=>expect(validateDraft({...valid,automated_outbound_per_month})).toBeNull());
 it("rejects arbitrary variants, currency and operational feature claims",()=>{
  expect(validateDraft({...valid,code:"other"})).toBeNull(); expect(validateDraft({...valid,currency:"USD"})).toBeNull();
  expect(validateDraft({...valid,feature_availability:{pos:"operational"}})).toBeNull();
  expect(validateDraft({...valid,feature_availability:{private_cost:"target"}})).toBeNull();
 });
 it("keeps annual unavailable rather than inventing a price",()=>expect(validateDraft({...valid,period_unit:"year"})).toBeNull());
 it("projects only approved metadata and preserves immutable ids",()=>{
  const row={...valid,product_code:"velora_ai_staff",plan_id:"11111111-1111-4111-8111-111111111111",version_id:"22222222-2222-4222-8222-222222222222",version:1,persona:"noor",variant:"basic",checkout_enabled:false,internal_cost:99};
  const p=projectPublicCatalog([row]); expect(p).toHaveLength(1); expect(p[0].version_id).toBe(row.version_id);expect(p[0]).not.toHaveProperty("internal_cost");
  expect(projectPublicCatalog([{...row,checkout_enabled:true}])).toEqual([]);
  expect(projectPublicCatalog([{...row,persona:"dana"}])).toEqual([]);
 });
});
