/**
 * Deferred acceptance cases for VEL-WA-INBOUND-01.
 * Reusable descriptors only — not executed here; do not treat as PASS.
 */

export type InboundAcceptanceCase = {
  id: string;
  title: string;
  expect: string;
};

export const INBOUND_ACCEPTANCE_CASES: InboundAcceptanceCase[] = [
  {
    id: "dup-sequential",
    title: "Same message twice (sequential)",
    expect: "One whatsapp_messages row and one whatsapp_inbound_jobs row; second call inserted=false; uses stored identity/received_at.",
  },
  {
    id: "dup-concurrent",
    title: "Same message twice (concurrent)",
    expect: "Advisory lock + unique wa_message_id/job message_id yield a single message and single job.",
  },
  {
    id: "dup-concurrent-identity-mismatch",
    title: "Concurrent duplicate with different identity",
    expect: "Same wa_message_id with different company/phone/customer is rejected (inbound_identity_conflict); no side conversation.",
  },
  {
    id: "no-side-conversation",
    title: "No side conversation on conflicting duplicate",
    expect: "Identity mismatch fails before conversation upsert; no extra whatsapp_conversations row.",
  },
  {
    id: "dup-uses-stored-timestamp",
    title: "Duplicate uses original timing",
    expect: "Correct duplicate repairs last_message_at with stored received_at only, not the replay request timestamp.",
  },
  {
    id: "partial-failure-redelivery",
    title: "Partial persist failure then redelivery",
    expect: "Webhook must not return success if RPC fails; redelivery restores missing job without rewriting body.",
  },
  {
    id: "older-message-clock",
    title: "Older message after newer activity",
    expect: "last_message_at never moves backward (greatest).",
  },
  {
    id: "phone-or-company-reject",
    title: "Mismatched phone_number_id or untrusted company",
    expect: "No DB write when phone does not match server config; company_id only from server env mapping.",
  },
  {
    id: "stale-claim-complete",
    title: "Lease expired then another worker claims",
    expect: "complete_whatsapp_inbound_job with old claim_token returns claim_rejected.",
  },
  {
    id: "jobs-not-client-readable",
    title: "Client cannot read claim tokens",
    expect: "authenticated has no SELECT on whatsapp_inbound_jobs; claim_token is not exposed to the browser client.",
  },
];

/** Explicit non-result: operational runs are still deferred. */
export const INBOUND_ACCEPTANCE_STATUS = "deferred" as const;
