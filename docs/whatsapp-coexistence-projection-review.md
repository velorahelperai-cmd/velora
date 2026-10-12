# Coexistence persistence and acceptance evidence

`supabase/upgrade-packages/whatsapp-coexistence/30-projection.review.sql` is forward source for release review. It has not been applied, parsed by PostgreSQL, or tested against Auth/PostgREST. It depends on the accepted schema through `20261010100003_accepted_usage_independent_display.sql` and the sibling `20-signup.review.sql`. The frozen eight-file foundation remains unchanged.

## Persistence contract

Signed webhook normalization calls `whatsapp_ingest_coexistence_event` with exactly 20 scalar arguments. The database independently resolves an exact WABA/phone or normalized display number. There is no browser-supplied company, arbitrary first-number selection, or automatic fallback. `NOT_COEXISTENCE` is returned only for an exact currently authorized independent-number live-inbound binding.

An active receipt returns `binding_state: active_link`, its actual company/link/generation and `projection_status: projected | pending | conflict_review`. A secure pre-finalization checkpoint receipt returns `binding_state: signup_checkpoint`, the actual company/attempt, null link/generation, and pending/conflict state. Both include the normalized `display_phone_number`, exact asset IDs, event key and durable receipt ID. `inserted` and `duplicate` are complementary receipt decisions; neither means a message was delivered.

Canonical history/mobile messages use existing tenant-composite conversation/message keys and the existing global provider-message ID. Outbound mobile/history rows use the existing `staff` representation with a private origin association and no API acceptance/delivery snapshot. Existing matching API rows and accepted-send accounting are preserved. A pending accepted API display uses the existing local-only `retry_whatsapp_send_persist` contract; it never sends again. The inbox read helper can expose proven `accepted` from its exact durable accepted intent when an echo-first row has no delivery snapshot. Provider delivered/read evidence remains the existing monotonic delivery ledger's responsibility.

History never calls `save_whatsapp_inbound`, creates jobs/send intents, records usage, enables AI, reopens conversation control or mints a service window. Immutable history-origin associations also block later legacy job insertion after an independent-number reconnect. Only a separately signed live-inbound observation, with exact immutable message identity/time, can mint existing `whatsapp_meta_inbound_evidence`. Checkpoint-time live inbound is recovered as historical evidence and requires a later positive live observation before manual freeform replies become eligible.

Contacts use provider timestamps with add/edit and removal tombstones; older delivery cannot replace newer contact state. Equal-time contradictory contact changes go to review. History chunks persist independently and phase progress never shrinks. A provider progress of 100 means completion only when all known history/chunk/media receipts are projected. Known pending/conflicting projection shows `reconcile_required`; this does not assert that undelivered chunks or empty phases have been received. Media placeholders retain their canonical message identity. Later media IDs are stored privately against the same provider ID, including media-first delivery, without fetching media or claiming download support.

Phone-specific `PARTNER_REMOVED` binds the documented display number and WABA exactly. The durable receipt immediately marks operational authorization revoked outside optional Vault cleanup, so cleanup failure cannot retain send/window authority. Existing receipt replay never revokes a new authorized generation. Before finalization, sibling SQL checks exact-attempt removal receipts, including same-second timestamp precision, and retains reconciliation instead of activating a stale proof. No ordinary register/deregister or broad WABA removal is used.

## Local recovery and live verification

`whatsapp_reconcile_coexistence_events(p_company_id uuid, p_limit integer default 50)` is service-only and bounded to 1–100 receipt attempts. It derives the current exact link, requires the completed attempt's actual finalized link/generation, and retries retained checkpoint and active-link pending projection. It returns `{ok, company_id, processed, recovered, pending, conflicts, remaining}`. `remaining` counts eligible pending receipts, not unique messages. It performs no token exchange, subscription, provider sync, send or other provider operation. Call after successful local finalization and on owner reload of an active connection. Failed recovery leaves the persisted connection and explicit pending receipts intact.

`whatsapp_record_coexistence_outbound_proof(waba, phone, message_id, status, recipient, occurred_at)` is service-only and called after signed status persistence. It stamps `outbound_tested_at` only for actual delivered/read evidence already associated with a durable accepted staff intent on the current exact link/generation. HTTP acceptance, imported history and mobile echoes cannot set it. Its return is `{ok, verified, company_id?, link_id?, link_generation?}`.

The operational lock order is WABA advisory → company → link/attempt → conversation → intent → provider-ID advisory/message. Historical receipts, projection exceptions and orphaned encrypted-secret cleanup require a coordinated database check; static inspection is not concurrency evidence.

## Focused database gate

The runtime owner should execute these against the disposable accepted local schema after reviewing and installing the three forward packages. No production SQL or provider calls are authorized by this document.

| Case | Required evidence |
| --- | --- |
| anon/authenticated ingress, recovery and proof calls | Permission denied; no receipt/canonical row/secret exposure |
| exact active tenant and other-company collision | Correct company association; global provider ID collision retains conflict without reassignment |
| duplicate and contradictory replay | One canonical row; original scalars immutable; conflicting normalized scalars retained for review |
| history, mobile echo and checkpoint-time inbound recovery | Canonical row visible; no job/intent/usage/AI or window evidence |
| actual signed live inbound after history | One canonical row; positive evidence only if exact body/type/direction/provider time matches |
| contact remove/add delivered out of order | Newer name/tombstone survives; equal-time contradiction reviewed |
| history chunks out of order and progress 100 | Nondecreasing phase progress; known pending/conflict prevents completed status |
| media-first and placeholder-first delivery | One provider ID; private media metadata associated without canonical identity rewrite |
| echo before/after accepted API display | Existing accepted receipt preserved; one canonical row; local display repair only |
| projection exception after receipt insert | Receipt commits as pending; bounded recovery projects locally; no provider repeat |
| checkpoint after logout/nonce expiry | Known signed receipts quarantined while current ownership/provider proof/base generation remain valid |
| removal before finalization, including same second | No active stale link; attempt remains reconciliable |
| active removal with forced cleanup failure | Durable revoked fence; subsequent secret/window/send authorization rejected |
| replay old removal after a new generation | New generation remains active; only retained old receipt acknowledged |
| reconnect B after completed attempt A | A's checkpoint receipt cannot project into B's link/generation |
| accepted/sent/mobile echo vs delivered/read proof | Only exact durable delivered/read staff receipt stamps outbound verification |
| concurrent receipt, manual finalization and revocation | No lock-order deadlock, cross-tenant association or expired-proof authorization |

Live Meta acceptance remains separate: mobile Business app still works, Velora connection survives reload, external inbound appears, manual outbound is received, mobile echo appears once, cross-company attempts fail, and the chosen disconnect flow stops further use.
