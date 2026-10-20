import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {beforeEach,expect,it,vi} from "vitest";
import {PaidWhatsappRoute,confirmedWhatsappReturn,type PaidWhatsappRouteProps} from "./paid-whatsapp-route";
import {unavailablePaidBranchConnectionRead} from "@/lib/tenancy/paid-branch-connection-contracts";
import {paidSetupUnavailable} from "@/lib/tenancy/paid-setup-contracts";

const session=vi.hoisted(()=>({status:"ready",identity:{userId:"actor",companyId:"company"},boundaryFingerprint:"capture",liveSnapshot:()=>({ready:true,userId:"actor",boundaryFingerprint:"capture"}),isCurrentUser:()=>true}));
vi.mock("./account-chrome",()=>({useOptionalAccountSession:()=>session,AccountMenu:()=>null}));
vi.mock("./ui",()=>({LangSwitch:()=>null}));
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:"en"})}));
export function fixture():PaidWhatsappRouteProps {
  const scope={expectedAccountId:"actor",companyId:"company",branchId:"11111111-1111-4111-8111-111111111111"};
  const read=paidSetupUnavailable({companyId:scope.companyId,branchId:scope.branchId,asOf:"2026-10-20T08:00:00Z",blockedReasons:[]});
  Object.assign(read,{companyId:scope.companyId,sourceStatus:"ready",branches:[{id:scope.branchId,label:"Main branch"}],selectedChannels:["whatsapp"],entitlement:{orderGroupId:"order",slotIndex:0,persona:"level_2",package:"basic",maxChannels:1,employeesExcludingOwner:2},
    steps:[{id:"connect_whatsapp",required:true,dependencyIds:[],status:"verified",reasonCodes:[],actionId:"connect"}],progress:{denominator:7,verified:1,skippedOptional:0}});
  const connectionRead=unavailablePaidBranchConnectionRead({...scope,channel:"whatsapp"},"2026-10-20T08:00:00Z","source_failed");
  Object.assign(connectionRead,{sourceStatus:"ready",revision:"3",connection:{state:"connected",verified:true,link:{id:"link",generation:2},attempt:null,flow:"wa_new_number",reasonCodes:[]}});
  return {scope,read,connectionRead,confirmedGeneration:2};
}
beforeEach(()=>{session.identity={userId:"actor",companyId:"company"};session.status="ready";});
it("requires matching authoritative generation and B1 completion",()=>{expect(confirmedWhatsappReturn(fixture())).toBe(true);});
it.each(["pending","reconciliation_required","unavailable","not_connected"] as const)("never returns for %s",state=>{
  const p=fixture();p.connectionRead.connection.state=state;expect(confirmedWhatsappReturn(p)).toBe(false);
});
it.each(["actor","company","branch","channel","generation","unverified","stale","unpaid","projection","missingProof"] as const)("rejects %s disagreement",kind=>{
  const p=fixture();
  if(kind==="actor")p.connectionRead.expectedAccountId="other";
  if(kind==="company")p.read.companyId="other";
  if(kind==="branch")p.read.selectedBranchId="other";
  if(kind==="channel")p.read.selectedChannels=["instagram"];
  if(kind==="generation")p.confirmedGeneration=1;
  if(kind==="unverified")p.connectionRead.connection.verified=false;
  if(kind==="stale")p.connectionRead.connection.reasonCodes=["stale_scope"];
  if(kind==="unpaid")p.read.entitlement=null;
  if(kind==="projection")p.read.steps[0]!.status="pending";
  if(kind==="missingProof")p.confirmedGeneration=null;
  expect(confirmedWhatsappReturn(p)).toBe(false);
});
it("uses a same-tab scoped return link without starting any provider",()=>{
  const html=renderToStaticMarkup(createElement(PaidWhatsappRoute,fixture()));
  expect(html).toContain('href="/setup?branch=11111111-1111-4111-8111-111111111111"');
  expect(html).not.toContain('target="_blank"');expect(html).not.toContain("<script");
});
it.each(["actor","company","loading"])("hides connection controls for stale %s",kind=>{
  if(kind==="actor")session.identity.userId="other";
  if(kind==="company")session.identity.companyId="other";
  if(kind==="loading")session.status="loading";
  const html=renderToStaticMarkup(createElement(PaidWhatsappRoute,fixture()));
  expect(html).toContain("Your workspace session changed");expect(html).not.toContain("<fieldset");
});
