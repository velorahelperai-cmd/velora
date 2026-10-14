import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({beat:vi.fn(),cleanup:null as null|(()=>void)}));
vi.mock("react",()=>({useEffect:(effect:()=>()=>void)=>{state.cleanup=effect();}}));
vi.mock("@/lib/enterprise/actions",()=>({heartbeatEnterprisePresence:state.beat}));
import { EnterprisePresence } from "./enterprise-presence";
beforeEach(()=>{
 vi.useFakeTimers();vi.clearAllMocks();state.cleanup=null;
 vi.stubGlobal("document",{visibilityState:"visible",addEventListener:vi.fn(),removeEventListener:vi.fn()});
 state.beat.mockResolvedValue({ok:true,data:{inShift:true}});
});
afterEach(()=>{state.cleanup?.();vi.useRealTimers();vi.unstubAllGlobals();});
it("retries after a disconnected request without treating it as a heartbeat",async()=>{
 state.beat.mockRejectedValueOnce(new TypeError("Offline"));
 EnterprisePresence({userId:"user",companyId:"company"});
 await vi.advanceTimersByTimeAsync(30000);
 expect(state.beat).toHaveBeenCalledTimes(2);
});
it("stops polling once native authorization is withdrawn",async()=>{
 state.beat.mockResolvedValue({ok:false,code:"FORBIDDEN"});
 EnterprisePresence({userId:"user",companyId:"company"});
 await vi.advanceTimersByTimeAsync(90000);
 expect(state.beat).toHaveBeenCalledTimes(1);
});
it("does not send background-tab presence and cancels when unmounted",async()=>{
 Object.defineProperty(document,"visibilityState",{value:"hidden",writable:true});
 EnterprisePresence({userId:"user",companyId:"company"});
 await vi.advanceTimersByTimeAsync(30000);
 expect(state.beat).not.toHaveBeenCalled();
 state.cleanup?.();state.cleanup=null;
 Object.defineProperty(document,"visibilityState",{value:"visible",writable:true});
 await vi.advanceTimersByTimeAsync(30000);
 expect(state.beat).not.toHaveBeenCalled();
});
