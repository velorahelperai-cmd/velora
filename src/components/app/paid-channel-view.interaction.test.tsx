// @vitest-environment jsdom
import {act,createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {PaidChannelView,type PaidChannelViewProps} from "./paid-channel-view";
import {projectTrustedBoundSelection} from "@/lib/tenancy/paid-setup-contracts";
import type {PaidBranchConnectionRead} from '@/lib/tenancy/paid-branch-connection-contracts';
const read=projectTrustedBoundSelection({companyId:"company",branchId:"branch",branchLabel:"TAG CITY",orderGroupId:"order",slotIndex:0,persona:"level_1",package:"basic",term:"monthly",maxChannels:1,employeesExcludingOwner:2,clockState:"waiting_readiness",asOf:"2026-10-26T00:00:00Z"},{channels:["whatsapp"]});
const start=vi.fn();
const props:PaidChannelViewProps={locale:"en",scope:{expectedAccountId:"actor",companyId:"company",branchId:"branch",boundaryFingerprint:"capture"},read,channel:"whatsapp",isCurrent:()=>true,actions:{startConnection:start}};
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);start.mockReset();host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function render(extra:Partial<PaidChannelViewProps>={}){await act(async()=>root.render(createElement(PaidChannelView,{...props,...extra})));}
async function click(selector:string){await act(async()=>host.querySelector<HTMLElement>(selector)!.click());}
const connection:PaidBranchConnectionRead={schemaVersion:1,sourceStatus:'ready',expectedAccountId:'actor',companyId:'company',branchId:'branch',channel:'whatsapp',asOf:'now',revision:'1',connection:{state:'not_connected',flow:null,attempt:null,link:null,verified:false,reasonCodes:[]},capabilities:{canStart:true,canRecover:false,canCancel:false,allowedFlows:['wa_new_number','wa_coexistence']}};
it('rejects real Facebook login on HTTP before starting a server attempt',async()=>{
 const actions=ports();const {launchWhatsappSdk: _launcher,...realLauncherActions}=actions;
 await render({connectionRead:connection,actions:realLauncherActions});
 await click('input[value="new-number"]');
 await click('[data-route-continue]');
 await click('[data-connect-action]');
 expect(host.textContent).toContain('Facebook connection requires an HTTPS page');
 expect(actions.startConnection).not.toHaveBeenCalled();
});
it.each(['success','denied','offline'] as const)('settles cancellation %s without refreshing away feedback or opening Facebook',async(outcome)=>{
 const actions=ports();const pending=(await actions.startConnection()).read;
 const expired={...pending,asOf:'2100-01-01T00:00:00Z'};
 actions.startConnection.mockClear();const refresh=vi.fn();
 const cancelConnection=vi.fn(async()=>{
  if(outcome==='offline')throw Error('offline');
  return outcome==='success'?{ok:true as const,read:connection}:{ok:false as const,code:'reconciliation_required' as const,read:expired};
 });
 await render({connectionRead:expired,actions:{...actions,cancelConnection},onRefresh:refresh});
 await click('[data-cancel-action]');
 expect(host.textContent).not.toContain('Cancelling…');
 expect(host.querySelector('[data-recover-action]')).toBeNull();
 if(outcome==='success'){
  expect(host.textContent).toContain('Attempt cancelled.');
  expect(host.textContent).not.toContain('This connection attempt has expired.');
  expect(host.querySelector('input[type="radio"]')).not.toBeNull();
 }else{
  expect(host.textContent).toContain(outcome==='offline'?'Cancellation is unconfirmed':'Cancellation was not confirmed');
  expect(host.querySelector(outcome==='offline'?'[data-check-cancellation]':'[data-cancel-action]')).not.toBeNull();
 }
 expect(refresh).not.toHaveBeenCalled();expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();expect(actions.startConnection).not.toHaveBeenCalled();
});
it('checks the same server attempt after an uncertain cancellation without sending a second cancellation',async()=>{
 const actions=ports();const pending=(await actions.startConnection()).read;actions.startConnection.mockClear();
 const cancelConnection=vi.fn(async()=>{throw Error('offline');});
 const cancelled={...pending,connection:{...pending.connection,state:'not_connected' as const,attempt:{...pending.connection.attempt!,status:'cancelled' as const}},capabilities:{...connection.capabilities}};
 const readConnection=vi.fn(async()=>cancelled);
 await render({connectionRead:pending,actions:{...actions,cancelConnection,readConnection}});
 await click('[data-cancel-action]');expect(host.querySelector('[data-cancel-action]')).toBeNull();
 await click('[data-check-cancellation]');
 expect(readConnection).toHaveBeenCalledTimes(1);expect(cancelConnection).toHaveBeenCalledTimes(1);
 expect(host.textContent).toContain('Attempt cancelled.');expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();
});
it('leaves the loading state on timeout without repeating cancellation or opening Facebook',async()=>{
 const actions=ports();const pending=(await actions.startConnection()).read;actions.startConnection.mockClear();
 const cancelConnection=vi.fn(()=>new Promise<never>(()=>{}));
 await render({connectionRead:pending,actions:{...actions,cancelConnection}});
 vi.useFakeTimers();
 try{
  await click('[data-cancel-action]');
  await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
  expect(host.textContent).toContain('Cancellation is unconfirmed');
  expect(host.querySelector('[data-check-cancellation]')).not.toBeNull();
  expect(host.querySelector('[data-cancel-action]')).toBeNull();
  expect(cancelConnection).toHaveBeenCalledTimes(1);expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});
function ports(required=false){const pending={...connection,revision:'2',connection:{...connection.connection,state:'pending' as const,flow:'wa_new_number' as const,attempt:{id:'attempt',generation:1,expiresAt:'2099-01-01T00:00:00Z',status:'pending' as const}},capabilities:{...connection.capabilities,canStart:false,allowedFlows:[],canCancel:true}};return {startConnection:vi.fn(async()=>({ok:true as const,read:pending,launch:{flow:'wa_new_number' as const,attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0'}})),launchWhatsappSdk:vi.fn(async()=>({kind:'completed' as const,code:'one-use-code',wabaId:'222',phoneNumberId:'333'})),prepareRegistration:vi.fn(async()=>({ok:true as const,registrationRequired:required,authorizationTicket:'encrypted-ticket'})),completeConnection:vi.fn(async()=>({ok:false as const,code:'reconciliation_required' as const,read:{...pending,connection:{...pending.connection,state:'reconciliation_required' as const}}})),cancelConnection:vi.fn(async()=>({ok:true as const,read:connection}))};}
async function facebook(){await click('input[value="new-number"]');await click('[data-route-continue]');await click('[data-connect-action]');}
it('starts Facebook without a PIN and skips the field for a server-confirmed registered number',async()=>{const actions=ports();await render({connectionRead:connection,actions});await facebook();expect(actions.launchWhatsappSdk).toHaveBeenCalledTimes(1);expect(actions.prepareRegistration).toHaveBeenCalledTimes(1);expect(actions.completeConnection).toHaveBeenCalledWith(expect.objectContaining({completion:expect.objectContaining({pin:'',authorizationTicket:'encrypted-ticket'})}));expect(host.querySelector('input[type="password"]')).toBeNull();expect(host.textContent).not.toContain('Connected successfully');});
it('asks for a PIN only after the server proves registration is needed, then cancels the same attempt',async()=>{const actions=ports(true);await render({connectionRead:connection,actions});await facebook();expect(actions.prepareRegistration).toHaveBeenCalledTimes(1);expect(actions.completeConnection).not.toHaveBeenCalled();const input=host.querySelector<HTMLInputElement>('input[type="password"]')!;expect(input).not.toBeNull();expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toContain('not the SMS');const cancel=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Cancel attempt')!;await act(async()=>cancel.click());expect(actions.cancelConnection).toHaveBeenCalledWith(expect.objectContaining({attemptId:'attempt',generation:1}));expect(actions.completeConnection).not.toHaveBeenCalled();});
it('finishes the same attempt after a required PIN without starting Facebook again',async()=>{const actions=ports(true);await render({connectionRead:connection,actions});await facebook();const input=host.querySelector<HTMLInputElement>('input[type="password"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'123456');input.dispatchEvent(new Event('input',{bubbles:true}));});await act(async()=>host.querySelector('form[data-registration-pin]')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(actions.completeConnection).toHaveBeenCalledWith(expect.objectContaining({attemptId:'attempt',completion:expect.objectContaining({pin:'123456'})}));expect(actions.startConnection).toHaveBeenCalledTimes(1);expect(host.querySelector('input[type="password"]')).toBeNull();});
it('does not ask for a PIN or complete when provider preparation is unavailable',async()=>{const actions=ports();actions.prepareRegistration.mockRejectedValue(new Error('offline'));await render({connectionRead:connection,actions});await facebook();expect(host.querySelector('input[type="password"]')).toBeNull();expect(actions.completeConnection).not.toHaveBeenCalled();expect(actions.startConnection).toHaveBeenCalledTimes(1);});
it('cancels a closed Meta popup without asking for PIN or completing',async()=>{const actions=ports();actions.launchWhatsappSdk.mockResolvedValue({kind:'cancelled'} as never);await render({connectionRead:connection,actions});await facebook();expect(actions.cancelConnection).toHaveBeenCalledTimes(1);expect(actions.prepareRegistration).not.toHaveBeenCalled();expect(actions.completeConnection).not.toHaveBeenCalled();});
it('deduplicates simultaneous Facebook clicks',async()=>{const actions=ports();let finish:((value:never)=>void)|undefined;actions.launchWhatsappSdk.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await render({connectionRead:connection,actions});await click('input[value="new-number"]');await click('[data-route-continue]');const button=host.querySelector<HTMLButtonElement>('[data-connect-action]')!;await act(async()=>{button.click();button.click();});expect(actions.startConnection).toHaveBeenCalledTimes(1);await act(async()=>finish?.({kind:'cancelled'} as never));});
it('resumes a server-saved attempt after remount without another Facebook popup or start',async()=>{const actions=ports();const pending=(await actions.startConnection()).read;actions.startConnection.mockClear();const saved={...pending,capabilities:{...pending.capabilities,canRecover:true}};const recoverConnection=vi.fn(async()=>({ok:true as const,read:saved,continuation:{registrationRequired:false,authorizationTicket:'refreshed-ticket',nonce:'nonce',wabaId:'222',phoneNumberId:'333'}}));await render({connectionRead:saved,actions:{...actions,recoverConnection}});await click('[data-recover-action]');expect(recoverConnection).toHaveBeenCalledWith(expect.objectContaining({attemptId:'attempt',generation:1}));expect(actions.completeConnection).toHaveBeenCalledWith(expect.objectContaining({completion:expect.objectContaining({authorizationTicket:'refreshed-ticket',code:'durable-checkpoint',pin:''})}));expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();expect(actions.startConnection).not.toHaveBeenCalled();expect(host.textContent).not.toContain('Connected successfully');});
it("shows Facebook and its illustrated instructions without collecting a PIN first",async()=>{await render();const next=host.querySelector<HTMLButtonElement>('[data-route-continue]')!;expect(next.disabled).toBe(true);await click('input[value="new-number"]');await click('[data-route-continue]');expect(host.querySelector('[data-wa-screen="requirements"]')).not.toBeNull();expect(host.querySelector('[data-guide-source]')).not.toBeNull();expect(host.querySelector('input[type="password"]')).toBeNull();expect(host.querySelector<HTMLButtonElement>('[data-connect-action]')!.disabled).toBe(true);expect(start).not.toHaveBeenCalled();});
it("shows coexistence requirements without a separate illustrated-guide button",async()=>{await render();expect(host.querySelector('[data-open-guide]')).toBeNull();await click('input[value="coexistence"]');await click('[data-route-continue]');expect(host.querySelector<HTMLInputElement>('input[type="tel"]')).not.toBeNull();expect(host.textContent).toContain('will not delete or disconnect');expect(start).not.toHaveBeenCalled();});
it("keeps Arabic direction and shows no unsupported channel or tutorial promise",async()=>{await render({locale:"ar"});expect(host.querySelector('section')!.dir).toBe('rtl');expect(host.textContent).toContain('Coexistence');expect(host.textContent).not.toContain('Messenger');expect(host.textContent).not.toContain('TikTok');expect(host.querySelector('video')).toBeNull();expect(host.querySelector('details summary')).not.toBeNull();});
it("hides connection controls for a stale account",async()=>{await render({isCurrent:()=>false});expect(host.querySelector('input[type="radio"]')).toBeNull();expect(host.querySelector('[data-connect-action]')).toBeNull();expect(start).not.toHaveBeenCalled();});
