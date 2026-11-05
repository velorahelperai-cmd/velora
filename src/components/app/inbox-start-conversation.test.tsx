// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('@/lib/whatsapp/start-conversation', () => ({ startWhatsappConversation: api.start }));
import { InboxStartConversation } from './inbox-start-conversation';
let root: Root, container: HTMLDivElement;
const companyId='11111111-1111-4111-8111-111111111111', conversationId='22222222-2222-4222-8222-222222222222';
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable:true, value:vi.fn() });
  api.start.mockReset(); container=document.createElement('div'); document.body.append(container); root=createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('opens only the conversation confirmed by the server', async () => {
  const created=vi.fn(); api.start.mockResolvedValue({ok:true,conversationId,created:true});
  await act(async()=>root.render(<InboxStartConversation companyId={companyId} ar={false} enabled onClose={()=>{}} onCreated={created}/>));
  const input=container.querySelector('input')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'+96890000000');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(api.start).toHaveBeenCalledWith({companyId,recipient:'96890000000'});
  expect(created).toHaveBeenCalledWith(conversationId);
});
it('does not navigate after access is suspended during creation', async () => {
  let resolve!: (value: unknown)=>void;
  api.start.mockReturnValue(new Promise(r=>{resolve=r;}));const created=vi.fn();
  const show=(enabled:boolean)=>root.render(<InboxStartConversation companyId={companyId} ar={false} enabled={enabled} onClose={()=>{}} onCreated={created}/>);
  await act(async()=>show(true));const input=container.querySelector('input')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'96890000000');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await act(async()=>show(false));await act(async()=>resolve({ok:true,conversationId,created:true}));
  expect(created).not.toHaveBeenCalled();
});
it('allows retry when the request fails before a result is received', async () => {
  api.start.mockRejectedValue(new Error('offline'));
  await act(async()=>root.render(<InboxStartConversation companyId={companyId} ar={false} enabled onClose={()=>{}} onCreated={()=>{}}/>));
  const input=container.querySelector('input')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'96890000000');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(container.querySelector('[role=alert]')?.textContent).toContain('Could not start');
  expect(container.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(false);
});
