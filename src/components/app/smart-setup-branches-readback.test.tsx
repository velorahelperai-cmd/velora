import {beforeEach,describe,expect,it,vi} from 'vitest';
import {type ReactElement} from 'react';
const h=vi.hoisted(()=>({slots:[] as unknown[],cursor:0,effects:[] as (()=>(()=>void)|void)[],current:true,read:vi.fn()}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),useState(initial:unknown){const i=h.cursor++;if(!(i in h.slots))h.slots[i]=initial;return [h.slots[i],(v:unknown)=>{h.slots[i]=typeof v==='function'?(v as (old:unknown)=>unknown)(h.slots[i]):v;}];},useRef(initial:unknown){const i=h.cursor++;if(!(i in h.slots))h.slots[i]={current:initial};return h.slots[i];},useEffect(fn:()=>()=>void){h.effects.push(fn);},useLayoutEffect(fn:()=>void){fn();}}));
vi.mock('@/lib/tenancy/smart-onboarding-actions',()=>({readSmartSetup:h.read,saveSmartBranchSettings:vi.fn(),createSmartBranch:vi.fn(),renameSmartBranch:vi.fn()}));
vi.mock('./use-smart-autosave',()=>({useSmartAccountGuard:()=>()=>h.current,useSmartAutosave:vi.fn()}));
import {SmartSetupBranches} from './smart-setup-branches';
const saved={companyId:'company',revision:2,mode:'single' as const,branches:[{id:'branch',name:'Committed during navigation',primary:true,status:'active' as const}]};
const stale={...saved,revision:1,branches:[{...saved.branches[0],name:'Cached old value'}]};
beforeEach(()=>{h.slots=[];h.cursor=0;h.effects=[];h.current=true;h.read.mockReset();});
const props=()=>({userId:'actor',companyId:'company',locale:'en' as const,setup:stale,onSaved:vi.fn(),onClose:vi.fn()});
function render(p:ReturnType<typeof props>){h.cursor=0;return SmartSetupBranches(p) as ReactElement<{setup?:typeof saved;children?:unknown}>;}
const tick=async()=>{await Promise.resolve();await Promise.resolve();};
describe('branch editor authoritative readback after navigation',()=>{
 it('does not show a cached editor before reading the confirmed settings on reopening',async()=>{const p=props();let finish!:(v:unknown)=>void;h.read.mockImplementation(()=>new Promise(r=>{finish=r;}));expect(render(p).props.setup).toBeUndefined();h.effects[0]();finish({ok:true,data:{branchSetup:saved}});await tick();expect(render(p).props.setup).toEqual(saved);expect(p.onSaved).toHaveBeenCalledWith(saved);});
 it('never exposes cached settings as successful when readback fails',async()=>{const p=props();h.read.mockResolvedValue({ok:false,code:'UNAVAILABLE'});render(p);h.effects[0]();await tick();const tree=render(p);expect(tree.props.setup).toBeUndefined();expect(JSON.stringify(tree)).toContain('Could not read saved branch settings');expect(p.onSaved).not.toHaveBeenCalled();});
 it('ignores a late read after closing the editor or changing account',async()=>{const p=props();let finish!:(v:unknown)=>void;h.read.mockImplementation(()=>new Promise(r=>{finish=r;}));render(p);const cleanup=h.effects[0]();cleanup?.();h.current=false;finish({ok:true,data:{branchSetup:saved}});await tick();expect(p.onSaved).not.toHaveBeenCalled();expect(render(p).props.setup).toBeUndefined();});
});
