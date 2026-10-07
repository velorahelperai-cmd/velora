import {describe,it,expect} from "vitest";
import {quoteOffer, technicalUpgrade, retryDelay, canUseFeature} from "./contracts";
describe("operational billing boundaries",()=>{
 it("applies a valid fixed discount in integer baisa",()=>expect(quoteOffer({price:45000,discount:5000,now:10,validFrom:0,validUntil:20,companyEligible:true,planEligible:true,remaining:1})).toEqual({ok:true,amountBaisa:40000}));
 it("rejects expired, exhausted and wrong-company offers",()=>{for(const overrides of [{now:20},{remaining:0},{companyEligible:false},{planEligible:false},{discount:45000},{discount:1.5}])expect(quoteOffer({price:45000,discount:5000,now:10,validFrom:0,validUntil:20,companyEligible:true,planEligible:true,remaining:1,...overrides}).ok).toBe(false);});
 it("never invents upgrade pricing",()=>expect(technicalUpgrade()).toEqual({ok:false,code:"upgrade_pricing_not_configured"}));
 it("bounds retries and terminates attempts at cap",()=>{expect(retryDelay(1)).toBe(10000);expect(retryDelay(5)).toBeNull();});
 it("preserves authorized read/export after expiry and blocks paid work",()=>{expect(canUseFeature({authorized:true,companyStatus:"active",paidThrough:10,now:20,operation:"export",enabled:[]})).toBe(true);expect(canUseFeature({authorized:true,companyStatus:"active",paidThrough:10,now:20,operation:"automated_outbound",enabled:[]})).toBe(false);expect(canUseFeature({authorized:false,companyStatus:"active",paidThrough:30,now:20,operation:"read",enabled:[]})).toBe(false);});
});
