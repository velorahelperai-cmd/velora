/**
 * Deferred acceptance cases for VEL-WA-OUTBOUND-01 / FIX.
 * Descriptors only — not executed; do not treat as PASS. Not exactly-once.
 */

export type OutboundAcceptanceCase = {
  id: string;
  title: string;
  expect: string;
};

export const OUTBOUND_ACCEPTANCE_CASES: OutboundAcceptanceCase[] = [
  {
    id: "repeat-click-same-op",
    title: "Repeated press with same client_op_id",
    expect: "Returns existing intent state; does not create a second provider send.",
  },
  {
    id: "concurrent-claim",
    title: "Concurrent claim of same intent",
    expect: "Only one claim wins; loser gets in_progress; lease expiry does not re-authorize Graph.",
  },
  {
    id: "concurrent-op-field-match",
    title: "Concurrent create unique_violation field match",
    expect: "Race path compares company, conversation, phone, recipient, body, sender_kind, generation — same op id + same text on different conversations is content_mismatch.",
  },
  {
    id: "phone-mismatch",
    title: "Conversation phone ≠ server send phone",
    expect: "create / claim / sendWhatsappText return phone/binding mismatch; no default number fallback; tenant_registry never uses another company's env token.",
  },
  {
    id: "claim-recheck-suspended-or-automation",
    title: "Claim re-verifies company + bindings + membership/automation",
    expect: "Suspended company, changed phone/recipient, lost membership, or automation generation mismatch blocks ready→attempting.",
  },
  {
    id: "ambiguous-http-stays-unknown",
    title: "Unreadable / 5xx / unclear non-OK HTTP",
    expect: "Without a clear Graph error object on 4xx, outcome is unknown — not confirmed rejected; no automatic resend.",
  },
  {
    id: "ambiguous-disconnect",
    title: "Timeout / disconnect after provider contact started",
    expect: "Outcome unknown; client_op_id retained; UI locks normal send; no automatic resend.",
  },
  {
    id: "keep-op-after-persist-or-save-fail",
    title: "Keep client_op_id after attempt / persist failure",
    expect: "SAVE_FAILED, PERSIST_PENDING, or action exception after claim keeps client_op_id; no new op minted; persist/read recovery only.",
  },
  {
    id: "accept-evidence-survives-display-fail",
    title: "Acceptance evidence outside display failure scope",
    expect: "finalize saves accepted+wa_message_id before display insert; non-unique display/follow-up errors return persist_pending without rolling back evidence; whole-txn failure before evidence → unknown locked; no Graph for recovery.",
  },
  {
    id: "unique-match-followup-fail-keeps-accept",
    title: "Matching unique_violation follow-up failure",
    expect: "After identity-matched existing message, conversation update / intent message_id link / rebind failures stay in an inner exception block; acceptance evidence kept; returns persist_pending — not success with incomplete link, and not provider_id_conflict.",
  },
  {
    id: "draft-edit-does-not-drop-pending-op",
    title: "Draft edit / CONTENT_MISMATCH keeps pending op",
    expect: "Pending client_op_id+original body retained; CONTENT_MISMATCH does not clear them; edited draft stays separate; no unsafe new send; UI catch marks unknown and keeps id.",
  },
  {
    id: "in-progress-or-save-fail-no-new-send",
    title: "IN_PROGRESS / SAVE_FAILED after attempt start",
    expect: "Locks normal send; recovery is read/persist only; does not mint a replacement operation.",
  },
  {
    id: "retry-provider-id-conflict-unknown",
    title: "retry_whatsapp_send_persist provider_id_conflict",
    expect: "Intent moved to unknown like finalize; UI gets UNKNOWN_OUTCOME not PERSIST_PENDING; no foreign message leak; no Graph resend.",
  },
  {
    id: "accepted-persist-fail",
    title: "Provider accepted then display persist failed",
    expect: "wa_message_id/acceptance saved on intent first; retry persist only; never Graph again.",
  },
  {
    id: "provider-id-conflict-no-leak",
    title: "Provider message id conflicts with foreign row",
    expect: "Mismatch on company/conversation/direction/body → unknown/provider_id_conflict without returning foreign message fields.",
  },
  {
    id: "accept-evidence-lost-stays-unknown",
    title: "Could not retain acceptance evidence",
    expect: "If provider id/acceptance cannot be saved, outcome stays unknown/locked — do not claim a recoverable id that was never stored.",
  },
  {
    id: "status-duplicate",
    title: "Duplicate delivery status event",
    expect: "Unique (wa_message_id, status, occurred_at) yields inserted=false; message state unchanged.",
  },
  {
    id: "status-concurrent-rank",
    title: "Concurrent delivery rank updates",
    expect: "Row lock + conditional UPDATE: lower rank cannot overwrite a higher committed delivery_state.",
  },
  {
    id: "status-late-or-early",
    title: "Late / early status vs saved result",
    expect: "Unmatched events kept for rebind; stale lower rank ignored; accepted ≠ delivered.",
  },
  {
    id: "status-before-message",
    title: "Delivery event before outbound row exists",
    expect: "Event stored unmatched; rebind after message save applies without guessing phone/company.",
  },
  {
    id: "claim-finalize-not-client-callable",
    title: "Claim/finalize not directly callable by browser",
    expect: "EXECUTE revoked from authenticated/anon/public; only service_role after server action membership checks; attempt_token never returned to UI.",
  },
  {
    id: "company-suspended-or-staff-takeover-before-automation",
    title: "Suspended company / staff takeover before automation attempt",
    expect: "Staff send blocked when company suspended; assistant claim blocked when automation_allowed false or generation mismatch — gate cannot cancel an already-accepted provider message.",
  },
];

export const OUTBOUND_ACCEPTANCE_STATUS = "deferred" as const;
