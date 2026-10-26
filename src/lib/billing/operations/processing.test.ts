import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {processDurableBillingJobs,enqueueStoredBillingEvent} from "./processing";
describe("retired settlement worker",()=>{it("does not enqueue, claim, or invoke settlement",async()=>{const settle=vi.fn();expect(await processDurableBillingJobs(settle)).toEqual({ok:false,code:"provider_retired"});expect(await enqueueStoredBillingEvent("old")).toEqual({ok:false,code:"provider_retired"});expect(settle).not.toHaveBeenCalled();});});
