import { beforeEach, expect, it, vi } from 'vitest';

const { rpc, access, createClient } = vi.hoisted(() => ({
  rpc: vi.fn(), access: vi.fn(), createClient: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient }));
vi.mock('@/lib/tenancy/access', () => ({ getCompanyAccess: access }));

import { listInboxStars, listWhatsappMediaMetadata, removeUnboundWhatsappFile, runInboxExtension } from './inbox-extension-actions';

const companyId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const thread = { companyId, conversationId, channel: 'instagram' as const };

beforeEach(() => {
  vi.resetAllMocks();
  access.mockResolvedValue({ ok: true, context: { company: { id: companyId }, membership: {} } });
  createClient.mockResolvedValue({ rpc });
});

it('does not call the database for a mismatched workspace', async () => {
  expect(await runInboxExtension({ ...thread, companyId: itemId, action: 'star' }))
    .toEqual({ ok: false, code: 'FORBIDDEN' });
  expect(createClient).not.toHaveBeenCalled();
});

it('rejects invalid types and oversized file payloads before opening a session', async () => {
  const file = { ...thread, action: 'file' as const, itemId, body: 'document.pdf' };
  expect(await runInboxExtension({ ...file, mime: 'text/html', base64: 'abcd' }))
    .toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(await runInboxExtension({ ...file, mime: 'application/pdf', base64: 'a'.repeat(699053) }))
    .toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(access).not.toHaveBeenCalled();
});

it('only admits signed supported attachment content to the authorized RPC', async () => {
  const file = { ...thread, action: 'file' as const, itemId, body: 'invoice.pdf', mime: 'application/pdf' };
  expect(await runInboxExtension({ ...file, base64: 'iVBORw0KGgo=' })).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(access).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ data: { ok: true, data: itemId }, error: null });
  expect(await runInboxExtension({ ...file, base64: 'JVBERi0=' })).toEqual({ ok: true, data: itemId });
  expect(rpc).toHaveBeenCalledOnce();
});

it('rejects malformed quick reply payloads before opening a session', async () => {
  const malformed = { ...thread, action: 'quick', itemId } as unknown as Parameters<typeof runInboxExtension>[0];
  expect(await runInboxExtension(malformed)).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(await runInboxExtension({ ...thread, action: 'quick', itemId, body: 'x'.repeat(251) })).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(access).not.toHaveBeenCalled();
});

it('writes an Instagram note only through the session-scoped internal RPC', async () => {
  rpc.mockResolvedValue({ data: { ok: true, data: itemId }, error: null });
  expect(await runInboxExtension({ ...thread, action: 'note', itemId, body: 'Internal handoff' }))
    .toEqual({ ok: true, data: itemId });
  expect(rpc).toHaveBeenCalledExactlyOnceWith('customer_inbox_extension', {
    p_company_id: companyId, p_conversation_id: conversationId, p_channel: 'instagram',
    p_action: 'note', p_item_id: itemId, p_body: 'Internal handoff', p_mime: null, p_base64: null,
  });
});

it('does not return data on RPC denial or malformed success', async () => {
  rpc.mockResolvedValueOnce({ data: { ok: false, code: 'FORBIDDEN', data: 'private' }, error: null })
    .mockResolvedValueOnce({ data: { ok: true }, error: null });
  expect(await runInboxExtension({ ...thread, action: 'list' })).toEqual({ ok: false, code: 'FORBIDDEN' });
  expect(await runInboxExtension({ ...thread, action: 'list' })).toEqual({ ok: false, code: 'UNAVAILABLE' });
});

it('only accepts stars belonging to the requested bounded conversation set', async () => {
  rpc.mockResolvedValueOnce({ data: { ok: true, data: [conversationId] }, error: null })
    .mockResolvedValueOnce({ data: { ok: true, data: [itemId] }, error: null });
  const input = { companyId, channel: 'instagram' as const, conversationIds: [conversationId, conversationId] };
  expect(await listInboxStars(input)).toEqual({ ok: true, data: [conversationId] });
  expect(rpc).toHaveBeenCalledWith('customer_inbox_star_batch', { p_company_id: companyId, p_channel: 'instagram', p_conversation_ids: [conversationId] });
  expect(await listInboxStars(input)).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(await listInboxStars({ ...input, conversationIds: Array(41).fill(conversationId) })).toEqual({ ok: false, code: 'INVALID_INPUT' });
});

it('only returns attachment metadata for requested message IDs in the authorized workspace', async () => {
  const input={companyId,conversationId,messageIds:[itemId,itemId]};
  const row={messageId:itemId,attachmentId:conversationId,filename:'proof.pdf',mime:'application/pdf',caption:'hello'};
  rpc.mockResolvedValueOnce({data:{ok:true,data:[row]},error:null}).mockResolvedValueOnce({data:{ok:true,data:[{...row,messageId:companyId}]},error:null});
  expect(await listWhatsappMediaMetadata(input)).toEqual({ok:true,data:[row]});
  expect(rpc).toHaveBeenCalledWith('whatsapp_media_message_metadata',{p_company_id:companyId,p_conversation_id:conversationId,p_message_ids:[itemId]});
  expect(await listWhatsappMediaMetadata(input)).toEqual({ok:false,code:'UNAVAILABLE'});
  expect(await listWhatsappMediaMetadata({...input,messageIds:Array(41).fill(itemId)})).toEqual({ok:false,code:'INVALID_INPUT'});
});
it('only removes an unbound file through the session-scoped conversation RPC',async()=>{
  rpc.mockResolvedValueOnce({data:{ok:false,code:'in_use'},error:null}).mockResolvedValueOnce({data:{ok:true},error:null});
  const input={companyId,conversationId,fileId:itemId};
  expect(await removeUnboundWhatsappFile(input)).toEqual({ok:false,code:'IN_USE'});
  expect(await removeUnboundWhatsappFile(input)).toEqual({ok:true});
  expect(rpc).toHaveBeenCalledWith('customer_inbox_remove_unbound_file',{p_company_id:companyId,p_conversation_id:conversationId,p_file_id:itemId});
});
