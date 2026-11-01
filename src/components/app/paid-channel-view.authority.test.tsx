// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://velora.example.test/setup"}
// @vitest-environment-options {"url":"https://velora.test/setup"}
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PaidChannelView,type PaidChannelViewProps} from './paid-channel-view';
import {projectTrustedBoundSelection} from '@/lib/tenancy/paid-setup-contracts';
import type {PaidBranchConnectionRead} from '@/lib/tenancy/paid-branch-connection-contracts';

const scope={expectedAccountId:'actor',companyId:'company',branchId:'branch',boundaryFingerprint:'session-a'};
const read=projectTrustedBoundSelection({companyId:'company',branchId:'branch',branchLabel:'Test',orderGroupId:'order',slotIndex:0,persona:'level_1',package:'basic',term:'monthly',maxChannels:1,employeesExcludingOwner:2,clockState:'waiting_readiness',asOf:'2026-10-28T00:00:00Z'},{channels:['whatsapp']});
const connection:PaidBranchConnectionRead={schemaVersion:1,sourceStatus:'ready',expectedAccountId:'actor',companyId:'company',branchId:'branch',channel:'whatsapp',asOf:'now',revision:'1',connection:{state:'not_connected',flow:null,attempt:null,link:null,verified:false,reasonCodes:[]},capabilities:{canStart:true,canRecover:false,canCancel:false,allowedFlows:['wa_new_number']}};
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

async function setup(){
 const trace=vi.spyOn(console,'info').mockImplementation(()=>{});
 const live={identity:{userId:'actor',companyId:'company'},boundary:'session-a',ready:true};
 // AccountSessionProvider replaces the profile object on refresh and its
 // isCurrentUser(userId, expectedIdentity) compares reference equality.
 // StudioPreparationForm additionally binds the opaque session boundary.
 const validator=()=>{const identity=live.identity;return ()=>live.ready&&live.identity===identity&&live.identity.userId===scope.expectedAccountId&&live.identity.companyId===scope.companyId&&live.boundary===scope.boundaryFingerprint;};
 const pending:PaidBranchConnectionRead={...connection,revision:'2',connection:{...connection.connection,state:'pending',flow:'wa_new_number',attempt:{id:'attempt',generation:16,expiresAt:new Date(Date.now()+600000).toISOString(),status:'pending'}},capabilities:{...connection.capabilities,canStart:false,allowedFlows:[],canCancel:true}};
 const actions={
  startConnection:vi.fn(async()=>({ok:true as const,read:pending,launch:{flow:'wa_new_number' as const,attemptId:'attempt',nonce:'synthetic-nonce',appId:'111',configId:'222',graphVersion:'v25.0'}})),
  captureAuthorization:vi.fn(async()=>({ok:true})),
  prepareRegistration:vi.fn(async()=>({ok:true as const,registrationRequired:false,authorizationTicket:'synthetic-ticket'})),
  completeConnection:vi.fn(async()=>({ok:false as const,code:'reconciliation_required' as const,read:pending})),
  cancelConnection:vi.fn(async()=>({ok:true as const,read:connection})),
 };
 let callback:(response:{authResponse:{code:string}})=>void=()=>{throw Error('SDK_NOT_LAUNCHED');};
 const login=vi.fn((cb:typeof callback)=>{callback=cb;});
 vi.stubGlobal('FB',{init:vi.fn(),login});
 const render=async(isCurrent:()=>boolean,scopeOverride=scope)=>{await act(async()=>root.render(createElement(PaidChannelView,{locale:'en',scope:scopeOverride,read,channel:'whatsapp',connectionRead:connection,isCurrent,actions} satisfies PaidChannelViewProps)));};
 const original=validator();await render(original);
 for(const selector of ['input[value="new-number"]','[data-connect-action]'])await act(async()=>host.querySelector<HTMLButtonElement>(selector)!.click());
 // The prepared-attempt fallback needs a fresh gesture after the server read.
 await act(async()=>host.querySelector<HTMLButtonElement>('[data-connect-action]')!.click());
 expect(login).toHaveBeenCalledTimes(1);
 const finish=()=>window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:'FINISH',data:{waba_id:'333',phone_number_id:'444'}})}));
 const code=()=>callback({authResponse:{code:'synthetic-code'}});
 return {live,validator,original,render,actions,trace,login,finish,code};
}

it.each(['same-profile','refreshed-profile'] as const)('captures FINISH and OAuth after %s rerender within the same authority',async refresh=>{
 const s=await setup();
 if(refresh==='refreshed-profile')s.live.identity={...s.live.identity};
 const current=s.validator();expect(current()).toBe(true);
 expect(s.original()).toBe(refresh==='same-profile');
 await s.render(current);
 await act(async()=>{s.finish();s.code();s.code();});
 // Failure here with early_authorization_unknown and zero calls proves local
 // onCode denial, before the injected Server Action boundary is reached.
 const stages=s.trace.mock.calls.map(call=>call[1]?.stage);
 expect({captureCalls:s.actions.captureAuthorization.mock.calls.length,unknown:stages.includes('early_authorization_unknown')}).toEqual({captureCalls:1,unknown:false});
 expect(s.actions.captureAuthorization).toHaveBeenCalledWith({...scope,channel:'whatsapp',attemptId:'attempt',generation:16,nonce:'synthetic-nonce',code:'synthetic-code',correlationId:expect.any(String)});
 expect(stages).toEqual(expect.arrayContaining(['signup_signal','oauth_callback_received','early_authorization_saved']));
 expect(s.actions.prepareRegistration).toHaveBeenCalledTimes(1);
 expect(s.actions.completeConnection).toHaveBeenCalledTimes(1);
 expect(s.actions.startConnection).toHaveBeenCalledTimes(1);
 expect(s.actions.cancelConnection).not.toHaveBeenCalled();
});

it.each(['identity','session','company','locked'] as const)('refuses capture when live %s authority changes before callbacks',async change=>{
 const s=await setup();
 if(change==='identity')s.live.identity={...s.live.identity,userId:'other-actor'};
 if(change==='session')s.live.boundary='session-b';
 if(change==='company')s.live.identity={...s.live.identity,companyId:'other-company'};
 if(change==='locked')s.live.ready=false;
 const current=s.validator();expect(current()).toBe(false);await s.render(current);
 await act(async()=>{s.finish();s.code();});
 expect(s.actions.captureAuthorization).not.toHaveBeenCalled();
 expect(s.actions.prepareRegistration).not.toHaveBeenCalled();
 expect(s.actions.completeConnection).not.toHaveBeenCalled();
 expect(s.actions.cancelConnection).not.toHaveBeenCalled();
 expect(s.trace.mock.calls.some(call=>call[1]?.stage==='authority_lost')).toBe(true);
});

it.each(['profile','identity','session'] as const)('rechecks live authority after capture awaits a %s change',async change=>{
 const s=await setup();let saved!:(result:{ok:boolean})=>void;
 s.actions.captureAuthorization.mockImplementation(()=>new Promise(resolve=>{saved=resolve;}));
 await act(async()=>{s.finish();s.code();});
 expect(s.actions.captureAuthorization).toHaveBeenCalledTimes(1);
 if(change==='profile')s.live.identity={...s.live.identity};
 if(change==='identity')s.live.identity={...s.live.identity,userId:'other-actor'};
 if(change==='session')s.live.boundary='session-b';
 await s.render(s.validator());
 await act(async()=>saved({ok:true}));
 expect(s.actions.captureAuthorization).toHaveBeenCalledTimes(1);
 expect(s.actions.prepareRegistration).toHaveBeenCalledTimes(change==='profile'?1:0);
 expect(s.actions.completeConnection).toHaveBeenCalledTimes(change==='profile'?1:0);
 expect(s.actions.cancelConnection).not.toHaveBeenCalled();
});

it.each(['expectedAccountId','boundaryFingerprint','companyId','branchId'] as const)('discards old callbacks on a %s scope remount even when the new scope is authorized',async field=>{
 const s=await setup();await s.render(()=>true,{...scope,[field]:'replacement'});
 await act(async()=>{s.finish();s.code();});
 expect(s.actions.captureAuthorization).not.toHaveBeenCalled();
 expect(s.actions.prepareRegistration).not.toHaveBeenCalled();
 expect(s.actions.completeConnection).not.toHaveBeenCalled();
 expect(s.actions.cancelConnection).not.toHaveBeenCalled();
});
