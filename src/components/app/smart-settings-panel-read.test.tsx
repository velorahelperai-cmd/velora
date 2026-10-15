import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import {Children,isValidElement,type ReactNode,type ReactElement} from 'react';
const h=vi.hoisted(()=>({slots:[] as unknown[],cursor:0,effects:[] as (()=>(()=>void)|void)[],read:vi.fn(),current:true}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),useState(initial:unknown){const i=h.cursor++;if(!(i in h.slots))h.slots[i]=initial;return [h.slots[i],(v:unknown)=>{h.slots[i]=typeof v==='function'?(v as (old:unknown)=>unknown)(h.slots[i]):v;}];},useEffect(fn:()=>()=>void){h.effects.push(fn);}}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock('@/lib/tenancy/smart-onboarding-actions',()=>({readSmartCompanySettings:h.read,saveSmartCompanySettings:vi.fn()}));
vi.mock('./use-smart-autosave',()=>({useSmartAccountGuard:()=>()=>h.current,useSmartAutosave:vi.fn()}));
vi.mock('./account-chrome',()=>({useOptionalAccountSession:()=>null}));
import {SmartSettingsPanel} from './smart-settings-panel';
import type {CompanyRecord} from '@/lib/tenancy/types';
type ViewProps={children?:ReactNode;record?:unknown;onClick?:()=>void};
const company={id:'company'} as CompanyRecord;
const props=()=>({userId:'actor',company,locale:'en' as const,section:'profile' as const,onSaved:vi.fn(),onClose:vi.fn()});
function render(p:ReturnType<typeof props>){h.cursor=0;const wrapper=SmartSettingsPanel(p) as ReactElement;return (wrapper.type as (p:unknown)=>ReactElement<ViewProps>)(wrapper.props);}
function nodes(root:ReactNode):ReactElement<ViewProps>[]{const out:ReactElement<ViewProps>[]=[];Children.forEach(root,node=>{if(isValidElement<ViewProps>(node)){out.push(node);out.push(...nodes(node.props.children));}});return out;}
const tick=async()=>{await Promise.resolve();await Promise.resolve();};
beforeEach(()=>{vi.useFakeTimers();h.slots=[];h.cursor=0;h.effects=[];h.current=true;h.read.mockReset();});
afterEach(()=>vi.useRealTimers());
describe('profile settings read boundaries',()=>{
 it('always offers a way back while waiting, and only opens the editor with a confirmed receipt',async()=>{const p=props();let finish!:(v:unknown)=>void;h.read.mockImplementation(()=>new Promise(r=>{finish=r;}));let tree=render(p);expect(tree.props.record).toBeUndefined();const back=nodes(tree).find(n=>n.props.onClick===p.onClose);expect(back).toBeDefined();back?.props.onClick?.();expect(p.onClose).toHaveBeenCalledOnce();h.effects[0]();const record={companyId:'company',revision:3};finish({ok:true,data:record});await tick();tree=render(p);expect(tree.props.record).toEqual(record);});
 it('turns a hanging read into an actionable timeout and rejects its late receipt after retry',async()=>{const p=props();let first!:(v:unknown)=>void;h.read.mockImplementationOnce(()=>new Promise(r=>{first=r;})).mockResolvedValueOnce({ok:true,data:{revision:4}});render(p);const cleanup=h.effects[0]();await vi.advanceTimersByTimeAsync(10000);const tree=render(p);expect(JSON.stringify(tree)).toContain('longer than expected');expect(tree.props.record).toBeUndefined();const retry=nodes(tree).find(n=>n.props.children==='Retry');expect(retry).toBeDefined();retry?.props.onClick?.();cleanup?.();h.effects=[];render(p);h.effects[0]();await tick();expect(render(p).props.record).toEqual({revision:4});first({ok:true,data:{revision:1}});await tick();expect(render(p).props.record).toEqual({revision:4});});
 it.each(['FORBIDDEN','UNAVAILABLE'])('shows failure and retry instead of an editable fallback for %s',async code=>{const p=props();h.read.mockResolvedValue({ok:false,code});render(p);h.effects[0]();await tick();const tree=render(p);expect(tree.props.record).toBeUndefined();expect(nodes(tree).some(n=>n.props.children==='Retry')).toBe(true);expect(nodes(tree).some(n=>n.props.onClick===p.onClose)).toBe(true);});
 it('handles a rejected transport read',async()=>{const p=props();h.read.mockRejectedValue(Error('lost'));render(p);h.effects[0]();await tick();expect(nodes(render(p)).some(n=>n.props.children==='Retry')).toBe(true);});
 it('ignores a late receipt after unmount or account change',async()=>{const p=props();let finish!:(v:unknown)=>void;h.read.mockImplementation(()=>new Promise(r=>{finish=r;}));render(p);const cleanup=h.effects[0]();cleanup?.();h.current=false;finish({ok:true,data:{revision:1}});await tick();expect(render(p).props.record).toBeUndefined();});
});
