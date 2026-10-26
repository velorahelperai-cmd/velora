import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {reconcileStoredBillingEvent,runStoredBillingReconciliation} from "./reconciliation";
describe("retired reconciliation",()=>{it("keeps historical events read-only",async()=>{expect(await reconcileStoredBillingEvent("old")).toEqual({kind:"blocked",code:"provider_retired"});expect(await runStoredBillingReconciliation()).toEqual({ok:false,code:"provider_retired"});});});
