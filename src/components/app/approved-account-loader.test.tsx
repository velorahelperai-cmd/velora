// @vitest-environment jsdom
import {act,createElement,StrictMode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const scene=vi.hoisted(()=>({resize:vi.fn(),draw:vi.fn(),create:vi.fn()}));
vi.mock('./approved-loader-scene',()=>({createApprovedLoaderScene:scene.create}));
import {ApprovedAccountLoader} from './approved-account-loader';
let root:Root,host:HTMLDivElement,frames:Map<number,FrameRequestCallback>,next:number,reduced:boolean,hidden:boolean;
let mediaListeners:Set<()=>void>,fontLoad:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 vi.resetAllMocks();frames=new Map();next=0;reduced=false;hidden=false;mediaListeners=new Set();
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{frames.set(++next,fn);return next;});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
 vi.stubGlobal('matchMedia',()=>({get matches(){return reduced;},addEventListener:(_name:string,fn:()=>void)=>mediaListeners.add(fn),removeEventListener:(_name:string,fn:()=>void)=>mediaListeners.delete(fn)}));
 Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});fontLoad=vi.fn().mockResolvedValue([]);Object.defineProperty(document,'fonts',{configurable:true,value:{load:fontLoad}});
 scene.resize.mockReturnValue(true);scene.draw.mockReturnValue(true);scene.create.mockReturnValue({resize:scene.resize,draw:scene.draw});
 host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks();delete (document as unknown as {hidden?:boolean}).hidden;delete (document as unknown as {fonts?:unknown}).fonts;});
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
it('keeps the accessible black word fallback if the canvas cannot render',async()=>{
 scene.create.mockReturnValue(null);await render();expect(host.querySelector('[role="status"]')).not.toBeNull();expect(host.textContent).toBe('Velora');expect(frames.size).toBe(0);
});
