export type ServiceWindowBinding = { companyId: string; conversationId: string; phoneNumberId: string; recipientWaId: string };
type RpcClient = { rpc: unknown };

/** A browser time/flag cannot open a window. Read exact persisted Meta evidence. */
export async function readServiceWindow(client: RpcClient, binding: ServiceWindowBinding, now = Date.now()): Promise<string | null> {
  try {
    const rpc = client.rpc as (name: string, args: Record<string, string>) => PromiseLike<{ data: unknown; error: unknown }>;
    const { data, error } = await rpc.call(client, "whatsapp_check_service_window", {
      p_company_id: binding.companyId, p_conversation_id: binding.conversationId,
      p_phone_number_id: binding.phoneNumberId, p_recipient_wa_id: binding.recipientWaId,
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return null;
    const row = data as Record<string, unknown>;
    if (row.ok !== true || row.company_id !== binding.companyId || row.conversation_id !== binding.conversationId
      || row.phone_number_id !== binding.phoneNumberId || row.recipient_wa_id !== binding.recipientWaId
      || typeof row.valid_until !== "string" || typeof row.last_inbound_at !== "string") return null;
    const until = Date.parse(row.valid_until), inbound = Date.parse(row.last_inbound_at);
    if (!Number.isFinite(until) || !Number.isFinite(inbound) || inbound > now || until <= now
      || until > now + 86_400_000 || until !== inbound + 86_400_000) return null;
    return row.valid_until;
  } catch { return null; }
}
