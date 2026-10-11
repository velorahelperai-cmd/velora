import {beforeEach,describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({access:vi.fn(),scope:vi.fn(),cap:vi.fn(),page:vi.fn(),thread:vi.fn(),from:vi.fn()}));
vi.mock("@/lib/tenancy/access",()=>({getCompanyAccess:state.access}));
vi.mock("@/lib/access/actions",()=>({sessionConversationScope:state.scope,sessionHasCompanyCapability:state.cap}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({from:state.from})}));
vi.mock("./inbox-contracts",()=>({loadWhatsappInboxPage:state.page,loadWhatsappThreadPage:state.thread}));
import {loadWhatsappInboxInitialPage} from "./inbox";
const company="11111111-1111-4111-8111-111111111111";
beforeEach(()=>{vi.resetAllMocks();state.access.mockResolvedValue({ok:true,context:{company:{id:company},membership:{role:"owner"}}});state.scope.mockResolvedValue("all_company");state.cap.mockImplementation(async(_:string,c:string)=>c==="wa.conversations.read");
 state.page.mockResolvedValue({ok:true,data:{kind:"partial",companyId:company,conversationScope:"all_company",conversations:[],hasMore:true,nextCursor:"99",total:80,unreadTotal:3,interventionTotal:2,membershipFingerprint:"fixture",ordering:"newest_created"}});
 state.from.mockReturnValue({select:()=>({eq:()=>({maybeSingle:async()=>({data:{timezone:"Asia/Muscat"},error:null})})})});});
describe("bounded initial inbox",()=>{
 it("keeps a partial page and authoritative totals without traversing full threads",async()=>{const r=await loadWhatsappInboxInitialPage();expect(r.ok).toBe(true);if(!r.ok)return;expect(r.page).toMatchObject({kind:"partial",total:80,hasMore:true});expect(r.meta.counts.all).toBe(0);expect(state.page).toHaveBeenCalledOnce();expect(state.page).toHaveBeenCalledWith({companyId:company,limit:40});expect(state.thread).not.toHaveBeenCalled();});
 it("unknown mutation capabilities remain false independently of company role",async()=>{const r=await loadWhatsappInboxInitialPage();expect(r.ok).toBe(true);if(r.ok)expect(r.meta).toMatchObject({canReply:false,canAssign:false,canTakeOver:false,canResume:false,canClose:false});});
 it("fails closed after a selected-company switch",async()=>{state.access.mockResolvedValueOnce({ok:true,context:{company:{id:company},membership:{}}}).mockResolvedValueOnce({ok:true,context:{company:{id:"other"},membership:{}}});expect(await loadWhatsappInboxInitialPage()).toEqual({ok:false,code:"UNAVAILABLE"});});
 it("does not load data without authoritative read permission",async()=>{state.cap.mockResolvedValue(null);expect(await loadWhatsappInboxInitialPage()).toEqual({ok:false,code:"UNAVAILABLE"});expect(state.page).not.toHaveBeenCalled();});
});

describe("initial inbox failure classification", () => {
 it("preserves explicit lower-reader denial without downstream reads", async () => {
  state.page.mockResolvedValue({ok:false,code:"FORBIDDEN"});
  expect(await loadWhatsappInboxInitialPage()).toEqual({ok:false,code:"FORBIDDEN"});
  expect(state.from).not.toHaveBeenCalled();
 });
 it.each(["UNAVAILABLE","SCOPE_CHANGED","INVALID_INPUT","NOT_FOUND"])("keeps %s unavailable", async code => {
  state.page.mockResolvedValue({ok:false,code});
  expect(await loadWhatsappInboxInitialPage()).toEqual({ok:false,code:"UNAVAILABLE"});
 });
 it.each([false,null])("does not interpret ambiguous capability %s as denial", async value => {
  state.cap.mockResolvedValue(value);
  expect(await loadWhatsappInboxInitialPage()).toEqual({ok:false,code:"UNAVAILABLE"});
  expect(state.page).not.toHaveBeenCalled();
 });
 it("keeps unknown scope unavailable", async () => {
  state.scope.mockResolvedValue(null);
  expect(await loadWhatsappInboxInitialPage()).toEqual({ok:false,code:"UNAVAILABLE"});
  expect(state.page).not.toHaveBeenCalled();
 });
});
