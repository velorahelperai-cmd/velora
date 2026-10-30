// @vitest-environment jsdom
import {act,createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {PaidChannelView,runBrowserWhatsappSdkPopup,type PaidChannelViewProps} from "./paid-channel-view";
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
it('shows Meta test success separately from incomplete commercial linking without blocking routes or refetching',async()=>{
 const readMetaTestReceiveProof=vi.fn(async()=>({ok:true as const,proof:{status:'receive_only_success' as const,receivedAt:'2026-10-29T18:41:31.000Z',completedAt:'2026-10-29T19:31:04.986Z',savedMessageCount:3,phoneNumberId:'1261345677073276'}}));
 await render({connectionRead:connection,actions:{startConnection:start,readMetaTestReceiveProof}});
 expect(host.querySelector('input[value="new-number"]')).not.toBeNull();
 expect(readMetaTestReceiveProof).toHaveBeenCalledTimes(1);
 expect(host.querySelector('[data-meta-test-receive="success"]')?.textContent).toContain('Meta test successful');
 expect(host.textContent).toContain('does not mean replies were sent or commercial activation is complete');
 expect(host.querySelector('[data-commercial-link="incomplete"]')).not.toBeNull();
 expect(host.textContent).toContain('Not connected');
 expect(host.textContent).not.toMatch(/commercial verified|Launch ready/i);
 await act(async()=>root.render(createElement(PaidChannelView,{...props,connectionRead:connection,actions:{startConnection:start,readMetaTestReceiveProof}})));
 expect(readMetaTestReceiveProof).toHaveBeenCalledTimes(1);
});
it('rejects real Facebook login on HTTP before starting a server attempt',async()=>{
 const actions=ports();const {launchWhatsappSdk: _launcher,...realLauncherActions}=actions;
 await render({connectionRead:connection,actions:realLauncherActions});
 await click('input[value="new-number"]');
 await click('[data-route-continue]');
 await click('[data-connect-action]');
 expect(host.textContent).toContain('Facebook connection requires an HTTPS page');
 expect(actions.startConnection).not.toHaveBeenCalled();
});
it('requires review without suggesting cancellation for an expired new-number attempt',async()=>{
 const actions=ports();const pending=(await actions.startConnection()).read;
 const expired={...pending,asOf:'2100-01-01T00:00:00Z'};
 const cancelConnection=vi.fn(async()=>({ok:false as const,code:'reconciliation_required' as const,read:expired}));
 await render({connectionRead:expired,actions:{...actions,cancelConnection}});
 expect(host.textContent).toContain('Review the attempt and saved assets');
 expect(host.querySelector('[data-cancel-action]')).toBeNull();
 expect(host.querySelector('[data-connect-action]')).toBeNull();
 expect(cancelConnection).not.toHaveBeenCalled();
});
it.each(['success','denied','offline'] as const)('settles cancellation %s without refreshing away feedback or opening Facebook',async(outcome)=>{
 const actions=ports();const pending=(await actions.startConnection()).read;
 const expired={...pending,asOf:'2100-01-01T00:00:00Z'};
 actions.startConnection.mockClear();const refresh=vi.fn();
 const cancelConnection=vi.fn(async()=>{
  if(outcome==='offline')throw Error('offline');
  return outcome==='success'?{ok:true as const,read:connection}:{ok:false as const,code:'reconciliation_required' as const,read:expired};
 });
 await render({connectionRead:pending,actions:{...actions,cancelConnection},onRefresh:refresh});
 await click('[data-cancel-action]');
 expect(host.textContent).not.toContain('Cancelling…');
 expect(host.querySelector('[data-recover-action]')).toBeNull();
 if(outcome==='success'){
  expect(host.textContent).toContain('Attempt cancelled.');
  expect(host.textContent).not.toContain('This connection attempt has expired.');
  expect(host.querySelector('input[type="radio"]')).not.toBeNull();
 }else{
  expect(host.textContent).toContain(outcome==='offline'?'Cancellation is unconfirmed':'Administrative review is required');
  expect(host.querySelector('[data-check-cancellation]')).not.toBeNull();
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
function ports(required=false){const pending={...connection,asOf:'2026-10-28T00:00:00Z',revision:'2',connection:{...connection.connection,state:'pending' as const,flow:'wa_new_number' as const,attempt:{id:'attempt',generation:1,expiresAt:'2099-01-01T00:00:00Z',status:'pending' as const}},capabilities:{...connection.capabilities,canStart:false,allowedFlows:[],canCancel:true}};return {startConnection:vi.fn(async()=>({ok:true as const,read:pending,launch:{flow:'wa_new_number' as const,attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0'}})),launchWhatsappSdk:vi.fn(async()=>({kind:'completed' as const,code:'one-use-code',wabaId:'222',phoneNumberId:'333'})),prepareRegistration:vi.fn(async()=>({ok:true as const,registrationRequired:required,authorizationTicket:'encrypted-ticket'})),completeConnection:vi.fn(async()=>({ok:false as const,code:'reconciliation_required' as const,read:{...pending,connection:{...pending.connection,state:'reconciliation_required' as const}}})),cancelConnection:vi.fn(async()=>({ok:true as const,read:connection}))};}
async function facebook(){await click('input[value="new-number"]');await click('[data-route-continue]');await click('[data-connect-action]');await click('[data-connect-action]');}
it('starts Facebook without a PIN and skips the field for a server-confirmed registered number',async()=>{const actions=ports();await render({connectionRead:connection,actions});await facebook();expect(actions.launchWhatsappSdk).toHaveBeenCalledTimes(1);expect(actions.prepareRegistration).toHaveBeenCalledTimes(1);expect(actions.completeConnection).toHaveBeenCalledWith(expect.objectContaining({completion:expect.objectContaining({pin:'',authorizationTicket:'encrypted-ticket'})}));expect(host.querySelector('input[type="password"]')).toBeNull();expect(host.textContent).not.toContain('Connected successfully');});
it('asks for a PIN only after the server proves registration is needed, then cancels the same attempt',async()=>{const actions=ports(true);await render({connectionRead:connection,actions});await facebook();expect(actions.prepareRegistration).toHaveBeenCalledTimes(1);expect(actions.completeConnection).not.toHaveBeenCalled();const input=host.querySelector<HTMLInputElement>('input[type="password"]')!;expect(input).not.toBeNull();expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toContain('not the SMS');const cancel=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Cancel attempt')!;await act(async()=>cancel.click());expect(actions.cancelConnection).toHaveBeenCalledWith(expect.objectContaining({attemptId:'attempt',generation:1}));expect(actions.completeConnection).not.toHaveBeenCalled();});
it('does not cancel an expired attempt from the PIN screen',async()=>{
 const actions=ports(true);await render({connectionRead:connection,actions});await facebook();
 vi.useFakeTimers();try{vi.setSystemTime(new Date('2100-01-01T00:00:00Z'));const cancel=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Cancel attempt')!;await act(async()=>cancel.click());expect(actions.cancelConnection).not.toHaveBeenCalled();expect(host.textContent).toContain('Review the attempt and saved assets');}finally{vi.useRealTimers();}
});
it('finishes the same attempt after a required PIN without starting Facebook again',async()=>{const actions=ports(true);await render({connectionRead:connection,actions});await facebook();const input=host.querySelector<HTMLInputElement>('input[type="password"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'123456');input.dispatchEvent(new Event('input',{bubbles:true}));});await act(async()=>host.querySelector('form[data-registration-pin]')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(actions.completeConnection).toHaveBeenCalledWith(expect.objectContaining({attemptId:'attempt',completion:expect.objectContaining({pin:'123456'})}));expect(actions.startConnection).toHaveBeenCalledTimes(1);expect(host.querySelector('input[type="password"]')).toBeNull();});
it('does not ask for a PIN or complete when provider preparation is unavailable',async()=>{const actions=ports();actions.prepareRegistration.mockRejectedValue(new Error('offline'));await render({connectionRead:connection,actions});await facebook();expect(host.querySelector('input[type="password"]')).toBeNull();expect(actions.completeConnection).not.toHaveBeenCalled();expect(actions.startConnection).toHaveBeenCalledTimes(1);});
it('cancels only an explicit Meta CANCEL without asking for PIN or completing',async()=>{const actions=ports();actions.launchWhatsappSdk.mockResolvedValue({kind:'cancelled'} as never);await render({connectionRead:connection,actions});await facebook();expect(actions.cancelConnection).toHaveBeenCalledTimes(1);expect(actions.prepareRegistration).not.toHaveBeenCalled();expect(actions.completeConnection).not.toHaveBeenCalled();});
it('deduplicates simultaneous Facebook clicks',async()=>{const actions=ports();let finish:((value:never)=>void)|undefined;actions.launchWhatsappSdk.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await render({connectionRead:connection,actions});await click('input[value="new-number"]');await click('[data-route-continue]');const button=host.querySelector<HTMLButtonElement>('[data-connect-action]')!;await act(async()=>{button.click();button.click();});expect(actions.startConnection).toHaveBeenCalledTimes(1);await click('[data-connect-action]');await act(async()=>finish?.({kind:'cancelled'} as never));});
it('resumes a server-saved attempt after remount without another Facebook popup or start',async()=>{const actions=ports();const pending=(await actions.startConnection()).read;actions.startConnection.mockClear();const saved={...pending,capabilities:{...pending.capabilities,canRecover:true}};const recoverConnection=vi.fn(async()=>({ok:true as const,read:saved,continuation:{registrationRequired:false,authorizationTicket:'refreshed-ticket',nonce:'nonce',wabaId:'222',phoneNumberId:'333'}}));await render({connectionRead:saved,actions:{...actions,recoverConnection}});await click('[data-recover-action]');expect(recoverConnection).toHaveBeenCalledWith(expect.objectContaining({attemptId:'attempt',generation:1}));expect(actions.completeConnection).toHaveBeenCalledWith(expect.objectContaining({completion:expect.objectContaining({authorizationTicket:'refreshed-ticket',code:'durable-checkpoint',pin:''})}));expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();expect(actions.startConnection).not.toHaveBeenCalled();expect(host.textContent).not.toContain('Connected successfully');});
it("shows Facebook and its illustrated instructions without collecting a PIN first",async()=>{await render();const next=host.querySelector<HTMLButtonElement>('[data-route-continue]')!;expect(next.disabled).toBe(true);await click('input[value="new-number"]');await click('[data-route-continue]');expect(host.querySelector('[data-wa-screen="requirements"]')).not.toBeNull();expect(host.querySelector('[data-guide-source]')).not.toBeNull();expect(host.querySelector('input[type="password"]')).toBeNull();expect(host.querySelector<HTMLButtonElement>('[data-connect-action]')!.disabled).toBe(true);expect(start).not.toHaveBeenCalled();});
it("shows coexistence requirements without a separate illustrated-guide button",async()=>{await render();expect(host.querySelector('[data-open-guide]')).toBeNull();await click('input[value="coexistence"]');await click('[data-route-continue]');expect(host.querySelector<HTMLInputElement>('input[type="tel"]')).not.toBeNull();expect(host.textContent).toContain('will not delete or disconnect');expect(start).not.toHaveBeenCalled();});
it("keeps Arabic direction and shows no unsupported channel or tutorial promise",async()=>{await render({locale:"ar"});expect(host.querySelector('section')!.dir).toBe('rtl');expect(host.textContent).toContain('Coexistence');expect(host.textContent).not.toContain('Messenger');expect(host.textContent).not.toContain('TikTok');expect(host.querySelector('video')).toBeNull();expect(host.querySelector('details summary')).not.toBeNull();});
it("hides connection controls for a stale account",async()=>{await render({isCurrent:()=>false});expect(host.querySelector('input[type="radio"]')).toBeNull();expect(host.querySelector('[data-connect-action]')).toBeNull();expect(start).not.toHaveBeenCalled();});

it.each(['wa_new_number'] as const)('retains a missing %s callback code as UNKNOWN until authority ends',async flow=>{
 const controller=new AbortController(),log=vi.spyOn(console,'info').mockImplementation(()=>{});
 const login=vi.fn((callback:(value:object)=>void)=>callback({}));vi.stubGlobal('FB',{init:vi.fn(),login});
 try{
  const pending=runBrowserWhatsappSdkPopup({flow,attemptId:'private-attempt',nonce:'private-nonce',appId:'111',configId:'cfg',graphVersion:'v25.0',confirmedPhoneNumber:'+96891234567'} as never,{expiresAt:Date.now()+600000,isCurrent:()=>true,signal:controller.signal});
  let resolved=false;void pending.then(()=>{resolved=true;});await Promise.resolve();await Promise.resolve();
  expect(resolved).toBe(false);expect(log.mock.calls.some(call=>call[1]?.stage==='callback_without_code')).toBe(true);
  controller.abort();expect(await pending).toEqual({kind:'error'});expect(login).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(log.mock.calls)).not.toContain('private-attempt');expect(JSON.stringify(log.mock.calls)).not.toContain('private-nonce');
 }finally{log.mockRestore();}
});

it('prepares once then invokes the popup synchronously from a separate user click',async()=>{
 const actions=ports();let resolvePopup:((x:{kind:'error'})=>void)|undefined;
 actions.launchWhatsappSdk.mockImplementation(()=>new Promise(resolve=>{resolvePopup=resolve as unknown as typeof resolvePopup;}));
 await render({connectionRead:connection,actions});await click('input[value="new-number"]');await click('[data-route-continue]');await click('[data-connect-action]');
 expect(actions.startConnection).toHaveBeenCalledTimes(1);expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();
 await act(async()=>{host.querySelector<HTMLButtonElement>('[data-connect-action]')!.click();expect(actions.launchWhatsappSdk).toHaveBeenCalledTimes(1);host.querySelector<HTMLButtonElement>('[data-connect-action]')!.click();});
 expect(actions.startConnection).toHaveBeenCalledTimes(1);expect(actions.launchWhatsappSdk).toHaveBeenCalledTimes(1);
 await act(async()=>resolvePopup?.({kind:'error'}));expect(actions.cancelConnection).not.toHaveBeenCalled();
});
it('does not open or replace an expired prepared attempt',async()=>{
 const actions=ports();const original=actions.startConnection;const pending=(await original()).read;original.mockClear();
 const short={...pending,connection:{...pending.connection,attempt:{...pending.connection.attempt!,expiresAt:new Date(Date.now()+1000).toISOString()}}};
 actions.startConnection.mockResolvedValueOnce({ok:true,read:short,launch:{flow:'wa_new_number',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0'}});
 await render({connectionRead:connection,actions});await click('input[value="new-number"]');await click('[data-route-continue]');vi.useFakeTimers();
 try {await click('[data-connect-action]');await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();expect(actions.startConnection).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('attempt expired');expect(host.querySelector<HTMLButtonElement>('[data-connect-action]')!.disabled).toBe(true);} finally {vi.useRealTimers();}
});

it.each(['CANCEL','ERROR'] as const)('maps explicit Meta %s without treating ERROR as cancellation',async event=>{
 let callback:(r:object)=>void=()=>{};
 vi.stubGlobal('FB',{init:vi.fn(),login:vi.fn((cb:(r:object)=>void)=>{callback=cb;})});
 const pending=runBrowserWhatsappSdkPopup({flow:'wa_new_number',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0'});
 await Promise.resolve();await Promise.resolve();
 window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event})}));
 expect(await pending).toEqual({kind:event==='CANCEL'?'cancelled':'error'});callback({authResponse:{code:'late'}});
});
it.each(['callback-first','signal-first'] as const)('joins FINISH and OAuth in %s order',async order=>{
 let callback:(r:object)=>void=()=>{};
 vi.stubGlobal('FB',{init:vi.fn(),login:vi.fn((cb:(r:object)=>void)=>{callback=cb;})});
 const pending=runBrowserWhatsappSdkPopup({flow:'wa_new_number',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0'});
 await Promise.resolve();await Promise.resolve();
 const finish=()=>window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:'FINISH',data:{waba_id:'222',phone_number_id:'333'}})}));
 if(order==='callback-first'){callback({authResponse:{code:'code'}});finish();}else{finish();callback({authResponse:{code:'code'}});}
 expect(await pending).toEqual({kind:'completed',code:'code',wabaId:'222',phoneNumberId:'333'});
});
it('keeps listening after the UI timeout and accepts a late callback within attempt validity',async()=>{
 vi.useFakeTimers();let callback:(r:object)=>void=()=>{};const observation=vi.fn();
 vi.stubGlobal('FB',{init:vi.fn(),login:vi.fn((cb:(r:object)=>void)=>{callback=cb;})});
 try{
  const pending=runBrowserWhatsappSdkPopup({flow:'wa_new_number',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0'},{expiresAt:Date.now()+600000,isCurrent:()=>true,onObservation:observation});
  let resolved=false;void pending.then(()=>{resolved=true;});await Promise.resolve();await Promise.resolve();await vi.advanceTimersByTimeAsync(300000);
  expect(resolved).toBe(false);expect(observation).toHaveBeenCalledWith('waiting_timeout');
  window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:'FINISH',data:{waba_id:'222',phone_number_id:'333'}})}));
  callback({authResponse:{code:'late'}});expect(await pending).toEqual({kind:'completed',code:'late',wabaId:'222',phoneNumberId:'333'});
 }finally{vi.useRealTimers();}
});
it('reports a blocked or failed SDK login as unconfirmed without cancelling the attempt',async()=>{
 const actions=ports();actions.launchWhatsappSdk.mockRejectedValueOnce(new Error('popup blocked'));
 await render({connectionRead:connection,actions});await facebook();
 expect(actions.cancelConnection).not.toHaveBeenCalled();expect(actions.completeConnection).not.toHaveBeenCalled();expect(host.textContent).toContain('did not finish');
});
it('does not launch when Facebook SDK initialization fails',async()=>{
 vi.stubGlobal('FB',{init:vi.fn(()=>{throw Error('sdk failure')}),login:vi.fn()});
 const result=await runBrowserWhatsappSdkPopup({flow:'wa_new_number',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0'});
 expect(result).toEqual({kind:'error'});expect((window as unknown as {FB:{login:ReturnType<typeof vi.fn>}}).FB.login).not.toHaveBeenCalled();
});
it('observes SDK popup closure without cancellation and restores window.open',async()=>{
 vi.useFakeTimers();const controller=new AbortController(),observation=vi.fn();let callback:(r:object)=>void=()=>{};
 let popupClosed=false;const readClosed=vi.fn(()=>popupClosed);const fakePopup={get closed(){return readClosed();}};const originalOpen=window.open;const open=vi.fn(()=>fakePopup as unknown as Window);window.open=open;
 vi.stubGlobal('FB',{init:vi.fn(),login:vi.fn((cb:(r:object)=>void)=>{callback=cb;window.open('about:blank');})});
 try{
  const pending=runBrowserWhatsappSdkPopup({flow:'wa_new_number',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0'},{expiresAt:Date.now()+600000,isCurrent:()=>true,signal:controller.signal,onObservation:observation});
  await vi.advanceTimersByTimeAsync(0);expect(open).toHaveBeenCalledTimes(1);expect(window.open).toBe(open);popupClosed=true;await vi.advanceTimersByTimeAsync(500);expect(readClosed).toHaveBeenCalled();expect(observation).toHaveBeenCalledWith('popup_closed');
  controller.abort();expect(await pending).toEqual({kind:'error'});callback({authResponse:{code:'late'}});expect(vi.getTimerCount()).toBe(0);
 }finally{window.open=originalOpen;vi.useRealTimers();}
});
it('never launches an expired capture even after successful SDK preparation',async()=>{
 const login=vi.fn();vi.stubGlobal('FB',{init:vi.fn(),login});
 const result=await runBrowserWhatsappSdkPopup({flow:'wa_new_number',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0'},{expiresAt:Date.now()-1,isCurrent:()=>true});expect(result).toEqual({kind:'error'});expect(login).not.toHaveBeenCalled();
});

it('sends OAuth code to durable server capture before FINISH after SDK preparation',async()=>{
 let callback:(r:object)=>void=()=>{};const login=vi.fn((cb:(r:object)=>void)=>{callback=cb;});const onCode=vi.fn(async()=>true);
 vi.stubGlobal('FB',{init:vi.fn(),login});
 const pending=runBrowserWhatsappSdkPopup({flow:'wa_new_number',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0'},{expiresAt:Date.now()+600000,isCurrent:()=>true,onCode});
 await Promise.resolve();await Promise.resolve();expect(login).toHaveBeenCalledTimes(1);callback({authResponse:{code:'synthetic-code'}});await Promise.resolve();expect(onCode).toHaveBeenCalledWith('synthetic-code');
 window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:'FINISH',data:{waba_id:'222',phone_number_id:'333'}})}));
 expect(await pending).toEqual({kind:'completed',code:'early-authorization',wabaId:'222',phoneNumberId:'333'});
});
it('does not apply the new-number early storage hook to Coexistence',async()=>{
 let callback:(r:object)=>void=()=>{};const onCode=vi.fn(async()=>true);vi.stubGlobal('FB',{init:vi.fn(),login:vi.fn((cb:(r:object)=>void)=>{callback=cb;})});
 const controller=new AbortController();const pending=runBrowserWhatsappSdkPopup({flow:'wa_coexistence',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0',confirmedPhoneNumber:'+96891234567'},{expiresAt:Date.now()+600000,isCurrent:()=>true,onCode,signal:controller.signal});
 callback({authResponse:{code:'code'}});await Promise.resolve();expect(onCode).not.toHaveBeenCalled();callback({});expect(await pending).toEqual({kind:'error'});
});

it.each(['none','code','finish'] as const)('preserves original Coexistence CANCEL semantics after %s evidence',async partial=>{
 let callback:(r:object)=>void=()=>{};vi.stubGlobal('FB',{init:vi.fn(),login:vi.fn((cb:(r:object)=>void)=>{callback=cb;})});
 const pending=runBrowserWhatsappSdkPopup({flow:'wa_coexistence',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0',confirmedPhoneNumber:'+96891234567'});
 await Promise.resolve();await Promise.resolve();
 if(partial==='code')callback({authResponse:{code:'code'}});
 if(partial==='finish')window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',data:{waba_id:'222',phone_number_id:'333'}})}));
 window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:'CANCEL',data:{}})}));
 expect(await pending).toEqual({kind:'cancelled'});
});
it('preserves original missing-code failure for Coexistence',async()=>{vi.stubGlobal('FB',{init:vi.fn(),login:vi.fn((cb:(r:object)=>void)=>cb({}))});expect(await runBrowserWhatsappSdkPopup({flow:'wa_coexistence',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0',confirmedPhoneNumber:'+96891234567'})).toEqual({kind:'error'});});

it('saves and refreshes pending administrative review without recovery or provider calls',async()=>{
 const actions=ports();const pending=(await actions.startConnection()).read;actions.startConnection.mockClear();
 const expired={...pending,connection:{...pending.connection,flow:'wa_new_number' as const,attempt:{...pending.connection.attempt!,expiresAt:'2020-01-01T00:00:00Z'}}};
 const receipt={id:'receipt',attemptId:expired.connection.attempt.id,generation:expired.connection.attempt.generation,status:'pending' as const,requestedAt:'2026-10-28T00:00:00Z'};
 const reviewRequest=vi.fn(async()=>({ok:true as const,receipt}));
 await render({connectionRead:expired,actions:{...actions,reviewRequest}});
 expect(reviewRequest).not.toHaveBeenCalled();await click('[data-request-review]');expect(host.textContent).toContain('Review pending');
 expect(reviewRequest).toHaveBeenLastCalledWith(expect.objectContaining({attemptId:receipt.attemptId,generation:receipt.generation,request:true}));
 await click('[data-refresh-review]');expect(reviewRequest).toHaveBeenLastCalledWith(expect.objectContaining({request:false}));
 expect(actions.startConnection).not.toHaveBeenCalled();expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();expect(actions.completeConnection).not.toHaveBeenCalled();
});

it('drops a pending administrative review response after attempt generation changes',async()=>{
 const actions=ports();const pending=(await actions.startConnection()).read;
 const expired={...pending,connection:{...pending.connection,flow:'wa_new_number' as const,attempt:{...pending.connection.attempt!,expiresAt:'2020-01-01T00:00:00Z'}}};
 let resolve!: (value: {ok:true;receipt:{id:string;attemptId:string;generation:number;status:'pending';requestedAt:string}})=>void;
 const reviewRequest=vi.fn(()=>new Promise<{ok:true;receipt:{id:string;attemptId:string;generation:number;status:'pending';requestedAt:string}}>(done=>{resolve=done;}));
 await render({connectionRead:expired,actions:{...actions,reviewRequest}});await click('[data-request-review]');
 await render({connectionRead:{...expired,connection:{...expired.connection,attempt:{...expired.connection.attempt,generation:expired.connection.attempt.generation+1}}},actions:{...actions,reviewRequest}});
 await act(async()=>resolve({ok:true,receipt:{id:'STALE_RECEIPT',attemptId:expired.connection.attempt.id,generation:expired.connection.attempt.generation,status:'pending',requestedAt:'2026-10-28T00:00:00Z'}}));
 expect(host.textContent).not.toContain('STALE_RECEIPT');expect(host.textContent).not.toContain('Review request is saved');
});

it.each(['reconciliation_required','forbidden','expired','setup_required'] as const)('displays mapped error feedback when completeConnection returns %s',async code=>{
  const actions=ports();
  actions.completeConnection.mockResolvedValue({ok:false,code,read:(await actions.startConnection()).read} as never);
  await render({connectionRead:connection,actions});
  await facebook();
  const alert=host.querySelector('[role="alert"]');
  expect(alert).not.toBeNull();
  expect(alert?.textContent?.length).toBeGreaterThan(5);
  expect(actions.completeConnection).toHaveBeenCalledTimes(1);
});
