// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/tenancy/paid-team-actions",()=>({readOwnedBranchTeamAction:vi.fn(async()=>null),inviteOwnedBranchTeamAction:vi.fn()}));

vi.mock("@/lib/tenancy/branch-hours-actions", () => ({
  readOwnedBranchHoursAction: vi.fn(async () => ({ ok: false, code: "unavailable", snapshot: null })),
  saveOwnedBranchHoursAction: vi.fn(),
  copyOwnedBranchHoursAction: vi.fn(),
}));

vi.mock("@/lib/tenancy/paid-branch-knowledge-actions", () => ({
  readOwnedBranchKnowledgeAction: vi.fn(async () => null),
  addOwnedBranchWebsiteAction: vi.fn(),
  pageActionOwnedBranchKnowledgeAction: vi.fn(),
  saveOwnedBranchKnowledgeTextAction:vi.fn(),
  uploadOwnedBranchKnowledgeFilesAction:vi.fn(),
  approveOwnedBranchKnowledgeSourceAction:vi.fn(),
}));

vi.mock("@/lib/tenancy/paid-reply-language-actions", () => ({
  readOwnedBranchReplyLanguageAction: vi.fn(async () => null),
  confirmOwnedBranchReplyLanguageAction: vi.fn(),
}));

vi.mock("@/lib/tenancy/paid-assistant-trial-actions", () => ({
  readOwnedBranchAssistantTrialAction: vi.fn(async () => null),
  askOwnedBranchAssistantTrialAction: vi.fn(),
}));

vi.mock("@/lib/tenancy/paid-launch-actions", () => ({
  readOwnedBranchLaunchSummaryAction: vi.fn(async () => null),
  confirmOwnedBranchLaunchAction: vi.fn(),
}));

import { PaidSetupStepHost, type PaidSetupStepHostProps } from "./paid-setup-step-host";
import {readOwnedBranchTeamAction,inviteOwnedBranchTeamAction} from '@/lib/tenancy/paid-team-actions';
import {readOwnedBranchLaunchSummaryAction,confirmOwnedBranchLaunchAction} from '@/lib/tenancy/paid-launch-actions';

const baseProps: PaidSetupStepHostProps = {
  locale: "en",
  scope: {
    expectedAccountId: "11111111-1111-4111-8111-111111111111",
    companyId: "22222222-2222-4222-8222-222222222222",
    branchId: "33333333-3333-4333-8333-333333333333",
    boundaryFingerprint: "boundary",
  },
  step: "hours",
  isCurrent: () => true,
  read: null,
};

describe("PaidSetupStepHost", () => {
  it('bounds stalled team loading and keeps a late unavailable result unconfirmed',async()=>{
    vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
    let finish!:(value:null)=>void;
    vi.mocked(readOwnedBranchTeamAction).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const host=document.createElement('div'),root=createRoot(host);
    try{
      await act(async()=>root.render(createElement(PaidSetupStepHost,{...baseProps,step:'team'})));
      await act(async()=>vi.advanceTimersByTimeAsync(15000));
      expect(host.textContent).toContain('Refresh invitations');
      await act(async()=>finish(null));
      expect(host.textContent).toContain('Refresh invitations');
    }finally{await act(async()=>root.unmount());vi.useRealTimers();vi.unstubAllGlobals();}
  });
  it('renders launch requirements while the initial read is pending',()=>{
    const html=renderToStaticMarkup(createElement(PaidSetupStepHost,{...baseProps,step:'launch'}));
    expect(html).toContain('Review and confirm launch');expect(html).toContain('<dl');
  });
  it('blocks stale launch consent throughout an unresolved status refresh',async()=>{
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
    const scope={expectedAccountId:baseProps.scope.expectedAccountId,companyId:baseProps.scope.companyId,branchId:baseProps.scope.branchId};
    const item={detail:'Verified',status:'verified' as const};
    const snapshot={scope,version:1,branchLabel:'Branch',setup:{companyId:scope.companyId,selectedBranchId:scope.branchId,sourceStatus:'ready' as const,selectedChannels:['whatsapp' as const],entitlement:{orderGroupId:'order',slotIndex:0,persona:'level_2' as const,package:'basic' as const,maxChannels:1 as const,employeesExcludingOwner:2 as const},launch:{canRequest:true,confirmationRequired:true as const,confirmed:false,blockedReasons:[]}},readiness:{status:'ready' as const,revision:'r1',blockers:[]},summary:{channels:[{channel:'whatsapp' as const,...item}],hours:item,knowledge:item,persona:item,team:{detail:'Optional',status:'skipped_optional' as const}},operationId:'44444444-4444-4444-8444-444444444444',activation:{status:'not_started' as const,receiptId:null,operationId:null}};
    let finish!:(value:typeof snapshot|null)=>void;
    vi.mocked(readOwnedBranchLaunchSummaryAction).mockResolvedValueOnce(snapshot).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const host=document.createElement('div'),root=createRoot(host);
    try{
      await act(async()=>root.render(createElement(PaidSetupStepHost,{...baseProps,step:'launch'})));
      await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
      expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
      await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Refresh operation status')!.click());
      expect(host.textContent).toContain('Loading the launch summary.');
      expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
      expect(confirmOwnedBranchLaunchAction).not.toHaveBeenCalled();
      await act(async()=>finish(snapshot));
      expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
  });
  it('loads authoritative team data, submits explicit scope and shows returned link',async()=>{
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
    const scope={expectedAccountId:baseProps.scope.expectedAccountId,companyId:baseProps.scope.companyId,branchId:baseProps.scope.branchId};
    const snapshot={scope,version:1,branchLabel:'Setup branch',seats:{limit:2 as const,available:1},allowedRoles:['staff' as const],canInvite:true,canSkip:false,skip:'not_skipped' as const,createOperationId:'44444444-4444-4444-8444-444444444444',skipOperationId:null,invitations:[]};
    vi.mocked(readOwnedBranchTeamAction).mockResolvedValue(snapshot);
    vi.mocked(inviteOwnedBranchTeamAction).mockResolvedValue({ok:true,data:{snapshot:{...snapshot,createOperationId:'55555555-5555-4555-8555-555555555555'},inviteUrl:'https://example.test/accept-invite?token=fixture',delivery:'link_only'}});
    const host=document.createElement('div'),root=createRoot(host);
    try{
      await act(async()=>root.render(createElement(PaidSetupStepHost,{...baseProps,step:'team'})));
      const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
      await act(async()=>{
        for(const [selector,value] of [['input[autocomplete="name"]','Test Staff'],['input[type="email"]','staff@example.test']]){
          const el=host.querySelector(selector)!;set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));
        }
        host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
      });
      await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
      expect(inviteOwnedBranchTeamAction).toHaveBeenCalledWith(expect.objectContaining({...scope,name:'Test Staff',email:'staff@example.test',capabilities:['wa.conversations.read']}));
      expect(host.querySelector<HTMLInputElement>('input[readonly]')?.value).toContain('token=fixture');
    }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
  });
  it("renders hours step view loading state in SSR", () => {
    const html = renderToStaticMarkup(createElement(PaidSetupStepHost, { ...baseProps, step: "hours" }));
    expect(html).toContain("Loading branch hours…");
  });

  it("renders knowledge step view loading state in SSR", () => {
    const html = renderToStaticMarkup(createElement(PaidSetupStepHost, { ...baseProps, step: "knowledge" }));
    expect(html).toContain("Loading branch knowledge…");
  });

  it("renders language step view loading state in SSR", () => {
    const html = renderToStaticMarkup(createElement(PaidSetupStepHost, { ...baseProps, step: "language" }));
    expect(html).toContain("Loading reply-language settings.");
  });

  it("renders test assistant step view loading state in SSR", () => {
    const html = renderToStaticMarkup(createElement(PaidSetupStepHost, { ...baseProps, step: "test" }));
    expect(html).toContain("Loading the assistant trial.");
  });

  it("renders team invitations step view loading state", () => {
    const html = renderToStaticMarkup(createElement(PaidSetupStepHost, { ...baseProps, step: "team" }));
    expect(html).toContain("Loading the branch team.");
  });

  it("renders launch step view loading state in SSR", () => {
    const html = renderToStaticMarkup(createElement(PaidSetupStepHost, { ...baseProps, step: "launch" }));
    expect(html).toContain("Loading the launch summary.");
  });
});
