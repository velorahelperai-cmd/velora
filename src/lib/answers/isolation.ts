/** Conversation context is isolated by company + provider phone + conversation. Never reuse a provider thread across customers. */

export function answerIsolationKey(input: {
  companyId: string;
  phoneNumberId: string;
  conversationId: string;
}): string | null {
  const companyId = input.companyId.trim();
  const phoneNumberId = input.phoneNumberId.trim();
  const conversationId = input.conversationId.trim();
  if (!companyId || !phoneNumberId || !conversationId) return null;
  return `${companyId}:${phoneNumberId}:${conversationId}`;
}
