import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';

vi.mock('next/link',()=>({default:'a'}));
vi.mock('next/navigation',()=>({usePathname:()=>'/app/conversations'}));
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:'en'})}));
vi.mock('./ui',()=>({LangSwitch:()=> <button>Language</button>,useAppCopy:()=>({brand:'Velora',app:{nav:{dashboard:'Dashboard'}}})}));
import {WorkspaceFrame} from './workspace-frame';

it('keeps navigation named and account and language reachable in the compact rail',()=>{
 const html=renderToStaticMarkup(<WorkspaceFrame title="Inbox" nav={[{href:'/app/conversations',label:'Conversations',icon:'M0 0'}]} account={<button>Sign out</button>}/>);
 expect(html).toContain('title="Conversations"');
 expect(html).toContain('aria-current="page"');
 expect(html).toContain('<details');
 expect(html).toContain('Account and language');
 expect(html).toContain('Sign out');
 expect(html).toContain('Language');
});
