import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), rpc: vi.fn(), signOut: vi.fn(), select: vi.fn(), setSession: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, auth: { admin: { signOut: mocks.signOut } }, from: () => {
 const q = { update: () => q, eq: () => q, neq: () => q, select: mocks.select, maybeSingle: mocks.load }; return q;
} }) }));
vi.mock("./crypto", () => ({ encryptSecret: () => Buffer.from("synthetic-encrypted"), decryptSecret: (value:Buffer) => value.toString()==="access"?"synthetic-access":"synthetic-refresh" }));
vi.mock("./session-id", () => ({ nativeSessionIdFromAccessToken: () => "00000000-0000-4000-8000-000000000001" }));
vi.mock("./log", () => ({ brokerLog: vi.fn() }));
import { signOutProviderSessionAfterAdmitFailure, resumeProviderCleanup } from "./provider-session";
const session = { access_token: "synthetic-access", refresh_token: "synthetic-refresh", user: { id: "synthetic-user" } } as never;
const bundle = { client: { auth: { setSession: mocks.setSession, signOut: vi.fn() } } } as never;
const journal = { intentId: "synthetic-intent", operationKey: "synthetic-operation" };
beforeEach(() => { vi.resetAllMocks(); mocks.rpc.mockResolvedValue({error:null,data:{ok:true,allowed:true}}); mocks.signOut.mockResolvedValue({ error: null }); mocks.select.mockResolvedValue({ data: [{ id: "synthetic-intent" }], error: null }); });
it("cleans up the captured token directly without installing or refreshing a provider session", async () => {
 const result = await signOutProviderSessionAfterAdmitFailure(bundle, session, journal);
 expect(mocks.setSession).not.toHaveBeenCalled();
 expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith("synthetic-access", "local");
 expect(result).toMatchObject({ outcome: "confirmed", durable: true });
});
it("journal write failure never reports durable cleanup confirmation", async () => {
 mocks.select.mockResolvedValue({ data: null, error: { code: "SYNTHETIC_FAILURE" } });
 expect(await signOutProviderSessionAfterAdmitFailure(bundle, session, journal)).toMatchObject({ outcome: "unknown", durable: false });
});
it("ambiguous provider cleanup remains unknown with a durable journal", async () => {
 mocks.signOut.mockRejectedValue(Error("synthetic timeout"));
 expect(await signOutProviderSessionAfterAdmitFailure(bundle, session, journal)).toMatchObject({ outcome: "unknown", durable: true });
});

it("committed admission ownership forbids provider cleanup", async()=>{
 mocks.rpc.mockResolvedValue({error:null,data:{ok:true,allowed:false,adopted:true}});
 const result=await signOutProviderSessionAfterAdmitFailure(bundle,session,journal);
 expect(mocks.signOut).not.toHaveBeenCalled();expect(result.outcome).toBe("unknown");
});
it("unavailable atomic cleanup disposition has no provider effect",async()=>{
 mocks.rpc.mockResolvedValue({error:{code:"SYNTHETIC_DB_DOWN"},data:null});
 expect(await signOutProviderSessionAfterAdmitFailure(bundle,session,journal)).toMatchObject({outcome:"unknown",durable:false});
 expect(mocks.signOut).not.toHaveBeenCalled();
});
it("resumed already-confirmed cleanup needs no repeated provider effect",async()=>{
 mocks.rpc.mockResolvedValue({error:null,data:{ok:true,allowed:false,cleanup_state:"confirmed"}});
 expect(await signOutProviderSessionAfterAdmitFailure(bundle,session,journal)).toMatchObject({outcome:"confirmed",durable:true});
 expect(mocks.signOut).not.toHaveBeenCalled();
});

it("resumes encrypted unknown cleanup only from the bound authoritative intent",async()=>{
 const q={eq:()=>q,maybeSingle:mocks.load};mocks.select.mockReturnValueOnce(q);
 mocks.load.mockResolvedValue({error:null,data:{status:"rejected",cleanup_state:"unknown",user_id:"synthetic-user",committed_native_session_id:"00000000-0000-4000-8000-000000000001",provider_access_enc:Buffer.from("access").toString("base64"),provider_refresh_enc:Buffer.from("refresh").toString("base64")}});
 expect(await resumeProviderCleanup("synthetic-intent","synthetic-lineage")).toMatchObject({outcome:"confirmed",durable:true});
 expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith("synthetic-access","local");
});
