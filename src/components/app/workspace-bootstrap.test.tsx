// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {appCopy} from '@/lib/app-copy';
const m=vi.hoisted(()=>({read:vi.fn(),update:vi.fn(),actor:'actor-a',company:'company-a'}));
vi.mock('next/link',()=>({default:'a'}));
vi.mock('next/navigation',()=>({usePathname:()=>'/app/conversations'}));
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({update:m.update,locale:'en'})}));
vi.mock('@/lib/tenancy/actions',()=>({selectWorkspaceCompany:vi.fn()}));
vi.mock('@/lib/tenancy/workspace-view',()=>({getWorkspaceView:m.read}));
vi.mock('./account-chrome',()=>({AccountMenu:()=>null,performLogout:vi.fn(),useOptionalAccountSession:()=>({status:'ready',identity:{companyId:m.company,role:'owner'},isCurrentUser:(id:string)=>id===m.actor})}));
vi.mock('./approved-account-loader',()=>({ApprovedAccountLoader:()=> <p>Loading account</p>}));
vi.mock('./ui',()=>({Button:'button',Notice:'aside',LangSwitch:()=>null,useAppCopy:()=>appCopy('en')}));
vi.mock('./diagnostic-hint',()=>({DiagnosticHint:()=>null}));
vi.mock('./enterprise-presence',()=>({EnterprisePresence:()=>null}));
import {WorkspaceShell} from './workspace-shell';
import {WorkspaceBootstrapProvider,type WorkspaceBootstrap} from './workspace-bootstrap';
const snapshot:WorkspaceBootstrap={identity:{userId:'actor-a',fullName:'Owner',email:'owner@example.test'},workspace:{selectedCompanyId:'company-a',needsContext:false,isPlatformAdmin:false,choices:[{companyId:'company-a',displayName:'Company A',role:'owner'}]},knowledgeAllowed:true};
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();m.actor='actor-a';m.company='company-a';});
it('shows the server-verified workspace without a second blocking read and hides it for another account',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);m.read.mockImplementation(()=>new Promise(()=>{}));
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const view=()=> <WorkspaceBootstrapProvider value={snapshot}><WorkspaceShell title="Inbox"><p>Scoped inbox content</p></WorkspaceShell></WorkspaceBootstrapProvider>;
 try{
  await act(async()=>root.render(view()));
  expect(host.textContent).toContain('Scoped inbox content');expect(host.textContent).toContain('Company A');
  expect(m.read).not.toHaveBeenCalled();
  m.company='company-b';await act(async()=>root.render(view()));
  expect(host.textContent).not.toContain('Scoped inbox content');
  m.company='company-a';
  m.actor='actor-b';await act(async()=>root.render(view()));
  expect(host.textContent).not.toContain('Scoped inbox content');expect(host.textContent).not.toContain('Company A');
 }finally{await act(async()=>root.unmount());host.remove();}
});

it('retains the guarded loader for pages without a server workspace snapshot',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);m.read.mockResolvedValue({ok:true,data:snapshot});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<WorkspaceShell title="Inbox"><p>Scoped content</p></WorkspaceShell>));
  expect(m.read).toHaveBeenCalledOnce();expect(host.textContent).toContain('Scoped content');
 }finally{await act(async()=>root.unmount());host.remove();}
});
