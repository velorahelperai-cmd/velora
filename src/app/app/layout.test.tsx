import React from 'react';
import {PassThrough} from 'node:stream';
import {renderToPipeableStream} from 'react-dom/server';
import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({access:vi.fn(),capability:vi.fn(),redirect:vi.fn(),returnTo:'/app/conversations'}));
vi.mock('next/headers',()=>({headers:async()=>new Headers({'x-velora-return-path':m.returnTo})}));
vi.mock('next/navigation',()=>({redirect:(href:string)=>{m.redirect(href);throw Error(`REDIRECT:${href}`);}}));
vi.mock('@/lib/tenancy/access',()=>({getCompanyAccess:m.access,loginPathForReturn:(path:string)=>`/login?next=${encodeURIComponent(path)}`}));
vi.mock('@/lib/access/actions',()=>({sessionHasCompanyCapability:m.capability}));
vi.mock('@/components/app/access-gate',()=>({AccessGate:({code}:{code:string})=><p>Access denied: {code}</p>}));
vi.mock('@/components/app/workspace-bootstrap',()=>({WorkspaceBootstrapProvider:({children}:{children:React.ReactNode})=><section>{children}</section>}));
import AppLayout from './layout';
const allowed=()=>({ok:true,context:{userId:'actor',fullName:'Private owner',email:'owner@example.test',needsProfileName:false,isPlatformAdmin:false,needsCompanyContext:false,company:{id:'company'},membership:{role:'owner'},workspaceChoices:[]}});
beforeEach(()=>{vi.clearAllMocks();m.returnTo='/app/conversations';m.capability.mockResolvedValue(false);});

it('streams a public fallback while authority is pending and withholds private children',async()=>{
 let release!:(value:ReturnType<typeof allowed>)=>void;
 m.access.mockReturnValue(new Promise(resolve=>{release=resolve;}));
 const output=new PassThrough();let html='';output.on('data',chunk=>{html+=chunk.toString();});
 const firstChunk=new Promise<void>(resolve=>{output.once('data',()=>resolve());});
 let shell! :()=>void;const shellReady=new Promise<void>(resolve=>{shell=resolve;});
 const complete=new Promise<void>((resolve,reject)=>{output.on('end',resolve);output.on('error',reject);});
 const errors:unknown[]=[];
 const stream=renderToPipeableStream(<html><body><AppLayout><p>PRIVATE_WORKSPACE_CONTENT</p></AppLayout></body></html>,{
  onShellReady(){stream.pipe(output);shell();},onError(error){errors.push(error);},
 });
 try{
  await shellReady;await firstChunk;
  expect(html).toContain('aria-busy="true"');
  expect(html).not.toContain('PRIVATE_WORKSPACE_CONTENT');
  expect(m.capability).not.toHaveBeenCalled();
  release(allowed());await complete;
  expect(errors).toEqual([]);expect(html).toContain('PRIVATE_WORKSPACE_CONTENT');
 }finally{stream.abort();output.destroy();}
});

// Execute the real async authority component to cover redirects/denials without
// treating the streaming fallback or a client-side gate as authorization.
async function workspace(){
 const boundary=AppLayout({children:<p>PRIVATE_WORKSPACE_CONTENT</p>});
 const child=boundary.props.children;
 return child.type(child.props);
}
it.each(['UNAVAILABLE','FORBIDDEN'])('withholds children when access is %s',async code=>{
 m.access.mockResolvedValue({ok:false,code});const view=await workspace();
 expect(view.props.code).toBe(code);expect(view.props.children).toBeUndefined();expect(m.capability).not.toHaveBeenCalled();
});
it.each([
 ['UNAUTHENTICATED','/login?next=%2Fapp%2Fconversations'],
 ['UNVERIFIED','/verify-email?next=%2Fapp%2Fconversations'],
])('preserves the %s redirect',async(code,target)=>{
 m.access.mockResolvedValue({ok:false,code});await expect(workspace()).rejects.toThrow(`REDIRECT:${target}`);
});
it.each([
 [{needsProfileName:true},'/complete-profile?next=%2Fapp%2Fconversations'],
 [{company:null,isPlatformAdmin:true},'/admin'],
 [{company:null,hasBranchMemberships:true},'/branch'],
 [{company:null},'/setup?next=%2Fapp%2Fconversations'],
])('retains workspace admission redirects for %j',async(patch,target)=>{
 const access=allowed();m.access.mockResolvedValue({...access,context:{...access.context,...patch}});
 await expect(workspace()).rejects.toThrow(`REDIRECT:${target}`);
});
it('checks staff knowledge capability before publishing presentation metadata',async()=>{
 const access=allowed();m.access.mockResolvedValue({...access,context:{...access.context,membership:{role:'staff'}}});
 const view=await workspace();expect(m.capability).toHaveBeenCalledWith('company','knowledge.read');
 expect(view.props.value.knowledgeAllowed).toBe(false);
 expect(view.props.value.identity.userId).toBe('actor');
});
