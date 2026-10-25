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
function Fixture({scope='a'}:{scope?:string}){const [name,setName]=useState('');const draft=useAccountPrepDraft({accountId:ACCOUNT,captureToken:scope,isCurrent:()=>current,restore:payload=>setName(payload.name??'')});useLayoutEffect(()=>{api=draft;},[draft]);return createElement('input',{value:name,onChange:(event:React.ChangeEvent<HTMLInputElement>)=>{draft.markEdited();setName(event.target.value);},'data-value':name});}
async function render(scope='a'){await act(async()=>root.render(createElement(Fixture,{key:scope,scope})));}
beforeEach(()=>{vi.resetAllMocks();current=true;vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);actions.read.mockResolvedValue({ok:true,data:null});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it('preserves edits made before late hydration and uses the proven native version',async()=>{
 const read=deferred();actions.read.mockReturnValue(read.promise);await render();await act(async()=>{const input=host.querySelector('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Typed');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>read.resolve({ok:true,data:record()}));expect(host.querySelector('input')?.value).toBe('Typed');actions.save.mockResolvedValue({ok:true,data:record('Typed',8)});await act(async()=>{await api.save({name:'Typed'});});expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({expectedVersion:7,draftId:record().draftId}));
});
it('does not write before a successful read proves the current draft version',async()=>{
 actions.read.mockReturnValue(new Promise(()=>{}));await render();await act(async()=>{expect(await api.save({name:'Typed'})).toMatchObject({ok:false});});expect(actions.save).not.toHaveBeenCalled();
});
it('serializes rapid writes using a synchronous lock',async()=>{
 await render();const write=deferred();actions.save.mockReturnValue(write.promise);let first!:Promise<unknown>;await act(async()=>{first=api.save({name:'Typed'});expect(await api.save({name:'Typed'})).toBeNull();});expect(actions.save).toHaveBeenCalledTimes(1);await act(async()=>{write.resolve({ok:true,data:record('Typed',1)});await first;});
});
it('reconciles an unknown write result by readback without sending another write',async()=>{
 await render();actions.save.mockRejectedValue(Error('transport'));actions.read.mockResolvedValue({ok:true,data:record('Typed',1)});await act(async()=>{expect(await api.save({name:'Typed'})).toMatchObject({ok:true,data:{version:1}});});expect(actions.save).toHaveBeenCalledTimes(1);
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
