'use server';

import { createClient } from '@/lib/supabase/server';
import { getCompanyAccess } from '@/lib/tenancy/access';

const uuid = (value: unknown): value is string => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function startWhatsappConversation(input: { companyId: string; recipient: string }) {
  if (!input || !uuid(input.companyId) || typeof input.recipient !== 'string' || !/^[1-9][0-9]{6,14}$/.test(input.recipient)) {
    return { ok: false as const, code: 'INVALID_INPUT' };
  }
  const company = input.companyId.toLowerCase();
  try {
    const access = await getCompanyAccess();
    if (!access.ok || access.context.company?.id !== company || !access.context.membership) return { ok: false as const, code: 'FORBIDDEN' };
    const client = await createClient() as unknown as { rpc(name: string, args: { p_company_id: string; p_recipient: string }): Promise<{ data: unknown; error: unknown }> };
    const { data, error } = await client.rpc('whatsapp_start_conversation', { p_company_id: company, p_recipient: input.recipient });
    if (error || !data || typeof data !== 'object' || !('ok' in data)) return { ok: false as const, code: 'UNAVAILABLE' };
    if (data.ok === true && 'company_id' in data && data.company_id === company && 'conversation_id' in data && uuid(data.conversation_id) &&
        'created' in data && typeof data.created === 'boolean') {
      return { ok: true as const, conversationId: data.conversation_id.toLowerCase(), created: data.created };
    }
    if (data.ok === false && 'code' in data && typeof data.code === 'string') {
      const code = data.code === 'invalid_input' ? 'INVALID_INPUT' : data.code === 'forbidden' ? 'FORBIDDEN'
        : data.code === 'connection_unavailable' ? 'CONNECTION_UNAVAILABLE' : 'UNAVAILABLE';
      return { ok: false as const, code };
    }
    return { ok: false as const, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false as const, code: 'UNAVAILABLE' };
  }
}
