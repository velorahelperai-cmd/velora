import {Children,isValidElement,type ReactElement} from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
type Slot={value?:unknown;deps?:unknown[];cleanup?:()=>void};
const f=vi.hoisted(()=>({slots:[] as Slot[],cursor:0,effects:[] as (()=>void)[],load:vi.fn(),start:vi.fn(),disconnect:vi.fn(),assign:vi.fn()}));
vi.mock('react',async()=>{const actual=await vi.importActual<typeof import('react')>('react');const slot=()=>f.slots[f.cursor++]??(f.slots[f.cursor-1]={});const effect=(fn:()=>void|(()=>void),deps:unknown[])=>{const s=slot();if(!s.deps||deps.some((v,i)=>!Object.is(v,s.deps![i]))){f.effects.push(()=>{s.cleanup?.();s.cleanup=fn()||undefined;});s.deps=deps;}};return {...actual,
 useState(initial:unknown){const s=slot();if(!('value' in s))s.value=typeof initial==='function'?(initial as ()=>unknown)():initial;return [s.value,(v:unknown)=>{s.value=typeof v==='function'?(v as (p:unknown)=>unknown)(s.value):v;}];},
 useRef(initial:unknown){const s=slot();return s.value??(s.value={current:initial});},useEffect:effect,useLayoutEffect:effect};});
vi.mock('./ui',()=>({Button:()=>null,Notice:()=>null}));
vi.mock('@/lib/instagram/owner-actions',()=>({loadInstagramOwnerConnection:f.load,startInstagramOwnerConnection:f.start,disconnectInstagramOwnerConnection:f.disconnect}));
import {InstagramOwnerConnection} from './instagram-owner-connection';
import {Button} from './ui';
const id=(n:number)=>`abcdefab-0000-4000-8000-${String(n).padStart(12,'0')}`;
let company=id(1);
const status={ok:true,generation:2,link:{linkId:id(3),accountId:'100',generation:1},attemptKind:'bound',contractReady:true,connectEnabled:true};
function render(){f.cursor=0;const tree=InstagramOwnerConnection({companyId:company,ar:false});f.effects.splice(0).forEach(fn=>fn());return tree;}
function nodes(tree:ReactElement):ReactElement<Record<string,unknown>>[]{return [tree as ReactElement<Record<string,unknown>>,...Children.toArray((tree.props as {children?:ReactElement[]}).children).filter(isValidElement).flatMap(n=>nodes(n))];}
const button=(label:string)=>nodes(render()).find(n=>n.type===Button&&n.props.children===label)!;
async function settle(){for(let n=0;n<20;n++)await Promise.resolve();render();}
beforeEach(()=>{for(const s of f.slots)s.cleanup?.();f.slots=[];f.cursor=0;f.effects=[];company=id(1);vi.clearAllMocks();vi.stubGlobal('window',{location:{assign:f.assign}});f.load.mockResolvedValue(status);f.start.mockResolvedValue({ok:true,authorizationUrl:'https://www.instagram.com/oauth/authorize?state=synthetic'});f.disconnect.mockResolvedValue({ok:true});});
it('closed switch disables connect while bound local disconnect remains available',async()=>{f.load.mockResolvedValue({...status,connectEnabled:false});render();await settle();expect(button('Connect Instagram').props.disabled).toBe(true);expect(button('Disconnect from Velora').props.disabled).toBe(false);});
it('a connected callback URL cannot fabricate a stored account after native access denial',async()=>{
 f.load.mockResolvedValue({ok:false,code:'FORBIDDEN'});render();await settle();
 f.cursor=0;const tree=InstagramOwnerConnection({companyId:company,ar:false,callbackResult:'connected'});
 expect(nodes(tree).some(n=>n.props.children==='100')).toBe(false);
 expect(nodes(tree).find(n=>n.type===Button&&n.props.children==='Connect Instagram')?.props.disabled).toBe(true);
 expect(f.start).not.toHaveBeenCalled();
});
it('disconnect uses exact link and current company generation, then reloads native status',async()=>{render();await settle();await (button('Disconnect from Velora').props.onClick as ()=>Promise<void>)();await settle();expect(f.disconnect).toHaveBeenCalledWith({companyId:id(1),linkId:id(3),expectedGeneration:2});expect(f.load).toHaveBeenCalledTimes(2);expect(f.assign).not.toHaveBeenCalled();});
it('a late OAuth start from an old workspace cannot navigate the new workspace',async()=>{let resolve!:(v:unknown)=>void;f.start.mockImplementation(()=>new Promise(r=>resolve=r));render();await settle();const pending=(button('Connect Instagram').props.onClick as ()=>Promise<void>)();company=id(2);render();resolve({ok:true,authorizationUrl:'https://www.instagram.com/oauth/authorize?state=old'});await pending;await settle();expect(f.assign).not.toHaveBeenCalled();});
it('double click reserves only one OAuth start and rejects an unexpected redirect origin',async()=>{let resolve!:(v:unknown)=>void;f.start.mockImplementation(()=>new Promise(r=>resolve=r));render();await settle();const click=button('Connect Instagram').props.onClick as ()=>Promise<void>;const first=click(),second=click();expect(f.start).toHaveBeenCalledTimes(1);resolve({ok:true,authorizationUrl:'https://other.invalid/oauth/authorize'});await Promise.all([first,second]);expect(f.assign).not.toHaveBeenCalled();});
it('unresolved previous exchange blocks connect and old loaded status cannot cross workspace',async()=>{f.load.mockResolvedValue({...status,attemptKind:'unknown'});render();await settle();expect(button('Connect Instagram').props.disabled).toBe(true);const pending:((v:unknown)=>void)[]=[];f.load.mockImplementation(()=>new Promise(r=>pending.push(r)));company=id(2);render();await settle();expect(nodes(render()).some(n=>n.props.children==='100')).toBe(false);company=id(4);render();await settle();pending[0](status);await settle();expect(button('Connect Instagram').props.disabled).toBe(true);});
