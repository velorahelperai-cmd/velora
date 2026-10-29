// @vitest-environment jsdom
import {act,createElement,useLayoutEffect,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
const actions=vi.hoisted(()=>({read:vi.fn(),save:vi.fn()}));
vi.mock('@/lib/tenancy/account-prep-draft-actions',()=>({readAccountPrepDraft:actions.read,saveAccountPrepDraft:actions.save}));
import {useAccountPrepDraft} from './use-account-prep-draft';
const ACCOUNT='22222222-2222-4222-8222-222222222222';
const record=(name='Saved',version=7)=>({draftId:'11111111-1111-4111-8111-111111111111',accountId:ACCOUNT,payload:{name},version,state:'active' as const,createdAt:'2026-10-25T00:00:00Z',updatedAt:'2026-10-25T00:00:00Z',expiresAt:'2027-02-25T00:00:00Z'});
function deferred<T=unknown>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(ok=>{resolve=ok;});return {promise,resolve};}
let api:ReturnType<typeof useAccountPrepDraft>,root:Root,host:HTMLDivElement,current=true;
function Fixture({scope='a',accountId=ACCOUNT}:{scope?:string;accountId?:string}){const [name,setName]=useState('');const draft=useAccountPrepDraft({accountId,captureToken:scope,isCurrent:()=>current,restore:payload=>setName(payload.name??'')});useLayoutEffect(()=>{api=draft;},[draft]);return createElement('input',{value:name,onChange:(event:React.ChangeEvent<HTMLInputElement>)=>{draft.markEdited();setName(event.target.value);},'data-value':name});}
async function render(scope='a',accountId=ACCOUNT){await act(async()=>root.render(createElement(Fixture,{key:scope,scope,accountId})));}
beforeEach(()=>{vi.resetAllMocks();localStorage.clear();current=true;vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);actions.read.mockResolvedValue({ok:true,data:null});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
it('preserves edits made before late hydration and uses the proven native version',async()=>{
 const read=deferred();actions.read.mockReturnValue(read.promise);await render();await act(async()=>{const input=host.querySelector('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Typed');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>read.resolve({ok:true,data:record()}));expect(host.querySelector('input')?.value).toBe('Typed');actions.save.mockResolvedValue({ok:true,data:record('Typed',8)});await act(async()=>{await api.save({name:'Typed'});});expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({expectedVersion:7,draftId:record().draftId}));
});
it('does not write before a successful read proves the current draft version',async()=>{
 actions.read.mockReturnValue(new Promise(()=>{}));await render();await act(async()=>{expect(await api.save({name:'Typed'})).toMatchObject({ok:false});});expect(actions.save).not.toHaveBeenCalled();
});
it('reuses an in-flight write for the same eligible payload and skips a no-op after confirm',async()=>{
 await render();const write=deferred();actions.save.mockReturnValue(write.promise);let first!:Promise<unknown>;let second!:Promise<unknown>;
 await act(async()=>{first=api.save({name:'Typed'});second=api.save({name:'Typed'});});
 expect(actions.save).toHaveBeenCalledTimes(1);
 await act(async()=>{write.resolve({ok:true,data:record('Typed',1)});expect(await first).toMatchObject({ok:true,data:{version:1}});expect(await second).toMatchObject({ok:true,data:{version:1}});});
 await act(async()=>{expect(await api.save({name:'Typed'})).toMatchObject({ok:true,data:{version:1}});});
 expect(actions.save).toHaveBeenCalledTimes(1);
});
it('queues a newer payload while a write is in flight without dropping the latest edit',async()=>{
 await render();const firstWrite=deferred();actions.save.mockReturnValueOnce(firstWrite.promise).mockResolvedValueOnce({ok:true,data:record('Second',2)});
 let first!:Promise<unknown>;await act(async()=>{first=api.save({name:'First'});void api.save({name:'Second'});});
 expect(actions.save).toHaveBeenCalledTimes(1);
 await act(async()=>{firstWrite.resolve({ok:true,data:record('First',1)});await first;});
 expect(actions.save).toHaveBeenCalledTimes(2);
 expect(actions.save.mock.calls[1]?.[0]).toMatchObject({expectedVersion:1,patch:{name:'Second'}});
});
it('reconciles an unknown write result by readback without sending another write',async()=>{
 await render();actions.save.mockRejectedValue(Error('transport'));actions.read.mockResolvedValue({ok:true,data:record('Typed',1)});await act(async()=>{expect(await api.save({name:'Typed'})).toMatchObject({ok:true,data:{version:1}});});expect(actions.save).toHaveBeenCalledTimes(1);
});
it('queues a return to the confirmed payload behind a different pending write',async()=>{
 actions.read.mockResolvedValue({ok:true,data:record('Original',7)});await render();
 const write=deferred();actions.save.mockReturnValueOnce(write.promise).mockResolvedValueOnce({ok:true,data:record('Original',9)});
 let pending!:Promise<unknown>;
 await act(async()=>{pending=api.save({name:'Changed'});void api.save({name:'Original'});});
 await act(async()=>{write.resolve({ok:true,data:record('Changed',8)});await pending;});
 expect(actions.save).toHaveBeenCalledTimes(2);
 expect(actions.save.mock.calls[1]?.[0]).toMatchObject({expectedVersion:8,patch:{name:'Original'}});
});
it('drops an obsolete queued payload when the latest request matches the pending write',async()=>{
 await render();const write=deferred();actions.save.mockReturnValueOnce(write.promise).mockResolvedValue({ok:true,data:record('Obsolete',2)});
 let pending!:Promise<unknown>;
 await act(async()=>{pending=api.save({name:'Latest'});api.markEdited();void api.save({name:'Obsolete'});api.markEdited();void api.save({name:'Latest'});});
 await act(async()=>{write.resolve({ok:true,data:record('Latest',1)});await pending;});
 expect(actions.save).toHaveBeenCalledTimes(1);
 expect(api.hasUnconfirmedChanges()).toBe(false);
});
it('requires explicit reload before writing over a conflicting saved draft',async()=>{
 await render();actions.save.mockResolvedValue({ok:false,code:'CONFLICT'});actions.read.mockResolvedValue({ok:true,data:record('Other',2)});await act(async()=>{expect(await api.save({name:'Typed'})).toMatchObject({ok:false,code:'CONFLICT'});expect(await api.save({name:'Typed'})).toMatchObject({ok:false,code:'CONFLICT'});});expect(actions.save).toHaveBeenCalledTimes(1);await act(async()=>{await api.reload();});expect(host.querySelector('input')?.value).toBe('Other');
});
it('keeps UNKNOWN blocked when readback is also unavailable',async()=>{
 await render();actions.save.mockResolvedValue({ok:false,code:'UNAVAILABLE'});actions.read.mockResolvedValue({ok:false,code:'UNAVAILABLE'});await act(async()=>{expect(await api.save({name:'Typed'})).toMatchObject({ok:false,code:'UNAVAILABLE'});expect(await api.save({name:'Typed'})).toMatchObject({ok:false});});expect(actions.save).toHaveBeenCalledTimes(1);
});
it('ignores late hydration from a replaced account boundary',async()=>{
 const old=deferred();actions.read.mockReturnValueOnce(old.promise).mockResolvedValue({ok:true,data:record('New',3)});await render('a');await render('b');await act(async()=>old.resolve({ok:true,data:record('Old',1)}));expect(host.querySelector('input')?.value).toBe('New');
});
it('keeps saveStatus silent while a write is in flight and only surfaces fail',async()=>{
 await render();const write=deferred();actions.save.mockReturnValue(write.promise);
 let pending!:Promise<unknown>;
 await act(async()=>{pending=api.save({name:'Typed'});});
 expect(api.saveStatus).not.toBe('pending');
 expect(api.saveStatus).not.toBe('fail');
 await act(async()=>{write.resolve({ok:true,data:record('Typed',1)});await pending;});
 expect(api.saveStatus).toBe('ok');
});
it('awaits the in-flight confirmation without starting a duplicate write',async()=>{
 await render();const write=deferred();actions.save.mockReturnValue(write.promise);
 let savePromise!:Promise<unknown>;let confirmPromise!:Promise<unknown>;
 await act(async()=>{savePromise=api.save({name:'Typed'});confirmPromise=api.awaitConfirmed();});
 expect(actions.save).toHaveBeenCalledTimes(1);
 await act(async()=>{write.resolve({ok:true,data:record('Typed',1)});expect(await savePromise).toMatchObject({ok:true});expect(await confirmPromise).toMatchObject({ok:true,data:{version:1}});});
 expect(actions.save).toHaveBeenCalledTimes(1);
});
it('allows an immediate explicit retry before the background retry',async()=>{
 await render();actions.save.mockResolvedValueOnce({ok:false,code:'UNAVAILABLE'});actions.read.mockResolvedValue({ok:false,code:'UNAVAILABLE'});
 await act(async()=>{expect(await api.save({name:'Typed'})).toMatchObject({ok:false,code:'UNAVAILABLE'});});
 expect(api.saveStatus).toBe('fail');
 expect(actions.save).toHaveBeenCalledTimes(1);
 actions.save.mockResolvedValueOnce({ok:true,data:record('Typed',1)});
 await act(async()=>{expect(await api.retrySave()).toMatchObject({ok:true,data:{version:1}});});
 expect(actions.save).toHaveBeenCalledTimes(2);
 expect(api.saveStatus).toBe('ok');
});
it('does not cancel an in-flight write when the step host unmounts',async()=>{
 await render();const write=deferred();actions.save.mockReturnValue(write.promise);
 let pending!:Promise<unknown>;
 await act(async()=>{pending=api.save({name:'Typed'});});
 await act(async()=>root.unmount());
 await act(async()=>{write.resolve({ok:true,data:record('Typed',1)});await pending;});
 expect(actions.save).toHaveBeenCalledTimes(1);
});

it('enables local editing while the first server read is unavailable',async()=>{
 actions.read.mockResolvedValue({ok:false,code:'UNAVAILABLE'});await render();expect(api.hydrated).toBe(true);
});
it('restores unsynced local input after remount without waiting for the server',async()=>{
 actions.read.mockResolvedValue({ok:false,code:'UNAVAILABLE'});await render();
 await act(async()=>{api.markEdited();api.checkpoint({name:'Offline'});});
 await render('b');expect(host.querySelector('input')?.value).toBe('Offline');expect(api.hydrated).toBe(true);
});
it('keeps late server hydration from replacing locally recovered input',async()=>{
 actions.read.mockResolvedValue({ok:false,code:'UNAVAILABLE'});await render();
 await act(async()=>{api.markEdited();api.checkpoint({name:'Offline'});});
 const late=deferred();actions.read.mockReturnValue(late.promise);await render('b');
 await act(async()=>late.resolve({ok:true,data:record('Elsewhere',3)}));
 expect(host.querySelector('input')?.value).toBe('Offline');expect(api.code).toBe('CONFLICT');expect(actions.save).not.toHaveBeenCalled();
});
it('reconnects the missing read before retrying an offline save',async()=>{
 actions.read.mockResolvedValue({ok:false,code:'UNAVAILABLE'});await render();
 await act(async()=>{await api.save({name:'Offline'});});
 actions.read.mockResolvedValue({ok:true,data:null});actions.save.mockResolvedValue({ok:true,data:record('Offline',1)});
 await act(async()=>{expect(await api.retrySave()).toMatchObject({ok:true});});
 expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({expectedVersion:0,patch:{name:'Offline'}}));
});

it('isolates local recovery by authenticated account',async()=>{
 actions.read.mockResolvedValue({ok:false,code:'UNAVAILABLE'});await render();
 await act(async()=>{api.markEdited();api.checkpoint({name:'Private A'});});
 await render('b','33333333-3333-4333-8333-333333333333');expect(host.querySelector('input')?.value).toBe('');
 await render('c');expect(host.querySelector('input')?.value).toBe('Private A');
});
it('continues editing with honest status when local storage is unavailable',async()=>{
 const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota');});
 actions.read.mockResolvedValue({ok:false,code:'UNAVAILABLE'});await render();
 await act(async()=>{api.markEdited();api.checkpoint({name:'Memory only'});});
 expect(api.hydrated).toBe(true);expect(api.localSaved).toBe(false);expect(await api.awaitConfirmed()).toMatchObject({ok:false});storage.mockRestore();
});
it('retries pending local data on a real online event',async()=>{
 actions.read.mockResolvedValue({ok:false,code:'UNAVAILABLE'});await render();
 await act(async()=>{api.markEdited();api.checkpoint({name:'Reconnect'});});
 actions.read.mockResolvedValue({ok:true,data:null});actions.save.mockResolvedValue({ok:true,data:record('Reconnect',1)});
 await act(async()=>window.dispatchEvent(new Event('online')));expect(actions.save).toHaveBeenCalledTimes(1);expect(api.saveStatus).toBe('ok');
});
it('keeps newer local typing when an older server save finishes',async()=>{
 await render();const write=deferred();actions.save.mockReturnValue(write.promise);let pending!:Promise<unknown>;
 await act(async()=>{api.markEdited();pending=api.save({name:'Earlier'});api.markEdited();api.checkpoint({name:'Latest typing'});});
 await act(async()=>{write.resolve({ok:true,data:record('Earlier',1)});await pending;});
 actions.read.mockResolvedValue({ok:false,code:'UNAVAILABLE'});await render('b');expect(host.querySelector('input')?.value).toBe('Latest typing');
});
it('ignores corrupt and expired local records',async()=>{
 localStorage.setItem('velora:account-prep:v1:'+ACCOUNT,'not json');await render();expect(api.hydrated).toBe(true);
 localStorage.setItem('velora:account-prep:v1:'+ACCOUNT,JSON.stringify({schema:1,accountId:ACCOUNT,payload:{name:'Expired'},expiresAt:0,pending:true}));
 await render('b');expect(host.querySelector('input')?.value).toBe('');
});

it('uploads a step saved before the initial read completes once its version is known',async()=>{
 const initial=deferred();actions.read.mockReturnValue(initial.promise);await render();
 await act(async()=>{await api.save({name:'Early step'});});expect(actions.save).not.toHaveBeenCalled();
 actions.save.mockResolvedValue({ok:true,data:record('Early step',1)});
 await act(async()=>initial.resolve({ok:true,data:null}));expect(actions.save).toHaveBeenCalledTimes(1);
});

it('retries initial temporary read failures even before any edits',async()=>{
 vi.useFakeTimers();actions.read.mockResolvedValueOnce({ok:false,code:'UNAVAILABLE'}).mockResolvedValueOnce({ok:true,data:null});
 await render();expect(api.saveStatus).toBe('fail');
 await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
 expect(actions.read).toHaveBeenCalledTimes(2);expect(api.code).toBeNull();expect(actions.save).not.toHaveBeenCalled();
});
it('keeps retrying temporary read failures then syncs the latest local payload',async()=>{
 vi.useFakeTimers();actions.read.mockResolvedValue({ok:false,code:'UNAVAILABLE'});await render();
 await act(async()=>{await api.save({name:'First'});api.markEdited();api.checkpoint({name:'Latest'});});
 await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});expect(actions.read).toHaveBeenCalledTimes(2);
 actions.read.mockResolvedValue({ok:true,data:null});actions.save.mockResolvedValue({ok:true,data:record('Latest',1)});
 await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
 expect(actions.save).toHaveBeenCalledTimes(1);expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({patch:{name:'Latest'}}));expect(api.saveStatus).toBe('ok');
 const reads=actions.read.mock.calls.length;await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});expect(actions.read).toHaveBeenCalledTimes(reads);expect(actions.save).toHaveBeenCalledTimes(1);
});
it('never automatically retries a conflict',async()=>{
 vi.useFakeTimers();actions.read.mockResolvedValue({ok:false,code:'CONFLICT'});await render();await act(async()=>{await api.save({name:'Local'});await vi.advanceTimersByTimeAsync(60000);window.dispatchEvent(new Event('online'));});
 expect(actions.read).toHaveBeenCalledTimes(1);expect(actions.save).not.toHaveBeenCalled();expect(api.code).toBe('CONFLICT');
});
it('syncs a partial checkpoint without requiring a phone or advancing checkout',async()=>{
 actions.save.mockResolvedValue({ok:true,data:record('VELORA QA',1)});await render();
 await act(async()=>{api.markEdited();api.checkpoint({name:'VELORA QA',phone:''});await new Promise(resolve=>setTimeout(resolve,900));});
 expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({expectedAccountId:ACCOUNT,expectedVersion:0,patch:{name:'VELORA QA',phone:''}}));
});
