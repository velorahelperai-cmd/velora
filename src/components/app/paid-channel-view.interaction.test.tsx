// @vitest-environment jsdom
import {act,createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {PaidChannelView,runBrowserWhatsappSdkPopup,launchPreparedWhatsappSdkPopup,type PaidChannelViewProps} from "./paid-channel-view";
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

it('F13 explains review-restricted routing before any popup or attempt and allows choosing coexistence',async()=>{
 const base=coexistencePorts();
 const actions={...base,launchUnboundWhatsappSdk:vi.fn(async()=>({kind:'error' as const})),readWhatsappBootstrap:vi.fn(async(input:{flow:string})=>input.flow==='wa_new_number'?{ok:true as const,read:connection,config:null,blockedReason:'review_replacement_required' as const}:{ok:true as const,read:connection,config:{flow:'wa_coexistence' as const,appId:'111',configId:'cfg',graphVersion:'v25.0'}})};
 await render({connectionRead:connection,actions});await click('input[value="new-number"]');
 expect(host.textContent).toContain('previous review requires your current WhatsApp Business App');
 expect(host.querySelector<HTMLButtonElement>('[data-connect-action]')?.disabled).toBe(true);
 expect(base.startConnection).not.toHaveBeenCalled();expect(actions.launchUnboundWhatsappSdk).not.toHaveBeenCalled();
});

it.each(['wa_new_number','wa_coexistence'] as const)('F8 opens %s synchronously before slow start; binds early code only to the committed attempt',async flow=>{
 const base=flow==='wa_new_number'?ports():coexistencePorts();
 const started=await base.startConnection();base.startConnection.mockClear();
 let finishStart!:(value:typeof started)=>void;
 base.startConnection.mockImplementation(()=>new Promise(resolve=>{finishStart=resolve;}));
 const captureAuthorization=vi.fn(async()=>({ok:true}));let callback!:(response:{authResponse:{code:string}})=>void;
 let clicking=false;
 const login=vi.fn((cb:typeof callback)=>{expect(clicking).toBe(true);expect(base.startConnection).not.toHaveBeenCalled();callback=cb;});
 const actions={...base,captureAuthorization,
  readWhatsappBootstrap:vi.fn(async()=>({ok:true as const,read:connection,config:{flow,appId:'111',configId:'cfg',graphVersion:'v25.0'}})),
  launchUnboundWhatsappSdk:vi.fn((config:Parameters<typeof launchPreparedWhatsappSdkPopup>[0],lifecycle:Parameters<typeof launchPreparedWhatsappSdkPopup>[3])=>launchPreparedWhatsappSdkPopup(config,{init:vi.fn(),login},()=>{},lifecycle))};
 await render({connectionRead:connection,actions});await click(`input[value="${flow==='wa_new_number'?'new-number':'coexistence'}"]`);
 expect(base.startConnection).not.toHaveBeenCalled();expect(login).not.toHaveBeenCalled();
 await act(async()=>{clicking=true;const button=host.querySelector<HTMLButtonElement>('[data-connect-action]')!;button.click();button.click();expect(login).toHaveBeenCalledTimes(1);clicking=false;});
 expect(base.startConnection).toHaveBeenCalledTimes(1);
 await act(async()=>{
  callback({authResponse:{code:'early-code'}});
  window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:flow==='wa_new_number'?'FINISH':'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',data:{waba_id:'222',phone_number_id:'333'}})}));
 });
 expect(captureAuthorization).not.toHaveBeenCalled();expect(base.completeConnection).not.toHaveBeenCalled();
 await act(async()=>finishStart(started));
 if(flow==='wa_new_number')expect(captureAuthorization).toHaveBeenCalledWith(expect.objectContaining({attemptId:'attempt',generation:1,nonce:'nonce',code:'early-code'}));
 expect(base.completeConnection).toHaveBeenCalledTimes(1);
 expect(host.querySelector('[data-whatsapp-connected]')).toBeNull();
});

it.each(['denied','config-change','authority-lost'] as const)('F8 discards an early result after %s and never completes or auto-retries',async mode=>{
 const base=ports();const started=await base.startConnection();base.startConnection.mockClear();
 let resolveStart!:(value:typeof started)=>void;let current=true;
 base.startConnection.mockImplementation(()=>new Promise(resolve=>{resolveStart=resolve;}));
 const actions={...base,readWhatsappBootstrap:vi.fn(async()=>({ok:true as const,read:connection,config:{flow:'wa_new_number' as const,appId:'111',configId:'cfg',graphVersion:'v25.0'}})),launchUnboundWhatsappSdk:vi.fn(async()=>({kind:'completed' as const,code:'unbound-code',wabaId:'222',phoneNumberId:'333'}))};
 await render({connectionRead:connection,actions,isCurrent:()=>current});await click('input[value="new-number"]');await click('[data-connect-action]');
 expect(base.completeConnection).not.toHaveBeenCalled();
 if(mode==='authority-lost')current=false;
 await act(async()=>resolveStart(mode==='denied'?{ok:false,code:'conflict',read:connection} as never:mode==='config-change'?{...started,launch:{...started.launch,configId:'changed'}}:started));
 expect(base.completeConnection).not.toHaveBeenCalled();expect(base.cancelConnection).not.toHaveBeenCalled();expect(base.startConnection).toHaveBeenCalledTimes(1);
});

it('F8 preserves an existing unknown attempt found during read-only preparation',async()=>{
 const base=ports(),started=await base.startConnection();base.startConnection.mockClear();
 const unknown={...started.read,connection:{...started.read.connection,state:'reconciliation_required' as const,attempt:{...started.read.connection.attempt!,status:'unknown' as const}}};
 const actions={...base,readWhatsappBootstrap:vi.fn(async()=>({ok:true as const,read:unknown,config:null})),launchUnboundWhatsappSdk:vi.fn()};
 await render({connectionRead:connection,actions});await click('input[value="new-number"]');
 expect(base.startConnection).not.toHaveBeenCalled();expect(base.cancelConnection).not.toHaveBeenCalled();expect(actions.launchUnboundWhatsappSdk).not.toHaveBeenCalled();
 expect(host.querySelector('[data-connect-action]')).toBeNull();
});

it.each(['wa_new_number','wa_coexistence'] as const)('F8 rejects %s code when start takes longer than its 30-second lifetime',async flow=>{
 const base=flow==='wa_new_number'?ports():coexistencePorts(),started=await base.startConnection();base.startConnection.mockClear();
 let resolveStart!:(value:typeof started)=>void,callback!:(response:{authResponse:{code:string}})=>void;
 base.startConnection.mockImplementation(()=>new Promise(resolve=>{resolveStart=resolve;}));
 const captureAuthorization=vi.fn(async()=>({ok:true}));
 const actions={...base,captureAuthorization,readWhatsappBootstrap:vi.fn(async()=>({ok:true as const,read:connection,config:{flow,appId:'111',configId:'cfg',graphVersion:'v25.0'}})),
  launchUnboundWhatsappSdk:(config:Parameters<typeof launchPreparedWhatsappSdkPopup>[0],lifecycle:Parameters<typeof launchPreparedWhatsappSdkPopup>[3])=>launchPreparedWhatsappSdkPopup(config,{init:vi.fn(),login:cb=>{callback=cb;}},()=>{},lifecycle)};
 await render({connectionRead:connection,actions});await click(`input[value="${flow==='wa_new_number'?'new-number':'coexistence'}"]`);await click('[data-connect-action]');
 await act(async()=>{callback({authResponse:{code:'expired-code'}});window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:flow==='wa_new_number'?'FINISH':'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',data:{waba_id:'222',phone_number_id:'333'}})}));});
 const time=vi.spyOn(Date,'now').mockReturnValue(Date.now()+31_000);
 try{await act(async()=>resolveStart(started));expect(captureAuthorization).not.toHaveBeenCalled();expect(base.completeConnection).not.toHaveBeenCalled();expect(base.cancelConnection).not.toHaveBeenCalled();expect(base.startConnection).toHaveBeenCalledTimes(1);}finally{time.mockRestore();}
});
it('keeps internal Meta test proof out of customer setup and preserves incomplete commercial status',async()=>{
 const readMetaTestReceiveProof=vi.fn(async()=>({ok:true as const,proof:null}));
 await render({connectionRead:connection,actions:{startConnection:start,readMetaTestReceiveProof}});
 expect(readMetaTestReceiveProof).not.toHaveBeenCalled();
 expect(host.querySelector('[data-meta-test-receive]')).toBeNull();
 expect(host.textContent).not.toContain('Meta test successful');
 expect(host.querySelector('[data-commercial-link="incomplete"]')).not.toBeNull();
 expect(host.textContent).toContain('Not connected');
 expect(host.querySelector('input[value="coexistence"]')).not.toBeNull();
});
it('shows verified connection and management instead of a new signup',async()=>{
 const actions=ports();const linked={...connection,connection:{...connection.connection,state:'connected' as const,flow:'wa_new_number' as const,verified:true,link:{id:'link',generation:1}},capabilities:{...connection.capabilities,canStart:false,allowedFlows:[]}};
 await render({connectionRead:linked,actions});
 expect(host.querySelector('[data-whatsapp-connected]')?.textContent).toContain('WhatsApp connected');
 expect(host.querySelector('a[href="/app/settings?tab=whatsapp"]')).not.toBeNull();
 expect(host.querySelector('[data-connect-action]')).toBeNull();expect(host.querySelector('input[type="radio"]')).toBeNull();
 expect(actions.startConnection).not.toHaveBeenCalled();
});
it('shows recovery for the saved pending attempt without offering another signup',async()=>{
 const actions=ports();const pending=(await actions.startConnection()).read;actions.startConnection.mockClear();
 await render({connectionRead:{...pending,capabilities:{...pending.capabilities,canRecover:true}},actions});
 expect(host.querySelector('[data-recover-action]')).not.toBeNull();
 expect(host.querySelector('input[type="radio"]')).toBeNull();expect(host.querySelector('[data-connect-action]')).toBeNull();
 expect(actions.startConnection).not.toHaveBeenCalled();
});
it('rejects real Facebook login on HTTP before starting a server attempt without the intermediate card',async()=>{
 const actions=ports();const {launchWhatsappSdk: _launcher,...realLauncherActions}=actions;
 await render({connectionRead:connection,actions:realLauncherActions});
 await click('input[value="new-number"]');
 expect(host.querySelector('[data-route-continue]')).toBeNull();
 expect(host.textContent).not.toContain('Continue to Facebook connection');
 await click('[data-connect-action]');
 expect(actions.startConnection).not.toHaveBeenCalled();
});
it.each(['new-number','coexistence'] as const)('blocks Facebook connect on http for %s with a short visible HTTPS message',async value=>{
 const actions=ports();const {launchWhatsappSdk: _launcher,...realLauncherActions}=actions;
 await render({locale:'en',connectionRead:connection,actions:realLauncherActions});
 await click(`input[value="${value}"]`);await click('[data-connect-action]');
 expect(host.querySelector('[data-route-continue]')).toBeNull();
 expect(host.querySelector('[data-connect-feedback]')?.textContent).toBe('A secure (HTTPS) connection is required to open Facebook');
 await render({locale:'ar',connectionRead:connection,actions:realLauncherActions});
 expect(host.querySelector('[data-connect-feedback]')?.textContent).toBe('يلزم اتصال آمن (HTTPS) لفتح Facebook');
 expect(actions.startConnection).not.toHaveBeenCalled();expect(document.querySelector('script[src*="connect.facebook.net"]')).toBeNull();
});it('requires review without suggesting cancellation for an expired new-number attempt',async()=>{
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
async function facebook(){await click('input[value="new-number"]');await click('[data-connect-action]');await click('[data-connect-action]');}
it('starts Facebook without a PIN and skips the field for a server-confirmed registered number',async()=>{const actions=ports();await render({connectionRead:connection,actions});await facebook();expect(actions.launchWhatsappSdk).toHaveBeenCalledTimes(1);expect(actions.prepareRegistration).toHaveBeenCalledTimes(1);expect(actions.completeConnection).toHaveBeenCalledWith(expect.objectContaining({completion:expect.objectContaining({pin:'',authorizationTicket:'encrypted-ticket'})}));expect(host.querySelector('input[type="password"]')).toBeNull();expect(host.textContent).not.toContain('Connected successfully');});
it('asks for a PIN only after the server proves registration is needed, then cancels the same attempt',async()=>{const actions=ports(true);await render({connectionRead:connection,actions});await facebook();expect(actions.prepareRegistration).toHaveBeenCalledTimes(1);expect(actions.completeConnection).not.toHaveBeenCalled();const input=host.querySelector<HTMLInputElement>('input[type="password"]')!;expect(input).not.toBeNull();expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toContain('not the SMS');const cancel=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Cancel attempt')!;await act(async()=>cancel.click());expect(actions.cancelConnection).toHaveBeenCalledWith(expect.objectContaining({attemptId:'attempt',generation:1}));expect(actions.completeConnection).not.toHaveBeenCalled();});
it('does not cancel an expired attempt from the PIN screen',async()=>{
 const actions=ports(true);await render({connectionRead:connection,actions});await facebook();
 vi.useFakeTimers();try{vi.setSystemTime(new Date('2100-01-01T00:00:00Z'));const cancel=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Cancel attempt')!;await act(async()=>cancel.click());expect(actions.cancelConnection).not.toHaveBeenCalled();expect(host.textContent).toContain('Review the attempt and saved assets');}finally{vi.useRealTimers();}
});
it('finishes the same attempt after a required PIN without starting Facebook again',async()=>{const actions=ports(true);await render({connectionRead:connection,actions});await facebook();const input=host.querySelector<HTMLInputElement>('input[type="password"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'123456');input.dispatchEvent(new Event('input',{bubbles:true}));});await act(async()=>host.querySelector('form[data-registration-pin]')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(actions.completeConnection).toHaveBeenCalledWith(expect.objectContaining({attemptId:'attempt',completion:expect.objectContaining({pin:'123456'})}));expect(actions.startConnection).toHaveBeenCalledTimes(1);expect(host.querySelector('input[type="password"]')).toBeNull();});
it('does not ask for a PIN or complete when provider preparation is unavailable',async()=>{const actions=ports();actions.prepareRegistration.mockRejectedValue(new Error('offline'));await render({connectionRead:connection,actions});await facebook();expect(host.querySelector('input[type="password"]')).toBeNull();expect(actions.completeConnection).not.toHaveBeenCalled();expect(actions.startConnection).toHaveBeenCalledTimes(1);});
it('cancels only an explicit Meta CANCEL without asking for PIN or completing',async()=>{const actions=ports();actions.launchWhatsappSdk.mockResolvedValue({kind:'cancelled'} as never);await render({connectionRead:connection,actions});await facebook();expect(actions.cancelConnection).toHaveBeenCalledTimes(1);expect(actions.prepareRegistration).not.toHaveBeenCalled();expect(actions.completeConnection).not.toHaveBeenCalled();});
it('deduplicates simultaneous Facebook clicks',async()=>{const actions=ports();let finish:((value:never)=>void)|undefined;actions.launchWhatsappSdk.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await render({connectionRead:connection,actions});await click('input[value="new-number"]');await click('[data-connect-action]');const button=host.querySelector<HTMLButtonElement>('[data-connect-action]')!;await act(async()=>{button.click();button.click();});expect(actions.startConnection).toHaveBeenCalledTimes(1);expect(actions.launchWhatsappSdk).toHaveBeenCalledTimes(1);await act(async()=>finish?.({kind:'cancelled'} as never));});
it('resumes a server-saved attempt after remount without another Facebook popup or start',async()=>{const actions=ports();const pending=(await actions.startConnection()).read;actions.startConnection.mockClear();const saved={...pending,capabilities:{...pending.capabilities,canRecover:true}};const recoverConnection=vi.fn(async()=>({ok:true as const,read:saved,continuation:{registrationRequired:false,authorizationTicket:'refreshed-ticket',nonce:'nonce',wabaId:'222',phoneNumberId:'333'}}));await render({connectionRead:saved,actions:{...actions,recoverConnection}});await click('[data-recover-action]');expect(recoverConnection).toHaveBeenCalledWith(expect.objectContaining({attemptId:'attempt',generation:1}));expect(actions.completeConnection).toHaveBeenCalledWith(expect.objectContaining({completion:expect.objectContaining({authorizationTicket:'refreshed-ticket',code:'durable-checkpoint',pin:''})}));expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();expect(actions.startConnection).not.toHaveBeenCalled();expect(host.textContent).not.toContain('Connected successfully');});
it("opens new-number requirements without the intermediate card and keeps connect gated until authority loads",async()=>{await render();await click('input[value="new-number"]');expect(host.querySelector('[data-wa-screen="requirements"]')).not.toBeNull();expect(host.querySelector('[data-route-continue]')).toBeNull();expect(host.textContent).not.toContain('Continue to Facebook connection');expect(host.querySelector<HTMLButtonElement>('[data-connect-action]')?.disabled).toBe(true);await click('[data-connect-action]');expect(start).not.toHaveBeenCalled();expect(host.textContent).not.toContain('Channel data is incomplete');});
it("opens the coexistence guide like new-number, with no phone input or confirmation checkbox",async()=>{await render();await click('input[value="coexistence"]');expect(host.querySelector('input[type="tel"]')).toBeNull();expect(host.querySelector('input[type="checkbox"]')).toBeNull();expect(host.querySelector('[data-route-continue]')).toBeNull();expect(host.querySelector('[data-wa-screen="requirements"]')).not.toBeNull();expect(host.querySelector('[data-guide-source="coexistence/step-1"]')).not.toBeNull();expect(start).not.toHaveBeenCalled();});
it("keeps Arabic direction and shows no unsupported channel or tutorial promise",async()=>{await render({locale:"ar"});expect(host.querySelector('section')!.dir).toBe('rtl');const routes=Array.from(host.querySelectorAll('input[type="radio"]')).map(r=>r.closest('label')!);expect(routes.map(r=>(r.querySelector('input') as HTMLInputElement).value)).toEqual(['new-number','coexistence']);expect(routes[0].querySelector('span')!.textContent).toBe('استخدام رقم جديد');expect(routes[1].querySelector('span')!.textContent).toBe('ربط تطبيق WhatsApp Business الحالي');expect(routes[0].querySelector('small')!.textContent).toContain('غير مربوط');expect(routes[1].querySelector('small')!.textContent).toContain('احتفظ بالتطبيق');expect(routes[0].textContent).not.toBe(routes[1].textContent);expect(host.textContent).not.toContain('Messenger');expect(host.textContent).not.toContain('TikTok');expect(host.querySelector('video')).toBeNull();expect(host.querySelector('fieldset legend')?.textContent).toBe('كيف تستخدم هذا الرقم؟');});
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
 await render({connectionRead:connection,actions});expect(actions.startConnection).not.toHaveBeenCalled();await click('input[value="new-number"]');expect(actions.startConnection).not.toHaveBeenCalled();await click('[data-connect-action]');
 expect(actions.startConnection).toHaveBeenCalledTimes(1);expect(actions.startConnection).toHaveBeenCalledWith(expect.not.objectContaining({confirmedPhoneNumber:expect.anything()}));expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();
 await act(async()=>{host.querySelector<HTMLButtonElement>('[data-connect-action]')!.click();expect(actions.launchWhatsappSdk).toHaveBeenCalledTimes(1);host.querySelector<HTMLButtonElement>('[data-connect-action]')!.click();});
 expect(actions.startConnection).toHaveBeenCalledTimes(1);expect(actions.launchWhatsappSdk).toHaveBeenCalledTimes(1);
 await act(async()=>resolvePopup?.({kind:'error'}));expect(actions.cancelConnection).not.toHaveBeenCalled();
});
it('does not open or replace an expired prepared attempt',async()=>{
 const actions=ports();const original=actions.startConnection;const pending=(await original()).read;original.mockClear();
 const short={...pending,connection:{...pending.connection,attempt:{...pending.connection.attempt!,expiresAt:new Date(Date.now()+1000).toISOString()}}};
 actions.startConnection.mockResolvedValueOnce({ok:true,read:short,launch:{flow:'wa_new_number',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0'}});
 await render({connectionRead:connection,actions});vi.useFakeTimers();
 try {await click('input[value="new-number"]');await click('[data-connect-action]');await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();expect(actions.startConnection).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('attempt expired');expect(host.querySelector('[data-connect-action]')).toBeNull();} finally {vi.useRealTimers();}
});

it.each(['CANCEL','ERROR'] as const)('maps explicit Meta %s without treating ERROR as cancellation',async event=>{
 let callback:(r:object)=>void=()=>{};
 vi.stubGlobal('FB',{init:vi.fn(),login:vi.fn((cb:(r:object)=>void)=>{callback=cb;})});
 const pending=runBrowserWhatsappSdkPopup({flow:'wa_new_number',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0'});
 await Promise.resolve();await Promise.resolve();
 window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event})}));
 expect(await pending).toEqual(event==='CANCEL'?{kind:'cancelled'}:{kind:'error',reason:'meta_error'});callback({authResponse:{code:'late'}});
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
 await Promise.resolve();await Promise.resolve();callback({authResponse:{code:'code'}});await Promise.resolve();expect(onCode).not.toHaveBeenCalled();controller.abort();expect(await pending).toEqual({kind:'error'});
});

it.each(['none','code','finish'] as const)('only confirms Coexistence cancellation without partial %s evidence',async partial=>{
 let callback:(r:object)=>void=()=>{};vi.stubGlobal('FB',{init:vi.fn(),login:vi.fn((cb:(r:object)=>void)=>{callback=cb;})});
 const pending=runBrowserWhatsappSdkPopup({flow:'wa_coexistence',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0',confirmedPhoneNumber:'+96891234567'});
 await Promise.resolve();await Promise.resolve();
 if(partial==='code')callback({authResponse:{code:'code'}});
 if(partial==='finish')window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',data:{waba_id:'222',phone_number_id:'333'}})}));
 window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:'CANCEL',data:{}})}));
 expect(await pending).toEqual({kind:partial==='none'?'cancelled':'error'});
});
it('settles missing-code Coexistence only when the actual attempt expires',async()=>{
 vi.useFakeTimers();vi.stubGlobal('FB',{init:vi.fn(),login:vi.fn((cb:(r:object)=>void)=>cb({}))});
 try{
  const pending=runBrowserWhatsappSdkPopup({flow:'wa_coexistence',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0',confirmedPhoneNumber:'+96891234567'},{expiresAt:Date.now()+1000,isCurrent:()=>true});
  await vi.advanceTimersByTimeAsync(1000);expect(await pending).toEqual({kind:'error'});expect(vi.getTimerCount()).toBe(0);
 }finally{vi.useRealTimers();}
});

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

it.each(['expired','revoked','abort','partial-cancel','missing-code'] as const)('fences coexistence popup lifecycle: %s',async scenario=>{
 vi.useFakeTimers();const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 const controller=new AbortController();let current=true;let callback:(r:object)=>void=()=>{};
 const login=vi.fn((cb:(r:object)=>void)=>{callback=cb;});vi.stubGlobal('FB',{init:vi.fn(),login});
 const pending=runBrowserWhatsappSdkPopup({flow:'wa_coexistence',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0',confirmedPhoneNumber:'+96891234567'} as never,{expiresAt:Date.now()+(scenario==='expired'?-1:600000),isCurrent:()=>current,signal:controller.signal});
 try{
  let result:unknown;void pending.then(value=>{result=value;});await vi.advanceTimersByTimeAsync(0);
  if(scenario==='expired'){expect(login).not.toHaveBeenCalled();expect(result).toEqual({kind:'error'});}
  if(scenario==='revoked'){current=false;await vi.advanceTimersByTimeAsync(500);expect(result).toEqual({kind:'error'});}
  if(scenario==='abort'){controller.abort();await vi.advanceTimersByTimeAsync(0);expect(result).toEqual({kind:'error'});}
  if(scenario==='partial-cancel'){
   callback({authResponse:{code:'code'}});
   window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:'CANCEL',data:{current_step:'ASSET_SELECTION'}})}));
   await vi.advanceTimersByTimeAsync(0);expect(result).toEqual({kind:'error'});
  }
  if(scenario==='missing-code'){
   callback({});await vi.advanceTimersByTimeAsync(300000);expect(result).toBeUndefined();
   callback({authResponse:{code:'late-code'}});
   window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',data:{waba_id:'222'}})}));
   await vi.advanceTimersByTimeAsync(0);expect(result).toEqual({kind:'completed',code:'late-code',wabaId:'222',phoneNumberId:undefined});
  }
 }finally{controller.abort();await vi.runAllTimersAsync();await pending;log.mockRestore();vi.useRealTimers();}
});

function coexistencePorts(){
 const actions=ports();
 const pending={...connection,revision:'2',connection:{...connection.connection,state:'pending' as const,flow:'wa_coexistence' as const,attempt:{id:'attempt',generation:1,expiresAt:'2099-01-01T00:00:00Z',status:'pending' as const}},capabilities:{...connection.capabilities,canStart:false,allowedFlows:[],canCancel:true}};
 actions.startConnection.mockResolvedValue({ok:true,read:pending,launch:{flow:'wa_coexistence',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0',confirmedPhoneNumber:'+96891234567'}} as never);
 return actions;
}
async function chooseCoexistence(){
  // Same as new-number: choosing the route opens the guide; no phone input or checkbox.
  await click('input[value="coexistence"]');
}
it('starts coexistence from the Facebook button without a typed number and completes with Meta asset ids',async()=>{
 const actions=coexistencePorts();let finish:((value:never)=>void)|undefined;
 actions.launchWhatsappSdk.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 await render({connectionRead:connection,actions});await chooseCoexistence();
 // F5: choosing the route creates nothing; the first explicit Facebook click prepares the attempt.
 expect(actions.startConnection).not.toHaveBeenCalled();
 await click('[data-connect-action]');
 expect(actions.startConnection).toHaveBeenCalledTimes(1);
 expect(actions.startConnection).toHaveBeenCalledWith(expect.objectContaining({flow:'wa_coexistence'}));expect(actions.startConnection).toHaveBeenCalledWith(expect.not.objectContaining({confirmedPhoneNumber:expect.anything()}));
 // The next click opens Meta synchronously inside the user gesture (popup-safe).
 await act(async()=>{const button=host.querySelector<HTMLButtonElement>('[data-connect-action]')!;expect(button.disabled).toBe(false);button.click();});
 expect(actions.startConnection).toHaveBeenCalledTimes(1);expect(actions.launchWhatsappSdk).toHaveBeenCalledTimes(1);await act(async()=>finish?.({kind:'error'} as never));
});
it('does not open Facebook or duplicate preparation when server start fails',async()=>{
 const actions=coexistencePorts();actions.startConnection.mockResolvedValueOnce({ok:false,code:'conflict',read:connection} as never);
 await render({connectionRead:connection,actions});await chooseCoexistence();expect(actions.startConnection).not.toHaveBeenCalled();await click('[data-connect-action]');expect(actions.startConnection).toHaveBeenCalledTimes(1);expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();expect(host.textContent).toContain('active or review-restricted');
});

it('opens new-number guide without the intermediate summary card before preparation',async()=>{
 const actions=ports();await render({connectionRead:connection,actions});await click('input[value="new-number"]');
 expect(host.querySelector('[data-wa-screen="requirements"]')).not.toBeNull();
 expect(host.querySelector('[data-guide-source]')).not.toBeNull();
 expect(host.querySelector('[data-route-continue]')).toBeNull();
 expect(host.textContent).not.toContain('Continue to Facebook connection');
 expect(actions.startConnection).not.toHaveBeenCalled();expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();
});
it('F5: choosing the current-app route never creates an attempt; only the explicit Facebook click does',async()=>{
 const actions=ports();await render({connectionRead:connection,actions});
 expect(actions.startConnection).not.toHaveBeenCalled();
 await click('input[value="coexistence"]');
 expect(host.querySelector('input[type="tel"]')).toBeNull();expect(host.querySelector('[data-wa-screen="requirements"]')).not.toBeNull();
 expect(actions.startConnection).not.toHaveBeenCalled();expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();
 await click('[data-connect-action]');
 expect(actions.startConnection).toHaveBeenCalledTimes(1);expect(actions.startConnection).toHaveBeenCalledWith(expect.objectContaining({flow:'wa_coexistence'}));
 expect((actions.startConnection.mock.calls as unknown as unknown[][])[0][0]).not.toHaveProperty('confirmed');
});
it('never creates an attempt on mount when a pending attempt already exists',async()=>{
 const actions={...ports(),resumeLaunch:vi.fn(async()=>({ok:false as const,code:'not_resumable'}))};
 const pending={...connection,connection:{...connection.connection,state:'pending' as const,flow:'wa_coexistence' as const,attempt:{id:'attempt',generation:1,expiresAt:'2099-01-01T00:00:00Z',status:'pending' as const}},capabilities:{...connection.capabilities,canStart:false,allowedFlows:[],canCancel:true}};
 await render({connectionRead:pending,actions});
 expect(actions.startConnection).not.toHaveBeenCalled();expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();
 expect(actions.resumeLaunch).toHaveBeenCalledTimes(1);expect(host.querySelector('[role="alert"]')).toBeNull();
});
it('F5: reuses a valid pending attempt so one explicit click opens Facebook, without a new attempt',async()=>{
 const pending={...connection,connection:{...connection.connection,state:'pending' as const,flow:'wa_coexistence' as const,attempt:{id:'attempt',generation:1,expiresAt:'2099-01-01T00:00:00Z',status:'pending' as const}},capabilities:{...connection.capabilities,canStart:false,allowedFlows:[],canCancel:true}};
 const base=ports();const launch={flow:'wa_coexistence' as const,attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0'};
 const actions={...base,launchWhatsappSdk:vi.fn(async()=>({kind:'cancelled' as const})),resumeLaunch:vi.fn(async()=>({ok:true as const,read:pending,launch}))};
 await render({connectionRead:pending,actions});
 expect(actions.resumeLaunch).toHaveBeenCalledWith(expect.objectContaining({attemptId:'attempt',channel:'whatsapp'}));
 expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();
 await click('[data-connect-action]');
 expect(actions.launchWhatsappSdk).toHaveBeenCalledTimes(1);expect(actions.launchWhatsappSdk).toHaveBeenCalledWith(launch);
 expect(actions.startConnection).not.toHaveBeenCalled();
});
it('F5: does not resume an expired pending attempt',async()=>{
 const pending={...connection,connection:{...connection.connection,state:'pending' as const,flow:'wa_coexistence' as const,attempt:{id:'attempt',generation:1,expiresAt:'2000-01-01T00:00:00Z',status:'pending' as const}},capabilities:{...connection.capabilities,canStart:false,allowedFlows:[],canCancel:true}};
 const actions={...ports(),resumeLaunch:vi.fn()};
 await render({connectionRead:pending,actions});
 expect(actions.resumeLaunch).not.toHaveBeenCalled();expect(actions.startConnection).not.toHaveBeenCalled();
});
function connectedRead(flow:'wa_coexistence'|'wa_new_number',linkedNumber:string|null){
 return {...connection,connection:{...connection.connection,state:'connected' as const,verified:true,flow,attempt:{id:'attempt',generation:1,expiresAt:'2099-01-01T00:00:00Z',status:'bound' as const},link:{id:'link',generation:1}},capabilities:{...connection.capabilities,canStart:false,allowedFlows:[]},linkedNumber};
}
function numberPorts(status:'pending'|'confirmed'|'not_required'='pending'){
 return {...ports(),readNumberConfirmation:vi.fn(async()=>({ok:true as const,status,linkId:'00000000-0000-4000-8000-0000000000aa',linkGeneration:1})),decideNumberConfirmation:vi.fn(async(input:{answer:'confirmed'|'rejected'})=>({ok:true as const,status:input.answer,replayed:false,disconnected:input.answer==='rejected'}))};
}
it('shows the server-verified masked number and requires owner confirmation (both routes)',async()=>{
 for(const flow of ['wa_new_number','wa_coexistence'] as const){
  await render({connectionRead:connectedRead(flow,'+968••••4567'),actions:numberPorts()});
  const box=host.querySelector('[data-whatsapp-connected]')!;
  expect(box.getAttribute('data-number-check')).toBe('pending');
  expect(host.querySelector('[data-linked-number]')!.textContent).toBe('+968••••4567');
  expect(host.querySelector('[data-linked-number]')!.getAttribute('dir')).toBe('ltr');
  expect(host.querySelector('[data-coexistence-import]')).toBeNull();
  await act(async()=>root.unmount());root=createRoot(host);
 }
});
it('routes a wrong number to the server disconnect without import',async()=>{
 const actions=numberPorts();const onRefresh=vi.fn();
 await render({connectionRead:connectedRead('wa_coexistence','+968••••4567'),actions,onRefresh});
 const wrong=[...host.querySelectorAll('button')].find(b=>b.textContent==='This is not my number')!;
 await act(async()=>wrong.click());
 expect(actions.decideNumberConfirmation).toHaveBeenCalledWith(expect.objectContaining({answer:'rejected',linkId:'00000000-0000-4000-8000-0000000000aa',linkGeneration:1}));
 expect(onRefresh).toHaveBeenCalled();
 expect(host.querySelector('[data-whatsapp-connected]')!.getAttribute('data-number-check')).toBe('wrong');
 expect(host.querySelector('[role="alert"]')!.textContent).toContain('This number was disconnected');
 expect(host.querySelector('[data-coexistence-import]')).toBeNull();
});
it('reveals the import panel only after the coexistence number is confirmed on the server',async()=>{
 const actions=numberPorts();
 await render({connectionRead:connectedRead('wa_coexistence','+968••••4567'),actions,locale:'ar'});
 const yes=[...host.querySelectorAll('button')].find(b=>b.textContent==='نعم، هذا رقمي')!;
 await act(async()=>yes.click());
 expect(actions.decideNumberConfirmation).toHaveBeenCalledWith(expect.objectContaining({answer:'confirmed'}));
 expect(host.querySelector('[data-whatsapp-connected]')!.getAttribute('data-number-check')).toBe('confirmed');
 expect(host.querySelector('[data-coexistence-import]')).not.toBeNull();
});
it('F5: restores a previously confirmed number from the server after reload',async()=>{
 await render({connectionRead:connectedRead('wa_coexistence','+968••••4567'),actions:numberPorts('confirmed')});
 expect(host.querySelector('[data-whatsapp-connected]')!.getAttribute('data-number-check')).toBe('confirmed');
 expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Yes, this is my number')).toBe(false);
});
it('F5: keeps the number pending and shows an error when the decision cannot be saved',async()=>{
 const actions=numberPorts();actions.decideNumberConfirmation.mockResolvedValue({ok:false,code:'UNAVAILABLE'} as never);
 await render({connectionRead:connectedRead('wa_coexistence','+968••••4567'),actions});
 const yes=[...host.querySelectorAll('button')].find(b=>b.textContent==='Yes, this is my number')!;
 await act(async()=>yes.click());
 expect(host.querySelector('[data-whatsapp-connected]')!.getAttribute('data-number-check')).toBe('pending');
 expect(host.querySelector('[role="alert"]')!.textContent).toContain('could not be saved');
 expect(host.querySelector('[data-coexistence-import]')).toBeNull();
});
it('does not show confirmation buttons when the server could not provide the number',async()=>{
 await render({connectionRead:connectedRead('wa_new_number',null),actions:numberPorts()});
 expect(host.querySelector('[data-whatsapp-connected]')!.getAttribute('data-number-check')).toBe('unavailable');
 expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Yes, this is my number')).toBe(false);
});

it('waits for an explicit click after a delayed authoritative read arrives',async()=>{
 const actions=ports();await render({connectionRead:undefined,actions});expect(actions.startConnection).not.toHaveBeenCalled();await click('input[value="new-number"]');expect(actions.startConnection).not.toHaveBeenCalled();expect(host.querySelector('[data-visually-hidden]')?.textContent).toBe('Checking connection status.');
 await render({connectionRead:connection,actions});expect(actions.startConnection).not.toHaveBeenCalled();expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();await click('[data-connect-action]');
 await act(async()=>{const button=host.querySelector<HTMLButtonElement>('[data-connect-action]')!;expect(button.disabled).toBe(false);button.click();expect(actions.launchWhatsappSdk).toHaveBeenCalledTimes(1);});
});
it('does not repeat a failed new-number preparation or launch Meta',async()=>{
 const actions=ports();actions.startConnection.mockResolvedValueOnce({ok:false,code:'conflict',read:connection} as never);await render({connectionRead:connection,actions});await click('input[value="new-number"]');expect(actions.startConnection).not.toHaveBeenCalled();await click('[data-connect-action]');expect(actions.startConnection).toHaveBeenCalledTimes(1);expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();expect(host.textContent).toContain('active or review-restricted');await render({connectionRead:connection,actions});expect(actions.startConnection).toHaveBeenCalledTimes(1);
});

it('cancels pending selection intent when returning before status loads',async()=>{
 const actions=ports();await render({connectionRead:undefined,actions});await click('input[value="new-number"]');const back=Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Back')!;await act(async()=>back.click());expect(host.querySelector('input[value="new-number"]')).not.toBeNull();await render({connectionRead:connection,actions});expect(actions.startConnection).not.toHaveBeenCalled();
});

it('does not start a new attempt after a delayed read reports an existing attempt',async()=>{
 const actions=ports();const saved=(await actions.startConnection()).read;actions.startConnection.mockClear();
 await render({connectionRead:undefined,actions});await click('input[value="new-number"]');await render({connectionRead:saved,actions});expect(actions.startConnection).not.toHaveBeenCalled();
 await render({connectionRead:connection,actions});expect(actions.startConnection).not.toHaveBeenCalled();expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();
});

it('lets an App-number choice whose preparation failed return to the choices without cancelling an attempt',async()=>{
 const actions=ports();actions.startConnection.mockResolvedValueOnce({ok:false,code:'conflict',read:connection} as never);await render({connectionRead:connection,actions});await chooseCoexistence();await click('[data-connect-action]');
 const back=host.querySelector<HTMLButtonElement>('[data-wa-screen="requirements"] [data-channel-back] button')!;expect(back.textContent).toBe('Back');
 await act(async()=>back.click());expect(host.querySelector('fieldset')?.hidden).toBe(false);
 // F5: the explicit Facebook click is the only start; Back never cancels.
 expect(actions.startConnection).toHaveBeenCalledTimes(1);expect(actions.cancelConnection).not.toHaveBeenCalled();
});

it('auto-opens the requirements step (2/2) on route choice with the guide on its first step',async()=>{
 const actions=ports();await render({connectionRead:connection,actions});await click('input[value="coexistence"]');
 expect(host.querySelector('[data-wa-screen="requirements"]')).not.toBeNull();expect(host.textContent).toContain('Step 2/2');
 expect(host.querySelector('[aria-current="step"]')?.getAttribute('data-guide-step')).toBe('0');
 // Fill order: dots render in source order and the active step advances one by one.
 const dots=[...host.querySelectorAll('[data-guide-step]')].map(n=>n.getAttribute('data-guide-step'));expect(dots).toEqual(dots.map((_,i)=>String(i)));
 await click('button[aria-label="Next step"]');expect(host.querySelector('[aria-current="step"]')?.getAttribute('data-guide-step')).toBe('1');
 expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();
});
it('preloads the SDK script on the requirements screen; choosing a route creates no server attempt',async()=>{
 const actions=ports();const {launchWhatsappSdk:_l,...real}=actions;void _l;
 vi.stubGlobal('location',{...window.location,protocol:'https:'});
 document.querySelectorAll('script[src*="connect.facebook.net"]').forEach(n=>n.remove());
 await render({connectionRead:connection,actions:real});await click('input[value="coexistence"]');
 expect(document.querySelectorAll('script[src="https://connect.facebook.net/en_US/sdk.js"]').length).toBe(1);
 expect(actions.startConnection).not.toHaveBeenCalled();expect(actions.launchWhatsappSdk).not.toHaveBeenCalled();
 document.querySelectorAll('script[src*="connect.facebook.net"]').forEach(n=>n.remove());
});
it('shows a distinct message when Meta finishes without adding a phone number',async()=>{
 const actions=ports();actions.launchWhatsappSdk.mockResolvedValue({kind:'error',reason:'only_waba'} as never);await render({connectionRead:connection,actions});
 await facebook();
 expect(host.textContent).toContain('Meta finished without adding a phone number');expect(actions.completeConnection).not.toHaveBeenCalled();
});
it('maps new-number FINISH_ONLY_WABA to its own popup result',async()=>{
 vi.stubGlobal('FB',{init:vi.fn(),login:vi.fn()});
 const pending=runBrowserWhatsappSdkPopup({flow:'wa_new_number',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0'},{expiresAt:Date.now()+600000,isCurrent:()=>true});
 await Promise.resolve();await Promise.resolve();
 window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:'FINISH_ONLY_WABA',data:{waba_id:'222'}})}));
 expect(await pending).toEqual({kind:'error',reason:'only_waba'});
});
it.each(['callback-first','finish-first'] as const)('observes finish_without_code for Coexistence FINISH without a code (%s)',async order=>{
 let callback:(r:object)=>void=()=>{};vi.stubGlobal('FB',{init:vi.fn(),login:vi.fn((cb:(r:object)=>void)=>{callback=cb;})});
 const controller=new AbortController(),observation=vi.fn();
 const pending=runBrowserWhatsappSdkPopup({flow:'wa_coexistence',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0'} as never,{expiresAt:Date.now()+600000,isCurrent:()=>true,signal:controller.signal,onObservation:observation});
 await Promise.resolve();await Promise.resolve();
 const fin=()=>window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',data:{waba_id:'222'}})}));
 if(order==='callback-first'){callback({});fin();}else{fin();callback({});}
 expect(observation).toHaveBeenCalledWith('finish_without_code');controller.abort();expect(await pending).toEqual({kind:'error'});
});
it.each([['wa_new_number',{setup:{},version:'v5',features:[{name:'whatsapp_business_app_onboarding',enabled:false}]}],['wa_coexistence',{setup:{},version:'v5'}]] as const)('launches %s with Embedded Signup v5 options',async(flow,extras)=>{
 const login=vi.fn();vi.stubGlobal('FB',{init:vi.fn(),login});const controller=new AbortController();
 const pending=runBrowserWhatsappSdkPopup({flow,attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0'} as never,{expiresAt:Date.now()+600000,isCurrent:()=>true,signal:controller.signal});
 await Promise.resolve();await Promise.resolve();
 expect(login).toHaveBeenCalledTimes(1);expect(login.mock.calls[0][1]).toEqual({config_id:'cfg',response_type:'code',override_default_response_type:true,extras});
 expect(JSON.stringify(login.mock.calls[0][1])).not.toMatch(/featureType|sessionInfoVersion/);
 controller.abort();await pending;
});
const v5msg=(event:string,data:object)=>window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event,data})}));
it.each([
 ['wa_new_number','FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',{phone_number_id:'333',is_on_biz_app:true,messaging_account_ids:['222']},'wrong_route'],
 ['wa_new_number','FINISH_GRANT_ONLY_API_ACCESS',{},'grant_only'],
 ['wa_new_number','FINISH',{phone_number_id:'333',is_on_biz_app:false,messaging_account_ids:['222','444']},'multiple_accounts'],
 ['wa_new_number','FINISH',{is_on_biz_app:false,messaging_account_ids:['222']},'missing_number'],
 ['wa_new_number','ERROR',{error_message:'x',error_code:'1',session_id:'s',timestamp:'1'},'meta_error'],
 ['wa_coexistence','FINISH',{phone_number_id:'333',is_on_biz_app:false,messaging_account_ids:['222']},'wrong_route'],
 ['wa_coexistence','FINISH_ONLY_WABA',{messaging_account_ids:['222']},'only_waba'],
 ['wa_coexistence','FINISH_GRANT_ONLY_API_ACCESS',{},'grant_only'],
 ['wa_coexistence','FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',{phone_number_id:'333',is_on_biz_app:true,messaging_account_ids:['222','444']},'multiple_accounts'],
 ['wa_coexistence','ERROR',{error_message:'x'},'meta_error'],
] as const)('%s rejects v5 %s as %s without completing',async(flow,event,data,reason)=>{
 vi.stubGlobal('FB',{init:vi.fn(),login:vi.fn()});
 const pending=runBrowserWhatsappSdkPopup({flow,attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0'} as never,{expiresAt:Date.now()+600000,isCurrent:()=>true});
 await Promise.resolve();await Promise.resolve();v5msg(event,data);
 expect(await pending).toEqual({kind:'error',reason});
});
it('stops Coexistence with missing_number when v5 FINISH has a code but no phone_number_id',async()=>{
 let callback:(r:object)=>void=()=>{};vi.stubGlobal('FB',{init:vi.fn(),login:vi.fn((cb:(r:object)=>void)=>{callback=cb;})});
 const pending=runBrowserWhatsappSdkPopup({flow:'wa_coexistence',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0'} as never,{expiresAt:Date.now()+600000,isCurrent:()=>true});
 await Promise.resolve();await Promise.resolve();
 v5msg('FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',{is_on_biz_app:true,messaging_account_ids:['222']});callback({authResponse:{code:'c'}});
 expect(await pending).toEqual({kind:'error',reason:'missing_number'});
});
it('accepts documented v5 Coexistence session info and returns selectors only for server verification',async()=>{
 let callback:(r:object)=>void=()=>{};vi.stubGlobal('FB',{init:vi.fn(),login:vi.fn((cb:(r:object)=>void)=>{callback=cb;})});
 const pending=runBrowserWhatsappSdkPopup({flow:'wa_coexistence',attemptId:'attempt',nonce:'nonce',appId:'111',configId:'cfg',graphVersion:'v25.0'} as never,{expiresAt:Date.now()+600000,isCurrent:()=>true});
 await Promise.resolve();await Promise.resolve();
 v5msg('FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',{phone_number_id:'333',is_on_biz_app:true,messaging_account_ids:['222'],primary_waac_ids:[],page_ids:[],catalog_ids:[],dataset_ids:[],business_id:'9',instagram_account_ids:[],future:1});callback({authResponse:{code:'c'}});
 expect(await pending).toEqual({kind:'completed',code:'c',wabaId:'222',phoneNumberId:'333'});
});
it.each([['wrong_route','this route is for new numbers only'],['multiple_accounts','none will be chosen automatically'],['grant_only','access-only sharing'],['missing_number','no number will be chosen automatically'],['meta_error','Meta reported an error']] as const)('shows a clear new-number message for %s and does not complete or retry',async(reason,text)=>{
 const actions=ports();actions.launchWhatsappSdk.mockResolvedValue({kind:'error',reason} as never);await render({connectionRead:connection,actions});
 await facebook();expect(host.textContent).toContain(text);
 expect(actions.completeConnection).not.toHaveBeenCalled();expect(actions.cancelConnection).not.toHaveBeenCalled();expect(actions.startConnection).toHaveBeenCalledTimes(1);
});
it('does not show connected after a Meta completion until the server confirms, and creates no replacement attempt',async()=>{
 const actions=ports();actions.completeConnection.mockRejectedValue(new Error('offline'));await render({connectionRead:connection,actions});
 await facebook();
 expect(host.querySelector('[data-whatsapp-connected]')).toBeNull();expect(host.textContent).not.toContain('WhatsApp connected');
 expect(actions.startConnection).toHaveBeenCalledTimes(1);expect(actions.launchWhatsappSdk).toHaveBeenCalledTimes(1);
});
