// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';

vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:'ar'})}));
vi.mock('./workspace-shell',()=>({WorkspaceShell:({title,children}:{title:string;children:React.ReactNode})=><main><h1>{title}</h1>{children}</main>}));
import {InboxLoadingFrame} from './conversations-entry';

let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});

it('mounts the inbox columns while the authorized read is still running',()=>{
 act(()=>{root.render(<InboxLoadingFrame/>);});
 expect(host.querySelector('h1')?.textContent).toBe('المحادثات');
 expect(host.querySelector('[data-inbox-panel="list"]')).not.toBeNull();
 expect(host.querySelector('[data-inbox-panel="thread"]')).not.toBeNull();
 expect(host.querySelector('[data-inbox-panel="customer"]')).not.toBeNull();
 expect(host.querySelector('input[aria-label="البحث في المحادثات والعملاء"]')).not.toBeNull();
 expect(host.textContent).toContain('الكل');
 expect(host.textContent).toContain('غير مسند');
 expect(host.textContent).toContain('مسند لي');
});
