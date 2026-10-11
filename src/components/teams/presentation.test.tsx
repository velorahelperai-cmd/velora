import {expect,it,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {teamCopy} from "./copy";
const subject=await import("./team-self-panel");
vi.mock("@/lib/platform-teams/actions",()=>({readPlatformTeamSelf:vi.fn()}));
vi.mock("@/components/app/account-chrome",()=>({useOptionalAccountSession:()=>null}));
vi.mock("next/link",()=>({default:"a"}));
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:"en"})}));
const actor="00000000-0000-4000-8000-000000000001",team="00000000-0000-4000-8000-000000000002",manager="00000000-0000-4000-8000-000000000003";
it("caller-only denied summary never renders retained team/manager details or roster links",()=>{
 expect(subject?.TeamSelfSummary).toBeTypeOf("function");
 const text=renderToStaticMarkup(createElement(subject!.TeamSelfSummary,{copy:teamCopy("en"),value:{memberships:[{membership:{teamId:team,userId:actor,status:"disabled",revision:2,specialty:"Support",role:"employee"},team:null,manager:null,access:"denied"}]}}));
 expect(text).toContain("Membership retained");expect(text).toContain("Support");expect(text).not.toContain(team);expect(text).not.toContain("href=");
});
it("active employee sees their actual manager summary and no colleague roster",()=>{
 expect(subject?.TeamSelfSummary).toBeTypeOf("function");
 const text=renderToStaticMarkup(createElement(subject!.TeamSelfSummary,{copy:teamCopy("en"),value:{memberships:[{membership:{teamId:team,userId:actor,status:"active",revision:1,specialty:"Support",role:"employee"},team:{id:team,name:"Synthetic team",status:"active",managerUserId:manager,revision:1},manager:{userId:manager,fullName:"Synthetic manager"},access:"active"}]}}));
 expect(text).toContain("Synthetic team");expect(text).toContain("Synthetic manager");expect(text).not.toContain("href=");
});
it("eligible manager summary offers the account roster route, without admin/company scope",()=>{
 expect(subject?.TeamSelfSummary).toBeTypeOf("function");
 const text=renderToStaticMarkup(createElement(subject!.TeamSelfSummary,{copy:teamCopy("ar"),value:{memberships:[{membership:{teamId:team,userId:actor,status:"active",revision:1,specialty:"Support",role:"manager"},team:{id:team,name:"فريق",status:"active",managerUserId:actor,revision:1},manager:null,access:"active"}]}}));
 expect(text).toContain("/account/teams?team=");expect(text).not.toContain("/admin");expect(text).not.toContain("company");
});
