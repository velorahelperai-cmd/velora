import { beforeEach, expect, it, vi } from 'vitest';
const { rpc, access, createClient } = vi.hoisted(() => ({ rpc: vi.fn(), access: vi.fn(), createClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient }));
vi.mock('@/lib/tenancy/access', () => ({ getCompanyAccess: access }));
import { startWhatsappConversation } from './start-conversation';
const companyId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
beforeEach(() => {
  vi.resetAllMocks();
  access.mockResolvedValue({ ok: true, context: { company: { id: companyId }, membership: {} } });
  createClient.mockResolvedValue({ rpc });
});
it('validates the customer number before reading the session', async () => {
  expect(await startWhatsappConversation({ companyId, recipient: '0123' })).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(access).not.toHaveBeenCalled();
});
it('does not use a conversation from another workspace', async () => {
  rpc.mockResolvedValue({ data: { ok: true, company_id: conversationId, conversation_id: conversationId, created: true }, error: null });
  expect(await startWhatsappConversation({ companyId, recipient: '96890000000' })).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(rpc).toHaveBeenCalledWith('whatsapp_start_conversation', { p_company_id: companyId, p_recipient: '96890000000' });
});
it('returns a verified existing or newly created conversation', async () => {
  rpc.mockResolvedValue({ data: { ok: true, company_id: companyId, conversation_id: conversationId, created: false }, error: null });
  expect(await startWhatsappConversation({ companyId, recipient: '96890000000' })).toEqual({ ok: true, conversationId, created: false });
});
it('fails closed when workspace or link authorization is unavailable', async () => {
  access.mockResolvedValueOnce({ ok: true, context: { company: { id: conversationId }, membership: {} } });
  expect(await startWhatsappConversation({ companyId, recipient: '96890000000' })).toEqual({ ok: false, code: 'FORBIDDEN' });
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ data: { ok: false, code: 'connection_unavailable' }, error: null });
  expect(await startWhatsappConversation({ companyId, recipient: '96890000000' })).toEqual({ ok: false, code: 'CONNECTION_UNAVAILABLE' });
});
