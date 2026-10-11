import {beforeEach, expect, it, vi} from "vitest";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const actor=id(1),team=id(2);
const state=vi.hoisted(()=>({identity:vi.fn(),role:vi.fn(),directory:vi.fn(),redirect:vi.fn(),admin:vi.fn()}));
vi.mock("@/lib/auth/server-identity",()=>({readSessionIdentity:state.identity}));
vi.mock("@/lib/tenancy/account-platform-identity",()=>({readAccountPlatformIdentity:state.role}));
vi.mock("@/lib/platform-teams/actions",()=>({readPlatformTeamDirectory:state.directory}));
vi.mock("@/lib/tenancy/access",()=>({requirePlatformAdmin:state.admin}));
vi.mock("next/navigation",()=>({redirect:(href:string)=>{state.redirect(href);throw Error("REDIRECT");}}));
vi.mock("@/components/teams/teams-page",()=>({TeamsPage:"teams-page",TeamsFailure:"teams-failure"}));
vi.mock("@/components/app/access-gate",()=>({AccessGate:"access-gate"}));
const subject=await import("./ui-routing").catch(()=>null);
const managerPage=await import("@/app/account/teams/page").catch(()=>null);
const ownerPage=await import("@/app/admin/teams/page").catch(()=>null);
beforeEach(()=>{vi.clearAllMocks();state.identity.mockResolvedValue({ok:true,userId:actor,email:"synthetic@example.invalid",emailConfirmed:true});state.role.mockResolvedValue({role:"owner",status:"active",unavailable:false});state.directory.mockResolvedValue({ok:true,data:{kind:"teams",rows:[],total:0,nextCursor:null,team:null}});});
it("manager route serves an R3-authorized delegated manager with no company scope",async()=>{
 expect(managerPage?.default).toBeTypeOf("function");state.role.mockResolvedValue({role:"delegated",status:"active",unavailable:false});
 const tree=await managerPage!.default({searchParams:Promise.resolve({team})});
 expect(tree.props.actorId).toBe(actor);expect(tree.props.editor).toBe(false);expect(state.directory).toHaveBeenCalledWith(expect.objectContaining({expectedUserId:actor,teamId:team}));expect(state.admin).not.toHaveBeenCalled();
});
it("manager route denies an employee or unknown team without expanding admin access",async()=>{
 expect(managerPage?.default).toBeTypeOf("function");state.directory.mockResolvedValue({ok:false,code:"FORBIDDEN"});const tree=await managerPage!.default({searchParams:Promise.resolve({team})});expect(tree.props.code).toBe("FORBIDDEN");expect(state.admin).not.toHaveBeenCalled();
});
it("owner editor rejects a delegated user's direct request",async()=>{
 expect(ownerPage?.default).toBeTypeOf("function");state.role.mockResolvedValue({role:"delegated",status:"active",unavailable:false});const tree=await ownerPage!.default({searchParams:Promise.resolve({})});expect(tree.props.code).toBe("FORBIDDEN");expect(state.directory).not.toHaveBeenCalled();
});
it("owner editor refuses an unavailable role read rather than assuming owner",async()=>{
 expect(ownerPage?.default).toBeTypeOf("function");state.role.mockResolvedValue({role:null,status:null,unavailable:true});const tree=await ownerPage!.default({searchParams:Promise.resolve({})});expect(tree.props.code).toBe("UNAVAILABLE");
});
it("verified-session roster sends unauthenticated users to login with the correct return",async()=>{
 expect(managerPage?.default).toBeTypeOf("function");state.identity.mockResolvedValue({ok:false,code:"UNAUTHENTICATED"});await expect(managerPage!.default({searchParams:Promise.resolve({})})).rejects.toThrow("REDIRECT");expect(state.redirect).toHaveBeenCalledWith("/login?next=%2Faccount%2Fteams");
});
it("malformed route scope is rejected before any R3 call",async()=>{
 expect(managerPage?.default).toBeTypeOf("function");const tree=await managerPage!.default({searchParams:Promise.resolve({team:"not-a-team"})});expect(tree.props.code).toBe("INVALID_INPUT");expect(state.directory).not.toHaveBeenCalled();
});
it("search reset removes cursor/team state and URL parsing binds navigation to the current actor",()=>{
 expect(subject?.teamHref).toBeTypeOf("function");const cursor={id:id(3),revision:1,actorUserId:actor,teamId:team,search:"Support",scopeRevision:"a".repeat(32)};
 const href=subject!.teamHref("/account/teams",{teamId:team,search:"Support",cursor});
 expect(subject!.teamQuery(actor,new URL(href,"https://example.invalid").searchParams)).toEqual(expect.objectContaining({ok:true,data:expect.objectContaining({teamId:team,search:"Support",cursor})}));
 expect(subject!.teamHref("/account/teams",{teamId:null,search:"",cursor:null})).toBe("/account/teams");
 const wrong=subject!.teamQuery(id(9),new URL(href,"https://example.invalid").searchParams);expect(wrong.ok&&wrong.data.cursor).toBeNull();
});
