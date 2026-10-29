/** Shared inbound-store contracts without importing the store implementation. */
export const INBOUND_CLAIM_LEASE_SECONDS = 120;

export type SaveInboundResult = {
  inserted: boolean;
  messageId: string;
  conversationId: string;
  jobId: string;
  jobStatus: string;
};
