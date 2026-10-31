import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {expect,it} from "vitest";
import {projectTrustedBoundSelection} from "@/lib/tenancy/paid-setup-contracts";
import {PaidSetupWorkspace,workspaceStepAllowed,nextWorkspaceSelection,stepBlockedReason,type PaidSetupWorkspaceProps} from "./paid-setup-workspace";
import {unavailablePaidBranchConnectionRead} from "@/lib/tenancy/paid-branch-connection-contracts";
const scope={expectedAccountId:"actor",companyId:"company",branchId:"branch",boundaryFingerprint:"capture"};
const read=projectTrustedBoundSelection({companyId:"company",branchId:"branch",branchLabel:"Main branch",orderGroupId:"order",slotIndex:0,persona:"level_2",package:"basic",term:"monthly",maxChannels:1,employeesExcludingOwner:2,clockState:"waiting_readiness",asOf:"now"},{channels:["whatsapp"]});
const props:PaidSetupWorkspaceProps={locale:"en",scope,read,activeStepId:"whatsapp",availableStepIds:["whatsapp","instagram","hours","knowledge","test","team","launch"],isCurrent:()=>true,onSelectStep:()=>{throw Error("No selection during render");}};
const render=(overrides:Partial<PaidSetupWorkspaceProps>={})=>renderToStaticMarkup(createElement(PaidSetupWorkspace,{...props,...overrides}));
it('keeps the presentation frame during loading without inventing a plan, progress or usable steps',()=>{const html=render({read:null,loading:true});expect(html).toContain('data-setup-frame="pending"');expect(html).toContain('Setup journey');expect(html).toContain('Stage content');expect(html).toContain('Loading branch setup');expect(html).not.toContain('Branch setup</h2>');expect(html).not.toContain('Saved settings appear after branch access is verified');expect(html).not.toContain('<progress');expect(html).not.toContain('data-step-id');expect(html).not.toContain('Plan and activation summary');expect(html).not.toContain('type="radio"');});
it('keeps the same frame with a retry on unavailable setup instead of hiding the UI',()=>{const html=render({read:null,onRefresh:()=>{}});expect(html).toContain('data-setup-frame="pending"');expect(html).toContain('role="alert"');expect(html).toContain('Retry');expect(html).not.toContain('<progress');expect(html).not.toContain('data-step-id');});
it("renders six visible setup steps including required hours and actual progress with no guide auto-selection",()=>{
 const html=render();expect(html.match(/data-step-id=/g)).toHaveLength(6);expect(html).not.toContain('data-step-id="instagram"');expect(html).toContain('data-step-id="hours"');expect(html).not.toContain('data-step-id="language"');expect(html).toContain('data-step-id="team"');expect(html).toContain('aria-current="step"');expect(html).not.toContain("data-guide-source");
 expect(html).toContain('<bdi dir="ltr">0 / 6</bdi>');expect(html).not.toContain('href="/setup/branches/');
});
it("renders seven visible steps for a paid two-channel read including required hours",()=>{
 const both=projectTrustedBoundSelection({companyId:"company",branchId:"branch",branchLabel:"Main",orderGroupId:"order",slotIndex:0,persona:"level_2",package:"premium",term:"monthly",maxChannels:2,employeesExcludingOwner:4,clockState:"waiting_readiness",asOf:"now"},{channels:["whatsapp","instagram"]});
 expect(render({read:both}).match(/data-step-id=/g)).toHaveLength(7);
 expect(render({read:both})).toContain('data-step-id="hours"');
});
it("IG-only never renders WA",()=>{
 const ig=projectTrustedBoundSelection({companyId:"company",branchId:"branch",branchLabel:"Main",orderGroupId:"order",slotIndex:0,persona:"level_2",package:"basic",term:"monthly",maxChannels:1,employeesExcludingOwner:2,clockState:"waiting_readiness",asOf:"now"},{channels:["instagram"]});
 expect(render({read:ig,activeStepId:"instagram"})).not.toContain('data-step-id="whatsapp"');
});
it.each(["foreign","unpaid","unavailable","stale","empty"] as const)("fails closed for %s",kind=>{
 const html=render(kind==="foreign"?{scope:{...scope,branchId:"foreign"}}:kind==="unpaid"?{read:{...read,entitlement:null}}:kind==="unavailable"?{read:{...read,sourceStatus:"unavailable"}}:kind==="stale"?{isCurrent:()=>false}:{read:null});
 expect(html).not.toContain("data-step-id");expect(html).not.toContain('type="radio"');
});
it("keeps a locked step mounted with an explicit block reason instead of silent navigation",()=>{
 expect(workspaceStepAllowed(read,scope,"hours",props.availableStepIds)).toBe(true);
 expect(workspaceStepAllowed(read,scope,"knowledge",props.availableStepIds)).toBe(true);
 expect(workspaceStepAllowed(read,scope,"test",props.availableStepIds)).toBe(false);
 expect(workspaceStepAllowed(read,scope,"team",props.availableStepIds)).toBe(true);
 expect(workspaceStepAllowed(read,scope,"launch",props.availableStepIds)).toBe(true);
 expect(workspaceStepAllowed(read,{...scope,branchId:"foreign"},"launch",props.availableStepIds)).toBe(false);
 expect(read.launch.canRequest).toBe(false);
 const locked=render({activeStepId:"test",renderStep:()=>createElement("p",null,"Trial draft preserved")});
 expect(locked).toContain('data-setup-step-blocked="true"');
 expect(locked).toContain("Waiting for: Knowledge &amp; languages");
 expect(locked).toContain("Trial draft preserved");
 expect(locked).not.toContain("Choose an available step");
 expect(render({availableStepIds:[]})).not.toContain('type="radio"');
 expect(render()).toContain('data-step-id="hours"');
});
it("allows launch review without changing negative server launch authority",()=>{
 const complete={...read,steps:read.steps.map(s=>({...s,status:"verified" as const}))};
 expect(workspaceStepAllowed(complete,scope,"launch",props.availableStepIds)).toBe(true);expect(complete.launch.canRequest).toBe(false);
});
it("only mounts a released leaf after authoritative dependencies become ready",()=>{
 const updated={...read,steps:read.steps.map(s=>s.id==="hours"?{...s,status:"verified" as const}:s.id==="knowledge"?{...s,status:"pending" as const,actionId:"save_knowledge"}:s),progress:{...read.progress,verified:1}};
 expect(render({read:updated,activeStepId:"knowledge",renderStep:id=>createElement("p",null,"Existing leaf: "+id)})).toContain("Existing leaf: knowledge");
 expect(read.progress.verified).toBe(0);
});
it("uses RTL and a collapsed accessible mobile step control",()=>{
 const html=render({locale:"ar"});expect(html).toContain('dir="rtl"');expect(html).toContain('aria-expanded="false"');expect(html).toContain('tabindex="-1"');
});
it("advances within the page only after server-confirmed channel and matching proof, and resumes incomplete business steps when WhatsApp is pending",()=>{
 const proof={...unavailablePaidBranchConnectionRead({...scope,channel:"whatsapp"},"now","source_failed"),sourceStatus:"ready" as const,connection:{state:"connected" as const,verified:true,link:{id:"link",generation:2},attempt:null,flow:"wa_new_number" as const,reasonCodes:[]}};
 const snapshot={scope,read:{...read,steps:read.steps.map(s=>s.id==="connect_whatsapp"?{...s,status:"verified" as const,reasonCodes:[]}:s),progress:{...read.progress,verified:1}},connectionReads:{whatsapp:proof},confirmedChannels:["whatsapp" as const]};
 expect(nextWorkspaceSelection(snapshot,"whatsapp")).toBe("hours");
 expect(nextWorkspaceSelection({...snapshot,confirmedChannels:[]},"whatsapp")).toBe("whatsapp");
 expect(nextWorkspaceSelection({...snapshot,connectionReads:{whatsapp:{...proof,expectedAccountId:"old"}}},"whatsapp")).toBe("whatsapp");
 expect(nextWorkspaceSelection(snapshot,"hours")).toBe("hours");
 expect(nextWorkspaceSelection({scope,read,connectionReads:{},confirmedChannels:[]},"team")).toBe("team");
 expect(nextWorkspaceSelection({scope,read,connectionReads:{},confirmedChannels:[]},"launch")).toBe("launch");
 const hoursSaved={scope,read:{...read,steps:read.steps.map(s=>s.id==="hours"?{...s,status:"verified" as const,reasonCodes:[]}:s.id==="knowledge"?{...s,status:"pending" as const,reasonCodes:["setup_incomplete"]}:s),progress:{...read.progress,verified:1}},connectionReads:{},confirmedChannels:[]};
 expect(nextWorkspaceSelection(hoursSaved,"hours")).toBe("knowledge");
 expect(nextWorkspaceSelection(hoursSaved,null)).toBe("knowledge");
 const knowledgeSaved={scope,read:{...read,steps:read.steps.map(s=>s.id==="hours"?{...s,status:"verified" as const,reasonCodes:[]}:s.id==="knowledge"?{...s,status:"verified" as const,reasonCodes:[]}:s.id==="assistant_test"?{...s,status:"pending" as const,reasonCodes:["setup_incomplete"]}:s),progress:{...read.progress,verified:2}},connectionReads:{},confirmedChannels:[]};
 expect(nextWorkspaceSelection(knowledgeSaved,"knowledge")).toBe("test");
 expect(nextWorkspaceSelection(knowledgeSaved,"hours")).toBe("test");
 expect(nextWorkspaceSelection({scope,read,connectionReads:{},confirmedChannels:[]},"test",true)).toBe("test");
 // Stuck sessionStorage "test" while assistant_test is still unavailable (shell / uncomposed readiness).
 expect(nextWorkspaceSelection({scope,read,connectionReads:{},confirmedChannels:[]},"test")).toBe("hours");
 const blockedTrial={scope,read:{...read,steps:read.steps.map(s=>s.id==="hours"?{...s,status:"verified" as const,reasonCodes:[]}:s.id==="knowledge"?{...s,status:"pending" as const,reasonCodes:["setup_incomplete"]}:s.id==="assistant_test"?{...s,status:"blocked" as const,reasonCodes:["awaiting_required_steps"]}:s),progress:{...read.progress,verified:1}},connectionReads:{},confirmedChannels:[]};
 expect(nextWorkspaceSelection(blockedTrial,"test")).toBe("knowledge");
});
it("stepBlockedReason reports accurate blocked dependencies and launch requirements",()=>{
 const model={schemaVersion:1 as const,sourceStatus:"ready" as const,companyId:"company",selectedBranchId:"branch",branches:[{id:"branch",label:"Main"}],entitlement:{slotIndex:0,persona:"level_1",package:"basic",maxChannels:1,employeesExcludingOwner:2},selectedChannels:["whatsapp" as const],steps:[{id:"whatsapp" as const,required:true,dependencyIds:[],status:"pending" as const,reasonCodes:[],actionId:"connect"},{id:"hours" as const,required:true,dependencyIds:[],status:"pending" as const,reasonCodes:[],actionId:"hours"},{id:"knowledge" as const,required:true,dependencyIds:["hours" as const],status:"blocked" as const,reasonCodes:[],actionId:"knowledge"},{id:"launch" as const,required:true,dependencyIds:["whatsapp" as const,"hours" as const],status:"blocked" as const,reasonCodes:[],actionId:"launch"}],progress:{denominator:4,verified:0,skippedOptional:0},launch:{confirmationRequired:true as const,confirmed:false,canRequest:false,blockedReasons:["channel_unverified:whatsapp"]},asOf:"now"};
 expect(stepBlockedReason("knowledge",model.steps,model,"ar")).toBe("بانتظار: مواعيد العمل");
 expect(stepBlockedReason("knowledge",model.steps,model,"en")).toBe("Waiting for: Business hours");
 expect(stepBlockedReason("launch",model.steps,model,"ar")).toBe("بانتظار التحقق من ربط واتساب");
 expect(stepBlockedReason("launch",model.steps,model,"en")).toBe("Awaiting WhatsApp connection verification");
});


it('does not present provisional shell progress as verified',()=>{const html=render({provisional:true});expect(html).toContain('Checking setup progress');expect(html).not.toContain('0 / 6');});
