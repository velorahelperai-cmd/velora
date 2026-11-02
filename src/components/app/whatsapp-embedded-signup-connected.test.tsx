// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({setup:vi.fn(),disconnect:vi.fn(),start:vi.fn(),locale:'en'}));
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:m.locale})}));
vi.mock('@/lib/whatsapp/embedded-signup-actions',()=>({getEmbeddedSignupSetup:m.setup,startEmbeddedSignup:m.start,completeEmbeddedSignup:vi.fn(),cancelEmbeddedSignup:vi.fn(),disconnectEmbeddedSignup:m.disconnect}));
vi.mock('./whatsapp-coexistence-signup',()=>({WhatsappCoexistenceSignup:()=> <div>Existing app connection</div>}));
vi.mock('next/script',()=>({default:()=>null}));
vi.mock('./ui',()=>({Button:({children,onClick,disabled}:{children:React.ReactNode;onClick:()=>void;disabled?:boolean})=><button disabled={disabled} onClick={onClick}>{children}</button>,Notice:({children}:{children:React.ReactNode})=><div>{children}</div>,Field:({label,children}:{label:string;children:(p:object)=>React.ReactNode})=><label>{label}{children({})}</label>}));
import {WhatsappEmbeddedSignup} from './whatsapp-embedded-signup';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{vi.clearAllMocks();m.locale='en';m.setup.mockResolvedValue({ok:true,appId:'app',configId:'config',graphVersion:'v26.0'});m.disconnect.mockResolvedValue({ok:true});vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());vi.unstubAllGlobals();});
it('keeps disconnect available but hides registration for an already verified connection',async()=>{
 const disconnected=vi.fn();await act(async()=>root.render(<WhatsappEmbeddedSignup companyId="company" connected onDisconnected={disconnected}/>));
 expect(host.textContent).toContain('Manage WhatsApp connection');expect(host.querySelector('input')).toBeNull();expect(host.textContent).not.toContain('Prepare secure connection');expect(m.start).not.toHaveBeenCalled();
 await act(async()=>host.querySelector('button')!.click());expect(m.disconnect).toHaveBeenCalledWith('company');expect(disconnected).toHaveBeenCalledOnce();
});
it('shows registration again when server readback is no longer verified, without starting an attempt',async()=>{
 await act(async()=>root.render(<WhatsappEmbeddedSignup companyId="company" connected/>));
 await act(async()=>root.render(<WhatsappEmbeddedSignup companyId="company" connected={false}/>));
 expect(host.querySelector('input[type="password"]')).not.toBeNull();expect(host.textContent).toContain('Prepare secure connection');expect(m.start).not.toHaveBeenCalled();
});
it('shows the connected management title in Arabic',async()=>{
 m.locale='ar';await act(async()=>root.render(<WhatsappEmbeddedSignup companyId="company" connected/>));
 expect(host.textContent).toContain('إدارة ربط واتساب');expect(host.querySelector('input')).toBeNull();
});
