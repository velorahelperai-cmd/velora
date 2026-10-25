import {afterEach,beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const state=vi.hoisted(()=>({bind:vi.fn()}));
vi.mock('next/headers',()=>({cookies:async()=>({getAll:()=>[]}),headers:vi.fn()}));
vi.mock('@/lib/auth/site-url',()=>({siteUrl:()=> 'https://velora.test'}));
vi.mock('@/lib/auth/broker/continuity',()=>({bindBrowserContinuityFromAnchor:state.bind,continuityArtifactsPresent:()=>false,readContinuityMirror:()=>null}));
vi.mock('next/server',()=>({NextResponse:{json:(body:unknown,opts:{status:number;headers:Record<string,string>})=>new Response(JSON.stringify(body),opts)}}));
import {GET,POST} from '@/app/auth/broker/continuity/route';
const packet={request_id:'VEL-ABCDEFABCDEFABCD',trace_id:'abcdefabcdefabcdefabcdefabcdefab',parent_span_id:'abcdefabcdefabcd'};
const headers={'x-velora-request-id':packet.request_id,'x-velora-trace-id':packet.trace_id,'x-velora-parent-span-id':packet.parent_span_id};
beforeEach(()=>{vi.clearAllMocks();state.bind.mockResolvedValue({ok:true,lineageFingerprint:'synthetic-fingerprint'});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('links first-party continuity checks/enrollment without logging the anchor or cookies',async()=>{
 const info=vi.spyOn(console,'info').mockImplementation(()=>{});expect((await GET(new Request('https://velora.test/auth/broker/continuity',{headers}))).ok).toBe(true);
 expect((await POST(new Request('https://velora.test/auth/broker/continuity',{method:'POST',headers:{...headers,origin:'https://velora.test','content-type':'application/json'},body:JSON.stringify({anchor:'private-anchor-value',protocolVersion:2})}))).ok).toBe(true);
 const rows=info.mock.calls.map(([line])=>JSON.parse(String(line)));expect(rows.filter(r=>r.code==='OK')).toHaveLength(2);expect(rows.every(r=>r.request_id===packet.request_id&&r.trace_id===packet.trace_id)).toBe(true);expect(JSON.stringify(rows)).not.toContain('private-anchor-value');
});
it('valid diagnostic headers never authorize a foreign-origin enrollment',async()=>{
 const info=vi.spyOn(console,'info').mockImplementation(()=>{});const result=await POST(new Request('https://velora.test/auth/broker/continuity',{method:'POST',headers:{...headers,origin:'https://foreign.test'},body:'{}'}));expect(result.status).toBe(403);expect(state.bind).not.toHaveBeenCalled();expect(JSON.stringify(info.mock.calls)).toContain('FORBIDDEN');
});

it('client sends the same bounded metadata on both continuity HTTP hops',async()=>{
 const store=new Map<string,string>();const storage={getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value);},removeItem:(key:string)=>{store.delete(key);}};
 const windowValue={isSecureContext:true,top:null as unknown,self:null as unknown};windowValue.top=windowValue;windowValue.self=windowValue;vi.stubGlobal('window',windowValue);vi.stubGlobal('location',{protocol:'http:',hostname:'localhost'});vi.stubGlobal('localStorage',storage);vi.stubGlobal('sessionStorage',storage);
 let cookie='';vi.stubGlobal('document',{get cookie(){return cookie;},set cookie(value:string){cookie=value.split(';')[0];}});vi.stubGlobal('navigator',{locks:{request:async(_name:unknown,_opts:unknown,fn:()=>Promise<unknown>)=>fn()}});
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({ok:true,protocolVersion:2,hasArtifacts:false})));vi.stubGlobal('fetch',fetcher);
 const {ensureBrowserContinuity}=await import('./browser-continuity');expect(await ensureBrowserContinuity('signup',packet)).toMatchObject({ok:true});expect(fetcher).toHaveBeenCalledTimes(2);
 for(const call of fetcher.mock.calls as unknown as Array<[string,RequestInit]>){const sent=new Headers(call[1].headers);expect(sent.get('x-velora-request-id')).toBe(packet.request_id);expect(sent.get('x-velora-trace-id')).toBe(packet.trace_id);expect(sent.get('x-velora-parent-span-id')).toBe(packet.parent_span_id);}
});
