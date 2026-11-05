// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useInboxMediaEvidence} from './inbox-media-evidence';
import type {VdiMessage} from './inbox-desktop';
const api=vi.hoisted(()=>({list:vi.fn(),run:vi.fn()}));
vi.mock('@/lib/customer/inbox-extension-actions',()=>({listWhatsappMediaMetadata:api.list,runInboxExtension:api.run}));
const companyId='11111111-1111-4111-8111-111111111111',first='22222222-2222-4222-8222-222222222222',second='33333333-3333-4333-8333-333333333333',messageId='44444444-4444-4444-8444-444444444444',attachmentId='55555555-5555-4555-8555-555555555555';
const row={messageId,attachmentId,filename:'invoice.pdf',mime:'application/pdf',caption:'hello'};
const messages:VdiMessage[]=[{id:messageId,direction:'outgoing',text:'hello',time:''}];
let root:Root,host:HTMLDivElement;
function View({conversationId,paused=false,revision=0}:{conversationId:string;paused?:boolean;revision?:number}){
 const list=useInboxMediaEvidence({companyId,conversationId,channel:'whatsapp',paused,messages,ar:false,revision});
 return <>{list.map(item=><div key={item.id}>{item.text}{item.attachment}</div>)}</>;
}
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);api.list.mockReset();api.run.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('shows only metadata from the current authorized conversation',async()=>{
 let resolveFirst!:(value:unknown)=>void;
 api.list.mockImplementation(({conversationId}:{conversationId:string})=>conversationId===first?new Promise(resolve=>{resolveFirst=resolve;}):Promise.resolve({ok:true,data:[]}));
 await act(async()=>root.render(<View key={first} conversationId={first}/>));
 await act(async()=>root.render(<View key={second} conversationId={second}/>));
 await act(async()=>resolveFirst({ok:true,data:[row]}));
 expect(host.querySelector('button')).toBeNull();
 expect(api.list).toHaveBeenLastCalledWith({companyId,conversationId:second,messageIds:[messageId]});
});
it('reauthorizes a download and refuses mismatched returned metadata',async()=>{
 api.list.mockResolvedValue({ok:true,data:[row]});api.run.mockResolvedValue({ok:true,data:{name:'other.pdf',mime:'application/pdf',base64:'JVBERi0='}});
 const create=vi.fn();vi.stubGlobal('URL',{createObjectURL:create,revokeObjectURL:vi.fn()});
 await act(async()=>root.render(<View conversationId={first}/>));
 await act(async()=>host.querySelector('button')!.click());
 expect(api.run).toHaveBeenCalledWith({companyId,conversationId:first,channel:'whatsapp',action:'download',itemId:attachmentId});
 expect(create).not.toHaveBeenCalled();expect(host.textContent).toContain('Attachment download failed');
});
it('removes attachment evidence after an explicit download denial',async()=>{
 api.list.mockResolvedValue({ok:true,data:[row]});api.run.mockResolvedValue({ok:false,code:'FORBIDDEN'});
 await act(async()=>root.render(<View conversationId={first}/>));
 expect(host.querySelector('button')).not.toBeNull();
 await act(async()=>host.querySelector('button')!.click());
 expect(host.querySelector('button')).toBeNull();
});
it('does not start a download after the conversation is removed',async()=>{
 let resolveDownload!:(value:unknown)=>void;
 api.list.mockResolvedValue({ok:true,data:[row]});api.run.mockImplementation(()=>new Promise(resolve=>{resolveDownload=resolve;}));
 const create=vi.fn();vi.stubGlobal('URL',{createObjectURL:create,revokeObjectURL:vi.fn()});
 await act(async()=>root.render(<View conversationId={first}/>));
 await act(async()=>host.querySelector('button')!.click());
 await act(async()=>root.render(<div/>));
 await act(async()=>resolveDownload({ok:true,data:{name:'invoice.pdf',mime:'application/pdf',base64:'JVBERi0='}}));
 expect(create).not.toHaveBeenCalled();
});
it('hides old evidence while the thread is revalidated',async()=>{
 api.list.mockResolvedValueOnce({ok:true,data:[row]}).mockImplementationOnce(()=>new Promise(()=>{}));
 await act(async()=>root.render(<View conversationId={first}/>));
 expect(host.querySelector('button')).not.toBeNull();
 await act(async()=>root.render(<View conversationId={first} revision={1}/>));
 expect(host.querySelector('button')).toBeNull();
});
it('does not release a pending file after the connection is paused',async()=>{
 let resolveDownload!:(value:unknown)=>void;
 api.list.mockResolvedValue({ok:true,data:[row]});api.run.mockImplementation(()=>new Promise(resolve=>{resolveDownload=resolve;}));
 const create=vi.fn();vi.stubGlobal('URL',{createObjectURL:create,revokeObjectURL:vi.fn()});
 await act(async()=>root.render(<View conversationId={first}/>));
 await act(async()=>host.querySelector('button')!.click());
 await act(async()=>root.render(<View conversationId={first} paused/>));
 await act(async()=>resolveDownload({ok:true,data:{name:'invoice.pdf',mime:'application/pdf',base64:'JVBERi0='}}));
 expect(create).not.toHaveBeenCalled();
});
it('does not release a pending file while the thread is revalidated',async()=>{
 let resolveDownload!:(value:unknown)=>void;
 api.list.mockResolvedValueOnce({ok:true,data:[row]}).mockImplementationOnce(()=>new Promise(()=>{}));
 api.run.mockImplementation(()=>new Promise(resolve=>{resolveDownload=resolve;}));
 const create=vi.fn();vi.stubGlobal('URL',{createObjectURL:create,revokeObjectURL:vi.fn()});
 await act(async()=>root.render(<View conversationId={first}/>));
 await act(async()=>host.querySelector('button')!.click());
 await act(async()=>root.render(<View conversationId={first} revision={1}/>));
 await act(async()=>resolveDownload({ok:true,data:{name:'invoice.pdf',mime:'application/pdf',base64:'JVBERi0='}}));
 expect(create).not.toHaveBeenCalled();
});
it('downloads matching content only after a successful authorized read',async()=>{
 api.list.mockResolvedValue({ok:true,data:[row]});api.run.mockResolvedValue({ok:true,data:{name:'invoice.pdf',mime:'application/pdf',base64:'JVBERi0='}});
 const create=vi.fn((_blob:Blob)=> 'blob:synthetic');vi.stubGlobal('URL',{createObjectURL:create,revokeObjectURL:vi.fn()});
 const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 await act(async()=>root.render(<View conversationId={first}/>));
 await act(async()=>host.querySelector('button')!.click());
 expect(create).toHaveBeenCalledOnce();expect(click).toHaveBeenCalledOnce();
 const blob=create.mock.calls[0]?.[0] as unknown as Blob;expect(blob.type).toBe('application/octet-stream');
});
