// @vitest-environment jsdom
import {act,createElement,StrictMode,useEffect} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useVerificationCooldown} from './use-verification-cooldown';
let root:Root,host:HTMLDivElement,current:ReturnType<typeof useVerificationCooldown>,counter=0;
let email:string;
function Probe(){const value=useVerificationCooldown(email);useEffect(()=>{current=value;});return createElement('span',null,value.ready?value.seconds:'pending');}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-24T19:00:00Z'));localStorage.clear();email=`fixture${++counter}@example.test`;vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('crypto',{subtle:{digest:async(_name:string,bytes:Uint8Array)=>new TextEncoder().encode('hash-'+new TextDecoder().decode(bytes)).buffer}});host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function render(){await act(async()=>root.render(createElement(StrictMode,null,createElement(Probe))));}
it('reserves without starting the wait; only extend commits the 60s advisory countdown',async()=>{
 await render();let first=false,second=true;await act(async()=>{first=await current.reserve();second=await current.reserve();});
 expect(first).toBe(true);expect(second).toBe(false);expect(current.seconds).toBe(0);expect(localStorage.length).toBe(0);
 await act(async()=>{current.extend();});
 expect(current.seconds).toBe(60);expect(JSON.stringify(localStorage)).not.toContain(email);expect(localStorage.length).toBe(1);
 await act(async()=>root.render(null));await render();expect(current.seconds).toBe(60);await act(async()=>{vi.advanceTimersByTime(61000);});expect(current.seconds).toBe(0);
});
it('release drops an in-flight claim so a failed provider attempt does not look accepted',async()=>{
 await render();await act(async()=>{expect(await current.reserve()).toBe(true);});expect(current.seconds).toBe(0);
 await act(async()=>{current.release();});expect(current.seconds).toBe(0);expect(localStorage.length).toBe(0);
 await act(async()=>{expect(await current.reserve()).toBe(true);current.extend();});expect(current.seconds).toBe(60);
});
it('extend honors a provider-reported wait shorter than the default advisory interval',async()=>{
 await render();await act(async()=>{expect(await current.reserve()).toBe(true);current.extend(12);});
 expect(current.seconds).toBe(12);
});
it('adopts another tab deadline and recomputes on focus rather than trusting timer ticks',async()=>{
 await render();await act(async()=>{await current.reserve();current.extend();});const key=localStorage.key(0)!;vi.setSystemTime(Date.now()+30000);localStorage.setItem(key,String(Date.now()+60000));await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key})));expect(current.seconds).toBe(60);
 vi.setSystemTime(Date.now()+45000);await act(async()=>window.dispatchEvent(new Event('focus')));expect(current.seconds).toBe(15);localStorage.removeItem(key);await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key})));expect(current.seconds).toBe(15);
});
it('keeps context changes and unavailable storage isolated without automatic sends',async()=>{
 await render();await act(async()=>{await current.reserve();current.extend();});const prior=current;email='different@example.test';await render();expect(current.seconds).toBe(0);await act(async()=>prior.extend());expect(current.seconds).toBe(0);
 vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('blocked');});vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('blocked');});let reserved=false;await act(async()=>{reserved=await current.reserve();current.extend();});expect(reserved).toBe(true);expect(current.seconds).toBe(60);
});
