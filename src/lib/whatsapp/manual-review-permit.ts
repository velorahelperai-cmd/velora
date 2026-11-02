import { createHash } from 'node:crypto';
import type { ReviewGrant } from '@/lib/meta-review/access';

type Message = { toWaId: string; body: string; phoneNumberId: string };
export type ManualReviewPermit = Readonly<{ kind: 'bounded-manual-review' }>;
// Process-local capability, minted only after the session-bound database dispatch.
// Durable one-use authority remains the native grant reservation and dispatch token.
const permits = new WeakMap<ManualReviewPermit, Message & { expires: number }>();
export function boundedReviewMatches(grant: ReviewGrant | null, input: Message & {
  conversationId: string; linkId: string | null; linkGeneration: number | null;
}, now = Date.now()): boolean {
  return !!grant && grant.send_limit === 1 && grant.channel === 'whatsapp'
    && grant.revoked_at === null && Date.parse(grant.expires_at) > now
    && grant.asset_id === input.phoneNumberId && grant.recipient_ids.length === 1
    && grant.recipient_ids[0] === input.toWaId && grant.review_conversation_id === input.conversationId
    && grant.review_link_id === input.linkId && grant.review_link_generation === input.linkGeneration
    && grant.review_body_sha256 === createHash('sha256').update(input.body).digest('hex');
}
export function issueManualReviewPermit(input: Message, deadline: string): ManualReviewPermit | undefined {
  const expires = Date.parse(deadline), now = Date.now();
  if (!Number.isFinite(expires) || expires <= now || expires > now + 10_000) return undefined;
  const permit: ManualReviewPermit = Object.freeze({ kind: 'bounded-manual-review' });
  permits.set(permit, { ...input, expires });
  return permit;
}
export function consumeManualReviewPermit(permit: ManualReviewPermit | undefined, input: Message): boolean {
  if (!permit) return false;
  const stored = permits.get(permit);
  permits.delete(permit);
  return !!stored && stored.expires > Date.now() && stored.toWaId === input.toWaId
    && stored.body === input.body && stored.phoneNumberId === input.phoneNumberId;
}
