import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({identity:vi.fn(),rpc:vi.fn()}));
vi.mock("@/lib/auth/server-identity",()=>({readSessionIdentity:mocks.identity}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock("@/lib/logging/logger.mjs",()=>({withLogContext:(_context:unknown,run:()=>unknown)=>run()}));
import {confirmOwnedBranchReplyLanguageAction} from "./paid-reply-language-actions";
const input={expectedAccountId:"11111111-1111-4111-8111-111111111111",companyId:"22222222-2222-4222-8222-222222222222",branchId:"33333333-3333-4333-8333-333333333333",expectedVersion:1,replyLanguage:"en" as const};
beforeEach(()=>{vi.clearAllMocks();mocks.identity.mockResolvedValue({ok:true,userId:input.expectedAccountId});});
it.each([undefined,null,0,-1,1.5,Number.MAX_SAFE_INTEGER+1])("rejects invalid expected revision %s before identity or RPC",async expectedVersion=>{
 expect(await confirmOwnedBranchReplyLanguageAction({...input,expectedVersion:expectedVersion as number})).toBeNull();expect(mocks.identity).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
});
it("forwards valid revision and adopts only a confirmed RPC snapshot",async()=>{
 const snapshot={version:2,replyLanguage:"en"};mocks.rpc.mockResolvedValueOnce({data:{ok:true,data:{snapshot}},error:null});
 expect(await confirmOwnedBranchReplyLanguageAction(input)).toEqual(snapshot);expect(mocks.rpc).toHaveBeenCalledWith("es02_confirm_owned_branch_reply_language",expect.objectContaining({p_expected_version:1,p_reply_language:"en"}));
 mocks.rpc.mockResolvedValueOnce({data:{ok:false,code:"CONFLICT"},error:null});expect(await confirmOwnedBranchReplyLanguageAction(input)).toBeNull();
});
