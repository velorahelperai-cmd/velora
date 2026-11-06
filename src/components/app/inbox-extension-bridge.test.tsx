// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { InboxDesktopView } from './inbox-desktop';

const api = vi.hoisted(() => ({ run: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/customer/inbox-extension-actions', () => ({ runInboxExtension: api.run, removeUnboundWhatsappFile:api.remove, listInboxStars: vi.fn(async () => ({ ok: true, data: [] })) }));
import { InboxExtensionBridge } from './inbox-extension-bridge';
import { InboxDesktop } from './inbox-desktop';

const companyId = '11111111-1111-4111-8111-111111111111';
const first = '22222222-2222-4222-8222-222222222222';
const second = '33333333-3333-4333-8333-333333333333';
let container: HTMLDivElement, root: Root;
function view(id: string, paused = false): InboxDesktopView {
  return { state: 'ready', scopeKey: 'company:actor', extension: { companyId, conversationId: id, channel: 'whatsapp', canEdit: true, paused },
    customer: { name: 'Customer', initials: 'C', channel: 'whatsapp' }, messages: [], conversations: [],
    query: '', onQueryChange: () => {}, tabs: [], activeTab: 'all', onTabChange: () => {}, onSelect: () => {} };
}
function show(id: string, paused = false) {
  const v = view(id, paused);
  root.render(<InboxExtensionBridge key={`${id}:${paused}`} view={v} ar={false} render={model => <>
    <button type="button" disabled={model.headerActions?.find(a => a.id === 'star')?.disabled} onClick={model.headerActions?.find(a => a.id === 'star')?.onClick}>star</button>
    <button type="button" disabled={model.addTag?.disabled} onClick={model.addTag?.onClick}>tag</button>
    <div data-tags>{model.customer?.tags?.map(tag => tag.label).join(',')}</div>{model.tagControls}{model.customerExtra}
  </>}/>);
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); api.run.mockReset();api.remove.mockReset(); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('does not display a late response from the previously selected conversation', async () => {
  let resolveFirst!: (value: unknown) => void;
  api.run.mockImplementation(({ conversationId }: { conversationId: string }) => conversationId === first
    ? new Promise(resolve => { resolveFirst = resolve; })
    : Promise.resolve({ ok: true, data: [{ id: second, kind: 'tag', body: 'Second' }] }));
  await act(async () => { show(first); });
  await act(async () => { show(second); });
  await act(async () => { resolveFirst({ ok: true, data: [{ id: first, kind: 'tag', body: 'First' }] }); });
  expect(container.querySelector('[data-tags]')?.textContent).toBe('Second');
});

it('writes a star to the selected conversation and rereads saved state', async () => {
  api.run.mockResolvedValueOnce({ ok: true, data: [] }).mockResolvedValueOnce({ ok: true, data: first })
    .mockResolvedValueOnce({ ok: true, data: [{ id: first, kind: 'star', body: null }] });
  await act(async () => { show(first); });
  await act(async () => { container.querySelector('button')!.click(); });
  expect(api.run).toHaveBeenNthCalledWith(2, { companyId, conversationId: first, channel: 'whatsapp', action: 'star' });
  expect(api.run).toHaveBeenNthCalledWith(3, { companyId, conversationId: first, channel: 'whatsapp', action: 'list' });
});

it('invalidates the list only after a confirmed star mutation', async () => {
  const onStarChanged=vi.fn();
  const v=view(first);v.onStarChanged=onStarChanged;
  api.run.mockResolvedValueOnce({ ok:true, data:[] }).mockResolvedValueOnce({ ok:true, data:first })
    .mockResolvedValueOnce({ ok:true, data:[{id:first,kind:'star',body:null}] });
  await act(async()=>root.render(<InboxExtensionBridge view={v} ar={false} render={model=><button onClick={model.headerActions?.find(action=>action.id==='star')?.onClick}>Star</button>}/>));
  await act(async()=>{container.querySelector('button')!.click();});
  expect(onStarChanged).toHaveBeenCalledTimes(1);
});

it('saves a tag against the selected conversation and shows the reread result', async () => {
  api.run.mockResolvedValueOnce({ ok: true, data: [] }).mockResolvedValueOnce({ ok: true, data: first })
    .mockResolvedValueOnce({ ok: true, data: [{ id: first, kind: 'tag', body: 'Follow-up' }] });
  await act(async () => { show(second); });
  await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'tag')!.click(); });
  const input = container.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Follow-up');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(api.run.mock.calls[1]?.[0]).toMatchObject({ companyId, conversationId: second, channel: 'whatsapp', action: 'tag', body: 'Follow-up' });
  expect(container.querySelector('[data-tags]')?.textContent).toBe('Follow-up');
});

it('keeps controls disabled if the database read fails or the connection is paused', async () => {
  api.run.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
  await act(async () => { show(first); });
  expect([...container.querySelectorAll('button')].slice(0, 2).every(button => button.disabled)).toBe(true);
  expect(container.textContent).toContain('could not be verified');
  await act(async () => { show(second, true); });
  expect([...container.querySelectorAll('button')].slice(0, 2).every(button => button.disabled)).toBe(true);
  expect(api.run).toHaveBeenCalledTimes(1);
});

it('clears saved details and disables further actions when a write is denied', async () => {
  api.run.mockResolvedValueOnce({ ok: true, data: [{ id: first, kind: 'tag', body: 'Private' }] })
    .mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
  await act(async () => { show(first); });
  expect(container.querySelector('[data-tags]')?.textContent).toBe('Private');
  await act(async () => { container.querySelector('button')!.click(); });
  expect(container.querySelector('[data-tags]')?.textContent).toBe('');
  expect([...container.querySelectorAll('button')].slice(0, 2).every(button => button.disabled)).toBe(true);
});

it('saves an Instagram internal note to that thread without using the send action', async () => {
  api.run.mockResolvedValueOnce({ ok: true, data: [] }).mockResolvedValueOnce({ ok: true, data: first })
    .mockResolvedValueOnce({ ok: true, data: [{ id: first, kind: 'note', body: 'Private' }] });
  const v = view(first);
  v.extension = { companyId, conversationId: first, channel: 'instagram', canEdit: true, paused: false };
  v.customer = { name: 'Customer', initials: 'C', channel: 'instagram' };
  v.composer = { mode: 'note', enabledModes: ['message'], onModeChange: () => {}, canSend: true, value: '', onChange: () => {}, onSubmit: () => {} };
  await act(async () => root.render(<InboxExtensionBridge view={v} ar={false} render={model => <>{model.composer?.modePanels?.note}<span data-note>{model.customer?.note?.text}</span></>}/>));
  const textarea = container.querySelector('textarea')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(textarea, 'Private'); textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(api.run.mock.calls[1]?.[0]).toMatchObject({ companyId, conversationId: first, channel: 'instagram', action: 'note', body: 'Private' });
  expect(container.querySelector('[data-note]')?.textContent).toBe('Private');
});

it('retries an uncertain note with the same id and body', async () => {
  api.run.mockResolvedValueOnce({ ok: true, data: [] }).mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
    .mockResolvedValueOnce({ ok: true, data: [] }).mockResolvedValueOnce({ ok: true, data: first })
    .mockResolvedValueOnce({ ok: true, data: [] });
  const v = view(first);
  v.extension = { companyId, conversationId: first, channel: 'instagram', canEdit: true, paused: false };
  v.composer = { mode: 'note', enabledModes: ['message'], onModeChange: () => {}, canSend: true, value: '', onChange: () => {}, onSubmit: () => {} };
  await act(async () => root.render(<InboxExtensionBridge view={v} ar={false} render={model => <>{model.tagControls}{model.composer?.modePanels?.note}</>}/>));
  const textarea = container.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'One note');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const submit = () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await act(async () => { submit(); });
  expect(textarea.readOnly).toBe(true);
  await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Retry')!.click(); });
  await act(async () => { submit(); });
  expect(api.run.mock.calls[1]?.[0]).toEqual(api.run.mock.calls[3]?.[0]);
});

it('retains an unresolved note intent when switching away and back', async () => {
  let resolveWrite!: (value: unknown) => void;
  api.run.mockImplementation(({ action }: { action: string }) => action === 'note'
    ? new Promise(resolve => { resolveWrite = resolve; }) : Promise.resolve({ ok: true, data: [] }));
  function instagram(id: string) {
    const v = view(id);
    v.extension = { companyId, conversationId: id, channel: 'instagram', canEdit: true, paused: false };
    v.customer = { name: 'Customer', initials: 'C', channel: 'instagram' };
    v.composer = { mode: 'note', enabledModes: ['message'], onModeChange: () => {}, canSend: true, value: '', onChange: () => {}, onSubmit: () => {} };
    return v;
  }
  await act(async () => root.render(<InboxDesktop view={instagram(first)} locale="en"/>));
  const textarea = container.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Pending note');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  const original = api.run.mock.calls.find(call => call[0].action === 'note')![0];
  await act(async () => root.render(<InboxDesktop view={instagram(second)} locale="en"/>));
  await act(async () => root.render(<InboxDesktop view={instagram(first)} locale="en"/>));
  const restored = container.querySelector('textarea')!;
  expect(restored.value).toBe('Pending note');
  expect(restored.readOnly).toBe(true);
  await act(async () => { resolveWrite({ ok: false, code: 'UNAVAILABLE' }); });
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  const writes = api.run.mock.calls.filter(call => call[0].action === 'note');
  expect(writes[1]?.[0]).toEqual(original);
});

it('inserts a saved quick reply at the draft selection without sending', async () => {
  api.run.mockResolvedValue({ ok:true, data:[{id:first,kind:'quick',body:'Welcome'}] });
  const send=vi.fn();
  function Harness(){
    const [draft,setDraft]=React.useState('Hello there');
    const v=view(first);
    v.composer={mode:'message',enabledModes:['message'],onModeChange:()=>{},value:draft,onChange:setDraft,onSubmit:send,canSend:true};
    return <InboxDesktop view={v} locale="en"/>;
  }
  await act(async()=>root.render(<Harness/>));
  const draft=container.querySelector<HTMLTextAreaElement>('textarea[data-message-input]')!;
  draft.setSelectionRange(6,11);
  await act(async()=>{container.querySelector<HTMLButtonElement>('[aria-label="Quick replies"]')!.click();});
  await act(async()=>{[...container.querySelectorAll('button')].find(button=>button.textContent==='Welcome')!.click();});
  expect(draft.value).toBe('Hello Welcome');
  expect(send).not.toHaveBeenCalled();
});

it('saves a quick reply for the selected conversation', async () => {
  api.run.mockResolvedValueOnce({ok:true,data:[]}).mockResolvedValueOnce({ok:true,data:first})
    .mockResolvedValueOnce({ok:true,data:[{id:first,kind:'quick',body:'Thanks'}]});
  const v=view(second);
  v.composer={mode:'message',enabledModes:['message'],onModeChange:()=>{},value:'',onChange:()=>{},onSubmit:()=>{},canSend:true};
  await act(async()=>root.render(<InboxDesktop view={v} locale="en"/>));
  await act(async()=>{container.querySelector<HTMLButtonElement>('[aria-label="Quick replies"]')!.click();});
  const input=container.querySelector<HTMLTextAreaElement>('.vdi-quick-panel textarea')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Thanks');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>{[...container.querySelectorAll('button')].find(button=>button.textContent==='Save reply')!.click();});
  expect(api.run.mock.calls[1]?.[0]).toMatchObject({companyId,conversationId:second,channel:'whatsapp',action:'quick',body:'Thanks'});
  expect(container.textContent).toContain('Thanks');
});

it('reuses the same quick reply id after an uncertain save', async () => {
  api.run.mockResolvedValueOnce({ok:true,data:[]}).mockResolvedValueOnce({ok:false,code:'UNAVAILABLE'})
    .mockResolvedValueOnce({ok:true,data:[]}).mockResolvedValueOnce({ok:true,data:first})
    .mockResolvedValueOnce({ok:true,data:[]});
  const v=view(first);
  v.composer={mode:'message',enabledModes:['message'],onModeChange:()=>{},value:'',onChange:()=>{},onSubmit:()=>{},canSend:true};
  await act(async()=>root.render(<InboxDesktop view={v} locale="en"/>));
  await act(async()=>{container.querySelector<HTMLButtonElement>('[aria-label="Quick replies"]')!.click();});
  const input=container.querySelector<HTMLTextAreaElement>('.vdi-quick-panel textarea')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Thanks');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>{[...container.querySelectorAll('button')].find(button=>button.textContent==='Save reply')!.click();});
  await act(async()=>{[...container.querySelectorAll('button')].find(button=>button.textContent==='Retry')!.click();});
  expect(container.querySelector<HTMLTextAreaElement>('.vdi-quick-panel textarea')?.readOnly).toBe(true);
  await act(async()=>{[...container.querySelectorAll('button')].find(button=>button.textContent==='Save reply')!.click();});
  expect(api.run.mock.calls[3]?.[0]).toEqual(api.run.mock.calls[1]?.[0]);
});

it('stores a selected attachment in this thread before submitting it for sending',async()=>{
  const submit=vi.fn();let savedId='';
  api.run.mockImplementation(async (input:{action:string;itemId?:string})=>{
    if(input.action==='list')return {ok:true,data:savedId?[{id:savedId,kind:'file',body:'proof.pdf'}]:[]};
    if(input.action==='file'){savedId=input.itemId!;return {ok:true,data:savedId};}
    return {ok:false,code:'UNAVAILABLE'};
  });
  const v=view(first);v.composer={mode:'message',enabledModes:['message'],onModeChange:()=>{},value:'Caption',onChange:()=>{},onSubmit:vi.fn(),onSubmitAttachment:submit,canSend:true};
  await act(async()=>root.render(<InboxDesktop view={v} locale="en"/>));
  const picker=container.querySelector<HTMLInputElement>('input[aria-label="Choose file"]')!;
  const content=new Uint8Array([37,80,68,70,45]);const file=new File([content],'proof.pdf',{type:'application/pdf'});
  Object.defineProperty(file,'arrayBuffer',{value:async()=>content.buffer});Object.defineProperty(picker,'files',{configurable:true,value:[file]});
  await act(async()=>picker.dispatchEvent(new Event('change',{bubbles:true})));
  const call=api.run.mock.calls.find(entry=>entry[0].action==='file')?.[0];
  expect(call).toMatchObject({companyId,conversationId:first,channel:'whatsapp',body:'proof.pdf',mime:'application/pdf',base64:'JVBERi0='});
  expect(container.textContent).toContain('Attachment: proof.pdf');
  await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(submit).toHaveBeenCalledWith(savedId,expect.any(Function));
  await act(async()=>{submit.mock.calls[0]![1]();});
  expect(container.textContent).not.toContain('Attachment: proof.pdf');
});
it('does not send the caption as text when attachment preparation fails',async()=>{
  api.run.mockResolvedValueOnce({ok:true,data:[]}).mockResolvedValueOnce({ok:false,code:'UNAVAILABLE'});
  const send=vi.fn(),sendFile=vi.fn();const v=view(first);
  v.composer={mode:'message',enabledModes:['message'],onModeChange:()=>{},value:'Caption',onChange:()=>{},onSubmit:send,onSubmitAttachment:sendFile,canSend:true};
  await act(async()=>root.render(<InboxDesktop view={v} locale="en"/>));
  const picker=container.querySelector<HTMLInputElement>('input[aria-label="Choose file"]')!;
  const content=new Uint8Array([37,80,68,70,45]);const file=new File([content],'proof.pdf',{type:'application/pdf'});
  Object.defineProperty(file,'arrayBuffer',{value:async()=>content.buffer});Object.defineProperty(picker,'files',{configurable:true,value:[file]});
  await act(async()=>picker.dispatchEvent(new Event('change',{bubbles:true})));
  const button=container.querySelector<HTMLButtonElement>('button[type="submit"].vdi-send')!;
  expect(button.disabled).toBe(true);
  await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(send).not.toHaveBeenCalled();expect(sendFile).not.toHaveBeenCalled();
});
it('retries uncertain attachment storage with the same file operation',async()=>{
  let fileCalls=0;let savedId='';
  api.run.mockImplementation(async(input:{action:string;itemId?:string})=>{
    if(input.action==='list')return {ok:true,data:savedId?[{id:savedId,kind:'file',body:'proof.pdf'}]:[]};
    if(input.action==='file'){fileCalls++;if(fileCalls===1)return {ok:false,code:'UNAVAILABLE'};savedId=input.itemId!;return {ok:true,data:savedId};}
    return {ok:false,code:'UNAVAILABLE'};
  });
  const sendFile=vi.fn();const v=view(first);v.composer={mode:'message',enabledModes:['message'],onModeChange:()=>{},value:'Caption',onChange:()=>{},onSubmit:vi.fn(),onSubmitAttachment:sendFile,canSend:true};
  await act(async()=>root.render(<InboxDesktop view={v} locale="en"/>));
  const picker=container.querySelector<HTMLInputElement>('input[aria-label="Choose file"]')!;
  const bytes=new Uint8Array([37,80,68,70,45]);const file=new File([bytes],'proof.pdf',{type:'application/pdf'});
  Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes.buffer});Object.defineProperty(picker,'files',{configurable:true,value:[file]});
  await act(async()=>picker.dispatchEvent(new Event('change',{bubbles:true})));
  await act(async()=>[...container.querySelectorAll('button')].find(button=>button.textContent==='Retry')!.click());
  await act(async()=>[...container.querySelectorAll('button')].find(button=>button.textContent==='Retry')!.click());
  const writes=api.run.mock.calls.filter(call=>call[0].action==='file');
  expect(writes).toHaveLength(2);expect(writes[1]?.[0]).toEqual(writes[0]?.[0]);
  await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(sendFile).toHaveBeenCalledWith(savedId,expect.any(Function));
});
it('retains a bound file on denial and removes it only after authorized confirmation',async()=>{
  let savedId='';api.remove.mockResolvedValueOnce({ok:false,code:'IN_USE'}).mockImplementationOnce(async()=>{savedId='';return {ok:true};});
  api.run.mockImplementation(async(input:{action:string;itemId?:string})=>{
    if(input.action==='list')return {ok:true,data:savedId?[{id:savedId,kind:'file',body:'proof.pdf'}]:[]};
    if(input.action==='file'){savedId=input.itemId!;return {ok:true,data:savedId};}
    return {ok:false,code:'UNAVAILABLE'};
  });
  const v=view(first);v.composer={mode:'message',enabledModes:['message'],onModeChange:()=>{},value:'Caption',onChange:()=>{},onSubmit:vi.fn(),onSubmitAttachment:vi.fn(),canSend:true};
  await act(async()=>root.render(<InboxDesktop view={v} locale="en"/>));
  const picker=container.querySelector<HTMLInputElement>('input[aria-label="Choose file"]')!;
  const bytes=new Uint8Array([37,80,68,70,45]);const file=new File([bytes],'proof.pdf',{type:'application/pdf'});
  Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes.buffer});Object.defineProperty(picker,'files',{configurable:true,value:[file]});
  await act(async()=>picker.dispatchEvent(new Event('change',{bubbles:true})));
  const id=savedId;
  await act(async()=>[...container.querySelectorAll('button')].find(button=>button.textContent==='Remove')!.click());
  expect(api.remove).toHaveBeenCalledWith({companyId,conversationId:first,fileId:id});
  expect(container.textContent).toContain('Attachment: proof.pdf');
  await act(async()=>[...container.querySelectorAll('button')].find(button=>button.textContent==='Remove')!.click());
  expect(container.textContent).not.toContain('Attachment: proof.pdf');
});
it('offers cleanup only for files marked unbound by the server',async()=>{
  const orphan='77777777-7777-4777-8777-777777777777',bound='88888888-8888-4888-8888-888888888888';
  api.run.mockResolvedValueOnce({ok:true,data:[{id:orphan,kind:'file',body:'draft.pdf',removable:true},{id:bound,kind:'file',body:'sent.pdf',removable:false}]})
    .mockResolvedValueOnce({ok:true,data:[{id:bound,kind:'file',body:'sent.pdf',removable:false}]});
  api.remove.mockResolvedValue({ok:true});const v=view(first);
  await act(async()=>root.render(<InboxDesktop view={v} locale="en"/>));
  expect(container.textContent).toContain('Delete: draft.pdf');expect(container.textContent).not.toContain('Delete: sent.pdf');
  await act(async()=>[...container.querySelectorAll('button')].find(button=>button.textContent==='Delete: draft.pdf')!.click());
  expect(api.remove).toHaveBeenCalledWith({companyId,conversationId:first,fileId:orphan});
  expect(container.textContent).not.toContain('Delete: draft.pdf');
});
