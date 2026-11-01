// @vitest-environment jsdom
import {act,createElement} from "react";import {renderToStaticMarkup} from "react-dom/server";import {expect,it,vi} from "vitest";
import {PaidTeamInvitations,knownTeamSeats,validTeamRecipient,teamViewKey,type PaidTeamInvitationsProps} from "./paid-team-invitations";
const scope={expectedAccountId:"actor",companyId:"company",branchId:"branch"},op="11111111-1111-4111-8111-111111111111";
const props:PaidTeamInvitationsProps={locale:"en",scope,boundaryFingerprint:"capture",snapshot:{scope,version:1,branchLabel:"Branch",seats:{limit:2,available:2},allowedRoles:["staff"],canInvite:true,canSkip:true,skip:"not_skipped",createOperationId:op,skipOperationId:"22222222-2222-4222-8222-222222222222",invitations:[]},state:{scope,version:1,phase:"ready",operationId:null,operation:null,canRetry:null,retrySafe:null},isCurrent:()=>true,onInvite:()=>{throw Error("No render mutations");},onSkip:()=>{throw Error("No render skips");}};
const render=(patch:Partial<PaidTeamInvitationsProps>={})=>renderToStaticMarkup(createElement(PaidTeamInvitations,{...props,...patch}));
it.each(["ar","en"] as const)("renders %s with staff-only role and blank disabled submit",locale=>{const h=render({locale});expect(h).toContain('value="staff"');expect(h).not.toContain('value="owner"');expect(h).toContain('type="submit" disabled=""');});
it.each([{limit:null,available:1},{limit:2,available:null},{limit:2,available:3},{limit:4,available:-1},{limit:3,available:1}])("unknown/invalid capacity %j blocks creation",seats=>{expect(knownTeamSeats(seats as never)).toBe(false);expect(render({snapshot:{...props.snapshot!,seats:seats as never}})).toContain("Seat availability could not be verified");});
it.each([2,4] as const)("uses authoritative %s capacity excluding owner",limit=>{expect(render({snapshot:{...props.snapshot!,seats:{limit,available:1}}})).toContain(`1 / ${limit}`);expect(render()).toContain("owner is excluded");});
it("full seats block invitations without blocking authorized optional skip",()=>{const h=render({snapshot:{...props.snapshot!,seats:{limit:2,available:0}}});expect(h).toContain("No staff seats");expect(h).toContain('type="button">Skip for now');});
it.each([["A","a@b.com"],["Name","bad"],["Name","a@b"],["N".repeat(121),"a@b.com"]])("rejects invalid existing-contract recipient %s/%s",(name,email)=>expect(validTeamRecipient(name,email)).toBe(false));
it("accepts trimmed valid recipient",()=>expect(validTeamRecipient(" Staff ","USER@example.com ")).toBe(true));
it("authoritative request phase changes release the local pending latch for host recovery",()=>expect(teamViewKey({...props,state:{...props.state,phase:"error"}})).not.toBe(teamViewKey(props)));
it.each(["loading","pending","unknown","unavailable","error"] as const)("blocks mutations during %s",phase=>{const h=render({state:{...props.state,phase}});if(phase==="loading"){expect(h).toContain('aria-busy="true"');expect(h).not.toContain("Loading the branch team");}else if(phase==="unavailable"){expect(h).toContain('role="status"');}else{expect(h).toContain('disabled=""');}});
it("requires safe same-operation retry and never infers permission",()=>{const state={...props.state,phase:"error" as const,operationId:op,operation:"invite" as const,canRetry:true,retrySafe:false};expect(render({state,onRetry:()=>{}})).toContain('disabled="">Retry the same operation');expect(render({state:{...state,retrySafe:true},onRetry:()=>{}})).toContain('type="button">Retry the same operation');});
it("does not show skip confirmation chatter and does not claim email sent",()=>{expect(render()).not.toContain("server confirmed that");expect(render({snapshot:{...props.snapshot!,skip:"skipped"}})).not.toContain("server confirmed that");expect(render()).not.toContain("does not mean an email was sent");expect(render({inviteUrl:"https://example.test/accept-invite?token=local"})).toContain("no email sent");});
it("requires authorized staff role and operation IDs",()=>{for(const extra of [{allowedRoles:[]},{createOperationId:"invalid"},{canInvite:false}])expect(render({snapshot:{...props.snapshot!,...extra}})).toContain('autoComplete="name" maxLength="120" disabled=""');});
it("hides foreign branch invitations and stale account snapshots",()=>{expect(render({snapshot:{...props.snapshot!,invitations:[{scope:{...scope,branchId:"other"},invitation:{id:"x",name:"PRIVATE",email:"private@example.com",status:"invited",expiresAt:"2099-01-01",revision:1}}]}})).not.toContain("PRIVATE");expect(render({state:{...props.state,scope:{...scope,expectedAccountId:"other"}}})).toContain("team data is unavailable");});
it("resets across scope/revision/capture and authoritative operation replacement",()=>{const key=teamViewKey(props);for(const field of ["expectedAccountId","companyId","branchId"] as const)expect(teamViewKey({...props,scope:{...scope,[field]:"new"}})).not.toBe(key);expect(teamViewKey({...props,snapshot:{...props.snapshot!,version:2}})).not.toBe(key);expect(teamViewKey({...props,boundaryFingerprint:"new"})).not.toBe(key);expect(teamViewKey({...props,snapshot:{...props.snapshot!,createOperationId:"new"}})).not.toBe(key);expect(teamViewKey({...props,locale:"ar"})).toBe(key);});

it("requires explicit permission selection and shows activation/link-only delivery boundary",()=>{const h=render({inviteUrl:"https://example.test/accept-invite?token=local"});expect(h).toContain("Permissions for this branch only");expect(h).not.toContain('checked=""');expect(h).not.toContain("requires a valid channel connection");expect(h).toContain("no email sent");});

it("explicitly regenerates a pending recipient at full seats without sending or mutating on selection",async()=>{
 const {createRoot}=await import("react-dom/client");vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 const host=document.createElement("div"),root=createRoot(host),invite=vi.fn();document.body.append(host);
 const invitation={id:op,name:"Existing Staff",email:"staff@example.test",status:"invited" as const,expiresAt:"2099-01-01",revision:1};
 try{
  await act(async()=>root.render(createElement(PaidTeamInvitations,{...props,onInvite:invite,snapshot:{...props.snapshot!,canInvite:false,canReplace:true,seats:{limit:2,available:0},invitations:[{scope,invitation}]}})));
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-regenerate-invitation]')!.click());
  expect(invite).not.toHaveBeenCalled();expect(host.querySelector<HTMLInputElement>('input[type="email"]')!.readOnly).toBe(true);
  expect(host.textContent).toContain("old link is invalidated");
  await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(invite).toHaveBeenCalledExactlyOnceWith({...scope,expectedVersion:1,operationId:op,name:invitation.name,email:invitation.email,role:'staff',capabilities:['wa.conversations.read']});
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
it("requires server replacement permission even at full seats",()=>{
 const invitation={id:op,name:"Staff",email:"staff@example.test",status:"invited" as const,expiresAt:"2099-01-01",revision:1};
 expect(render({snapshot:{...props.snapshot!,canInvite:false,canReplace:false,seats:{limit:2,available:0},invitations:[{scope,invitation}]}})).toContain('disabled="">New link');
});

it.each(['ar','en'] as const)('does not announce failed seats during initial %s loading',locale=>{
 const h=render({locale,snapshot:null,state:{...props.state,phase:'loading',version:null}});
 expect(h).toContain('aria-busy="true"');
 expect(h).not.toContain('Seat availability could not be verified');expect(h).not.toContain('تعذّر التحقق من المقاعد');
 expect(h).toContain('disabled=""');
});
it('omits skip when the authoritative route does not support it',()=>{
 const h=render({snapshot:{...props.snapshot!,canSkip:false,skipOperationId:null},onSkip:undefined});
 expect(h).not.toContain('Skip for now');
 expect(h).not.toContain('You can continue setup');
 expect(h).not.toContain('Optional');
});
it.each(['ar','en'] as const)('uses customer language for %s staff roles',locale=>{
 const h=render({locale});expect(h).not.toContain('invitation contract');expect(h).not.toContain('عقد الدعوات');
 expect(h).not.toContain('يتحقق الخادم');expect(h).toContain(locale==='ar'?'صلاحيات هذا الفرع فقط':'Permissions for this branch only');
});
