import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {expect, it} from "vitest";
import {PaidChannelView, type PaidChannelViewProps} from "./paid-channel-view";
import {projectTrustedBoundSelection} from "@/lib/tenancy/paid-setup-contracts";
import type {PaidBranchConnectionRead} from "@/lib/tenancy/paid-branch-connection-contracts";

const read = projectTrustedBoundSelection({companyId:"company",branchId:"branch",branchLabel:"Main branch",orderGroupId:"order",slotIndex:0,persona:"level_2",package:"basic",term:"monthly",maxChannels:1,employeesExcludingOwner:2,clockState:"waiting_readiness",asOf:"2026-10-20T00:00:00Z"},{channels:["whatsapp"]});
const props: PaidChannelViewProps = {locale:"en",scope:{expectedAccountId:"actor",companyId:"company",branchId:"branch",boundaryFingerprint:"capture"},read,channel:"whatsapp"};
const render = (overrides: Partial<PaidChannelViewProps> = {}) => renderToStaticMarkup(createElement(PaidChannelView,{...props,...overrides}));

it("requires an explicit route and never starts a provider on render",()=>{
  const html=render();
  expect(html).toContain("Main branch");
  expect(html.match(/type="radio"/g)).toHaveLength(2);
  expect(html).not.toContain("checked=");
  expect(html).not.toContain("data-guide-source");
  expect(html).not.toContain("<script");
  expect(html).toContain("separate migration assessment");
});
it.each([
  {read:null},
  {channel:"instagram" as const},
  {scope:{...props.scope,companyId:"foreign"}},
  {scope:{...props.scope,branchId:"foreign"}},
  {scope:{...props.scope,expectedAccountId:""}},
  {read:{...read,sourceStatus:"unavailable" as const}},
  {read:{...read,sourceStatus:"selection_required" as const}},
  {read:{...read,entitlement:null}},
  {read:{...read,branches:[]}},
  {read:{...read,steps:read.steps.map(step=>step.id==="connect_whatsapp"?{...step,status:"blocked" as const}:step)}},
])("does not expose channel controls for invalid scope or unavailable entitlement %#",overrides=>{
  const html=render(overrides);
  expect(html).toContain("This channel is unavailable");
  expect(html).not.toContain('type="radio"');
  expect(html).not.toContain("data-connect-action");
});
it("uses only the entitled Instagram channel with no invented route or enabled authorization",()=>{
  const ig={...read,selectedChannels:["instagram" as const],steps:read.steps.map(step=>({...step,id:step.id==="connect_whatsapp"?"connect_instagram" as const:step.id,dependencyIds:step.dependencyIds.map(id=>id==="connect_whatsapp"?"connect_instagram" as const:id)}))};
  const html=render({read:ig,channel:"instagram"});
  expect(html).toContain("Instagram professional account");
  expect(html).toContain('disabled=""');
  expect(html).not.toContain("Facebook");
  expect(html).not.toContain("WhatsApp");
});
it("enables Instagram authorization only when scoped B3 connectionRead grants canStart",()=>{
  const ig={...read,selectedChannels:["instagram" as const],steps:read.steps.map(step=>({...step,id:step.id==="connect_whatsapp"?"connect_instagram" as const:step.id,dependencyIds:step.dependencyIds.map(id=>id==="connect_whatsapp"?"connect_instagram" as const:id)}))};
  const connectionRead: PaidBranchConnectionRead = {
    schemaVersion: 1,
    sourceStatus: "ready",
    expectedAccountId: "actor",
    companyId: "company",
    branchId: "branch",
    channel: "instagram",
    asOf: "2026-10-20T00:00:00Z",
    revision: "1",
    connection: { state: "not_connected", flow: null, attempt: null, link: null, verified: false, reasonCodes: [] },
    capabilities: { canStart: true, canRecover: false, canCancel: false, allowedFlows: ["instagram_direct"] },
  };
  const html=render({read:ig,channel:"instagram",connectionRead});
  expect(html).toContain('data-connection-ui-state="not_connected"');
  expect(html).toContain('data-connect-action="true"');
  expect(html).not.toContain('data-connect-action="true" disabled=""');
});
it("surfaces recovery and cancel controls for recoverable or pending B3 states",()=>{
  const recoverableRead: PaidBranchConnectionRead = {
    schemaVersion: 1,
    sourceStatus: "ready",
    expectedAccountId: "actor",
    companyId: "company",
    branchId: "branch",
    channel: "whatsapp",
    asOf: "2026-10-20T00:00:00Z",
    revision: "2",
    connection: {
      state: "reconciliation_required",
      flow: "wa_new_number",
      attempt: { id: "attempt-1", generation: 1, expiresAt: "2026-10-20T01:00:00Z", status: "unknown" },
      link: null,
      verified: false,
      reasonCodes: ["reconciliation_required"],
    },
    capabilities: { canStart: false, canRecover: true, canCancel: false, allowedFlows: [] },
  };
  const html=render({locale:"ar",connectionRead:recoverableRead});
  expect(html).toContain('data-connection-ui-state="recoverable_failure"');
  expect(html).toContain("فشل قابل للاسترداد");
  expect(html).toContain('data-recover-action="true"');

  const pendingRead: PaidBranchConnectionRead = {
    ...recoverableRead,
    connection: {
      state: "pending",
      flow: "wa_coexistence",
      attempt: { id: "attempt-2", generation: 1, expiresAt: "2026-10-20T01:00:00Z", status: "pending" },
      link: null,
      verified: false,
      reasonCodes: [],
    },
    capabilities: { canStart: false, canRecover: false, canCancel: true, allowedFlows: [] },
  };
  const pendingHtml=render({locale:"ar",connectionRead:pendingRead});
  expect(pendingHtml).toContain('data-connection-ui-state="authorizing"');
  expect(pendingHtml).toContain("جاري التفويض");
  expect(pendingHtml).toContain('data-cancel-action="true"');
});
it("resets guide state on actor, branch, capture, channel and entitlement changes, preserving locale",()=>{
  const key=PaidChannelView(props).key;
  expect(PaidChannelView({...props,locale:"ar"}).key).toBe(key);
  for(const field of ["expectedAccountId","companyId","branchId","boundaryFingerprint"] as const)
    expect(PaidChannelView({...props,scope:{...props.scope,[field]:"changed"}}).key).not.toBe(key);
  expect(PaidChannelView({...props,channel:"instagram"}).key).not.toBe(key);
  expect(PaidChannelView({...props,read:{...read,selectedChannels:null}}).key).not.toBe(key);
});
