import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({load:vi.fn(),patch:vi.fn()}));
vi.mock("./registry",()=>({loadBrokerOperation:m.load,updateBrokerOperation:m.patch,operationRevocationComplete:()=>false}));
vi.mock("./log",()=>({brokerLog:vi.fn()}));
import { acknowledgeBrokerClientCleanup } from "./recovery";
beforeEach(()=>{vi.clearAllMocks();m.load.mockResolvedValue({actorUserId:"actor-a",kind:"logout",status:"confirmed",stages:{nativeRevocation:"confirmed",clientCleanup:"pending"},legacyCoverage:null});m.patch.mockResolvedValue(true);});
it("confirmed original logout ACK changes only cleanup and cannot demote an unrelated terminal status",async()=>{
 expect(await acknowledgeBrokerClientCleanup({operationKey:"original-op",actorUserId:"actor-a"})).toBe(true);
 expect(m.patch).toHaveBeenCalledExactlyOnceWith("original-op",{stages:{nativeRevocation:"confirmed",clientCleanup:"confirmed"}});
});
it("pending password ACK cannot promote the operation and reports actual durable failure",async()=>{
 m.load.mockResolvedValue({actorUserId:"actor-a",kind:"password_revoke",status:"pending",stages:{nativeRevocation:"unknown",clientCleanup:"pending"}});m.patch.mockResolvedValue(false);
 expect(await acknowledgeBrokerClientCleanup({operationKey:"original-op",actorUserId:"actor-a"})).toBe(false);
 expect(m.patch).toHaveBeenCalledExactlyOnceWith("original-op",{stages:{nativeRevocation:"unknown",clientCleanup:"confirmed"}});
});
it("foreign actor cannot acknowledge original cleanup",async()=>{expect(await acknowledgeBrokerClientCleanup({operationKey:"original-op",actorUserId:"actor-b"})).toBe(false);expect(m.patch).not.toHaveBeenCalled();});
