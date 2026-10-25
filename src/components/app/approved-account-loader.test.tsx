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
 const gate=useApprovedLoaderGate(status==='loading',status==='ready',scope);
 return gate.holding&&(status==='loading'||status==='ready')?createElement(ApprovedAccountLoader,{key:scope,label:'Checking account',ready:status==='ready',onComplete:gate.finish}):createElement('section',{'data-result':status},status==='error'?'Actionable retry':'Protected destination');
}
it('keeps fast success through the minimum reference timeline and full dissolve',async()=>{
 let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);
 const renderStatus=async(status:'loading'|'ready'|'error',scope='/setup')=>act(async()=>root.render(createElement(TimedFixture,{status,scope})));
 const step=async(time:number)=>{now=time;const pending=[...frames.values()];frames.clear();await act(async()=>pending.forEach(fn=>fn(time)));};
 await renderStatus('loading');await renderStatus('ready');await step(8200);expect(host.querySelector('[data-account-loading]')).not.toBeNull();await step(8201);await step(9800);expect(host.querySelector('[data-result]')).toBeNull();await step(9801);expect(host.querySelector('[data-result="ready"]')).not.toBeNull();expect(frames.size).toBe(0);
});
it('holds for a slow authoritative check then runs the original dissolve without granting readiness',async()=>{
 let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);const step=async(time:number)=>{now=time;const pending=[...frames.values()];frames.clear();await act(async()=>pending.forEach(fn=>fn(time)));};
 await act(async()=>root.render(createElement(TimedFixture,{status:'loading'})));await step(12000);expect(host.querySelector('[data-result]')).toBeNull();expect(scene.draw.mock.calls.at(-1)?.[3]).toBeUndefined();await act(async()=>root.render(createElement(TimedFixture,{status:'ready'})));await step(13599);expect(host.querySelector('[data-result]')).toBeNull();await step(13600);expect(host.querySelector('[data-result="ready"]')).not.toBeNull();
});
it('reveals errors immediately and cancels the pending visual transition on navigation',async()=>{
 let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);await act(async()=>root.render(createElement(TimedFixture,{status:'loading'})));const stale=[...frames.values()];await act(async()=>root.render(createElement(TimedFixture,{status:'error'})));expect(host.textContent).toContain('Actionable retry');expect(frames.size).toBe(0);now=20000;await act(async()=>stale.forEach(fn=>fn(now)));expect(host.querySelector('[data-result="ready"]')).toBeNull();await act(async()=>root.render(createElement(TimedFixture,{status:'ready',scope:'/account'})));expect(host.querySelector('[data-result="ready"]')).not.toBeNull();expect(frames.size).toBe(0);
});
it('uses the reduced-motion alternative without forcing the cinematic wait',async()=>{
 reduced=true;await act(async()=>root.render(createElement(TimedFixture,{status:'loading'})));expect(host.querySelector('[data-result]')).toBeNull();await act(async()=>root.render(createElement(TimedFixture,{status:'ready'})));expect(host.querySelector('[data-result="ready"]')).not.toBeNull();expect(frames.size).toBe(0);
});

it('starts the full visible timeline after fonts resolve rather than skipping phases on a cold load',async()=>{
 let now=0,finish!:(value:unknown[])=>void;vi.spyOn(performance,'now').mockImplementation(()=>now);fontLoad.mockReturnValue(new Promise(resolve=>{finish=resolve;}));await act(async()=>root.render(createElement(TimedFixture,{status:'loading'})));now=4000;await act(async()=>finish([]));expect(scene.draw.mock.calls.at(-1)?.[0]).toBe(0);await act(async()=>root.render(createElement(TimedFixture,{status:'ready'})));const step=async(time:number)=>{now=time;const pending=[...frames.values()];frames.clear();await act(async()=>pending.forEach(fn=>fn(time)));};await step(12201);await step(13800);expect(host.querySelector('[data-result]')).toBeNull();await step(13801);expect(host.querySelector('[data-result="ready"]')).not.toBeNull();
});
it('cancels old frames on a new protected navigation and never completes the new pending check',async()=>{
 let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);await act(async()=>root.render(createElement(TimedFixture,{status:'loading'})));await act(async()=>root.render(createElement(TimedFixture,{status:'ready'})));now=8500;const pending=[...frames.values()];frames.clear();await act(async()=>pending.forEach(fn=>fn(now)));const stale=[...frames.values()];await act(async()=>root.render(createElement(TimedFixture,{status:'loading',scope:'/account'})));now=20000;await act(async()=>stale.forEach(fn=>fn(now)));expect(host.querySelector('[data-result]')).toBeNull();expect(host.querySelector('[data-account-loading]')).not.toBeNull();
});
it('does not trap an authoritative READY page when the font never becomes available',async()=>{
 fontLoad.mockReturnValue(new Promise(()=>{}));await act(async()=>root.render(createElement(TimedFixture,{status:'loading'})));await act(async()=>vi.advanceTimersByTime(9800));expect(host.querySelector('[data-result]')).toBeNull();await act(async()=>root.render(createElement(TimedFixture,{status:'ready'})));expect(host.querySelector('[data-result="ready"]')).not.toBeNull();expect(scene.create).not.toHaveBeenCalled();
});

it('does not reveal content if authoritative readiness is withdrawn before the final frame',async()=>{
 let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);const renderStatus=async(status:'loading'|'ready')=>act(async()=>root.render(createElement(TimedFixture,{status})));const step=async(time:number)=>{now=time;const pending=[...frames.values()];frames.clear();await act(async()=>pending.forEach(fn=>fn(time)));};await renderStatus('loading');await renderStatus('ready');await step(8201);await step(9750);await renderStatus('loading');await step(9900);expect(host.querySelector('[data-result]')).toBeNull();expect(frames.size).toBeGreaterThan(0);await renderStatus('ready');await step(11500);expect(host.querySelector('[data-result="ready"]')).not.toBeNull();
});
