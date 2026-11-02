// @vitest-environment jsdom
import {act,createElement,StrictMode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const scene=vi.hoisted(()=>({resize:vi.fn(),draw:vi.fn(),create:vi.fn(),setPointer:vi.fn(),clearPointer:vi.fn()}));
vi.mock('./approved-loader-scene',()=>({createApprovedLoaderScene:scene.create,APPROVED_LOADER_TIMELINE:{holdUntil:8200,dissolveDuration:1600}}));
import {ApprovedAccountLoader,useApprovedLoaderGate} from './approved-account-loader';
let root:Root,host:HTMLDivElement,frames:Map<number,FrameRequestCallback>,next:number,reduced:boolean,hidden:boolean;
let mediaListeners:Set<()=>void>,fontLoad:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});vi.resetAllMocks();frames=new Map();next=0;reduced=false;hidden=false;mediaListeners=new Set();
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{frames.set(++next,fn);return next;});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
 vi.stubGlobal('matchMedia',()=>({get matches(){return reduced;},addEventListener:(_name:string,fn:()=>void)=>mediaListeners.add(fn),removeEventListener:(_name:string,fn:()=>void)=>mediaListeners.delete(fn)}));
 Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});fontLoad=vi.fn().mockResolvedValue([]);Object.defineProperty(document,'fonts',{configurable:true,value:{load:fontLoad}});
 scene.resize.mockReturnValue(true);scene.draw.mockReturnValue(true);scene.create.mockReturnValue({resize:scene.resize,draw:scene.draw,setPointer:scene.setPointer,clearPointer:scene.clearPointer});
 host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.useRealTimers();vi.restoreAllMocks();delete (document as unknown as {hidden?:boolean}).hidden;delete (document as unknown as {fonts?:unknown}).fonts;});
async function render(){await act(async()=>root.render(createElement(StrictMode,null,createElement(ApprovedAccountLoader,{label:'Checking account'}))));}
async function frame(now:number){const pending=[...frames.values()];frames.clear();await act(async()=>{for(const fn of pending)fn(now);});}
it('keeps exactly one animation owner through StrictMode and never ends a still-pending account after the demo duration',async()=>{
 await render();expect(scene.create).toHaveBeenCalledTimes(1);expect(frames.size).toBe(1);await frame(10000);await frame(20000);
 expect(host.querySelector('[data-approved-loader="particles"]')).not.toBeNull();expect(frames.size).toBe(1);expect(host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Checking account');expect(host.textContent).not.toContain('V Velora');
 await act(async()=>root.render(null));expect(frames.size).toBe(0);expect(mediaListeners.size).toBe(0);
});
it('pauses while hidden or page-cached and paints reduced motion once without a frame loop',async()=>{
 await render();hidden=true;await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(frames.size).toBe(0);
 hidden=false;await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(frames.size).toBe(1);
 await act(async()=>window.dispatchEvent(new Event('pagehide')));expect(frames.size).toBe(0);await act(async()=>window.dispatchEvent(new Event('pageshow')));expect(frames.size).toBe(1);
 reduced=true;await act(async()=>{for(const fn of mediaListeners)fn();});expect(frames.size).toBe(0);expect(scene.draw.mock.calls.at(-1)?.[2]).toBe(true);
});
it('does not start a scene after fonts resolve following unmount',async()=>{
 let finish!:(value:unknown[])=>void;fontLoad.mockReturnValue(new Promise(resolve=>{finish=resolve;}));await render();await act(async()=>root.render(null));await act(async()=>finish([]));expect(scene.create).not.toHaveBeenCalled();expect(frames.size).toBe(0);
});
it('keeps accessible loading text without a visible brand fallback if the canvas cannot render',async()=>{
 scene.create.mockReturnValue(null);await render();expect(host.querySelector('[role="status"]')).not.toBeNull();expect(host.textContent).toBe('Checking account');expect(host.querySelector('.sr-only')).not.toBeNull();expect(frames.size).toBe(0);
});

it('forwards reference mouse and passive touch interaction, clears it, and removes listeners on unmount',async()=>{
 const add=vi.spyOn(window,'addEventListener');await render();
 await act(async()=>window.dispatchEvent(new MouseEvent('mousemove',{clientX:80,clientY:55})));
 expect(scene.setPointer).toHaveBeenLastCalledWith(80,55);
 const touch=new Event('touchmove');Object.defineProperty(touch,'touches',{value:[{clientX:40,clientY:65}]});await act(async()=>window.dispatchEvent(touch));expect(scene.setPointer).toHaveBeenLastCalledWith(40,65);
 expect(add).toHaveBeenCalledWith('touchmove',expect.any(Function),{passive:true});
 await act(async()=>window.dispatchEvent(new Event('mouseleave')));expect(scene.clearPointer).toHaveBeenCalled();
 const count=scene.setPointer.mock.calls.length;await act(async()=>root.render(null));window.dispatchEvent(new MouseEvent('mousemove',{clientX:20,clientY:20}));expect(scene.setPointer).toHaveBeenCalledTimes(count);
});
it('does not restore pointer motion under reduced motion',async()=>{
 reduced=true;await render();scene.setPointer.mockClear();await act(async()=>window.dispatchEvent(new MouseEvent('mousemove',{clientX:80,clientY:55})));expect(scene.setPointer).not.toHaveBeenCalled();expect(frames.size).toBe(0);
});

it('retains the reference pointer while fonts load',async()=>{
 let finish!:(value:unknown[])=>void;fontLoad.mockReturnValue(new Promise(resolve=>{finish=resolve;}));await render();
 await act(async()=>window.dispatchEvent(new MouseEvent('mousemove',{clientX:80,clientY:55})));await act(async()=>finish([]));expect(scene.setPointer).toHaveBeenLastCalledWith(80,55);
});

it('does not restore a departed pointer after fonts resolve',async()=>{
 let finish!:(value:unknown[])=>void;fontLoad.mockReturnValue(new Promise(resolve=>{finish=resolve;}));await render();await act(async()=>{window.dispatchEvent(new MouseEvent('mousemove',{clientX:80,clientY:55}));window.dispatchEvent(new Event('mouseleave'));});await act(async()=>finish([]));expect(scene.setPointer).not.toHaveBeenCalled();
});

it('never renders a standalone brand before fonts finish on cold first render',async()=>{
 fontLoad.mockReturnValue(new Promise(()=>{}));await render();expect(scene.create).not.toHaveBeenCalled();expect(host.textContent).not.toContain('Velora');expect(host.querySelector('.sr-only')?.textContent).toBe('Checking account');expect(host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Checking account');expect(host.querySelector('canvas')?.style.opacity).toBe('0');
});

function TimedFixture({status,scope='/setup'}:{status:'loading'|'ready'|'error';scope?:string}){
 const gate=useApprovedLoaderGate(status==='loading');
 return gate.holding?createElement(ApprovedAccountLoader,{key:scope,label:'Checking account',onComplete:gate.finish}):createElement('section',{'data-result':status},status==='error'?'Actionable retry':'Protected destination');
}
const renderStatus=async(status:'loading'|'ready'|'error',scope='/setup')=>act(async()=>root.render(createElement(TimedFixture,{status,scope})));
it('reveals a fast authoritative success immediately without waiting for a frame or dissolve',async()=>{
 await renderStatus('loading');expect(host.querySelector('[data-result]')).toBeNull();
 await renderStatus('ready');expect(host.querySelector('[data-result="ready"]')).not.toBeNull();expect(frames.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
});
it('never admits a slow pending check when the animation timeline expires',async()=>{
 await renderStatus('loading');await frame(12000);await frame(30000);expect(host.querySelector('[data-result]')).toBeNull();
 await renderStatus('ready');expect(host.querySelector('[data-result="ready"]')).not.toBeNull();expect(frames.size).toBe(0);
});
it('shows errors immediately and stale animation callbacks cannot restore content',async()=>{
 await renderStatus('loading');const stale=[...frames.values()];await renderStatus('error');
 expect(host.textContent).toContain('Actionable retry');expect(frames.size).toBe(0);
 await act(async()=>stale.forEach(fn=>fn(20000)));expect(host.querySelector('[data-result="ready"]')).toBeNull();
});
it.each([false,true])('does not delay readiness with reduced motion=%s',async(value)=>{
 reduced=value;await renderStatus('loading');await renderStatus('ready');expect(host.querySelector('[data-result="ready"]')).not.toBeNull();expect(frames.size).toBe(0);
});
it('does not wait for a missing font or start a late scene after readiness',async()=>{
 let release!:(value:unknown[])=>void;fontLoad.mockReturnValue(new Promise(resolve=>{release=resolve;}));
 await renderStatus('loading');await renderStatus('ready');expect(host.querySelector('[data-result="ready"]')).not.toBeNull();
 await act(async()=>release([]));expect(scene.create).not.toHaveBeenCalled();expect(frames.size).toBe(0);
});
it('does not defer authoritative readiness until a hidden tab becomes visible',async()=>{
 await renderStatus('loading');hidden=true;await act(async()=>document.dispatchEvent(new Event('visibilitychange')));
 await renderStatus('ready');expect(host.querySelector('[data-result="ready"]')).not.toBeNull();expect(frames.size).toBe(0);
});
it('hides content again on a new pending check and ignores old frames',async()=>{
 await renderStatus('loading');const stale=[...frames.values()];await renderStatus('ready');
 await renderStatus('loading','/account');await act(async()=>stale.forEach(fn=>fn(30000)));
 expect(host.querySelector('[data-result]')).toBeNull();expect(host.querySelector('[data-account-loading]')).not.toBeNull();
 await renderStatus('ready','/account');expect(host.querySelector('[data-result="ready"]')).not.toBeNull();
});
