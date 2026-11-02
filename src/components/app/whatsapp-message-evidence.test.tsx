// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('@/lib/whatsapp/message-evidence-actions',()=>({readWhatsappMessageEvidence:m.read}));
vi.mock('./ui',()=>({Button:({children,onClick,busy}:{children:React.ReactNode;onClick:()=>void;busy:boolean})=><button onClick={onClick} disabled={busy}>{children}</button>}));
import {WhatsappMessageEvidence} from './whatsapp-message-evidence';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());vi.unstubAllGlobals();});
it('distinguishes actual delivery from historical inbound and does not offer sending',async()=>{
 m.read.mockResolvedValue({ok:true,data:{companyId:'company',linkId:'link',generation:1,latestCompanyInboundAt:null,currentLinkDeliveredAt:'2026-11-01T10:00:00Z'}});
 await act(async()=>root.render(<WhatsappMessageEvidence companyId="company" linkId="link" ar={false}/>));
 expect(host.textContent).toContain('Latest confirmed delivery on the current connection');expect(host.textContent).toContain('No recorded evidence');expect(host.textContent).toContain('does not enable sending');expect(host.querySelectorAll('button')).toHaveLength(1);
});
it('discards a delayed response after scope changes',async()=>{
 let resolve!:(v:unknown)=>void;m.read.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue({ok:false});
 act(()=>root.render(<WhatsappMessageEvidence companyId="old" linkId="link" ar={false}/>));
 await act(async()=>root.render(<WhatsappMessageEvidence companyId="new" linkId="link" ar={false}/>));
 await act(async()=>resolve({ok:true,data:{latestCompanyInboundAt:null,currentLinkDeliveredAt:'2026-11-01T10:00:00Z'}}));
 expect(host.textContent).toContain('could not be verified');expect(host.textContent).not.toContain('Latest confirmed delivery');
});
it('shows Arabic unavailable feedback and allows a retry',async()=>{
 m.read.mockResolvedValue({ok:false});await act(async()=>root.render(<WhatsappMessageEvidence companyId="company" linkId="link" ar/>));
 expect(host.textContent).toContain('تعذّر التحقق');await act(async()=>host.querySelector('button')!.click());expect(m.read).toHaveBeenCalledTimes(2);
});
