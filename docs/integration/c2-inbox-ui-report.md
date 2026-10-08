# C2 Unified Inbox UI integration

Implemented locally in `integration/overnight-velora`; no commit, cloud SQL, real provider execution, paid verification, activation, push or deployment performed.

## Production data path

- The route uses the root-owned `loadWhatsappInboxInitialPage()`. Opening the Inbox fetches one bounded conversation page instead of every conversation and complete thread history.
- Header refresh uses `refreshWhatsappInboxInitialPage()` for fresh authoritative capabilities and metadata. Older conversation pages use `refreshWhatsappInboxPage()` and the returned cursor.
- Selecting a thread revalidates access with `refreshWhatsappThreadPage()`. Older messages are deduplicated by message ID and ordered by `BigInt(arrivalSequence)`, including identical or out-of-order provider timestamps. A refresh without overlap retains a cursor through the newly arrived message gap.
- Current-page results add/update rows without implying full membership. Changed authorization membership fingerprints invalidate row/thread/audit read caches and restart bounded first-page loading. In-flight response epochs are invalidated; saved send operation IDs/body and unknown-outcome locks remain within the same company scope.
- `NOT_FOUND`, `FORBIDDEN` and `SCOPE_CHANGED` thread reads remove the inaccessible cached row. Mutations require a successfully refreshed selected thread and the relevant explicit capability. Unexpected scope changes clear data and refresh the route.

## Read and intervention semantics

The visible latest thread page is acknowledged after its committed render and two animation frames, only while the document is visible, using its exact non-null `displayedInboundMessageId`. Selection/read generation and workspace epochs guard the request and its result. Historical pages never issue a new acknowledgement. A boundary conflict refreshes the latest page; acknowledgement failure remains visible and can be retried by refreshing the thread. No arbitrary message ID is substituted.

All/Unread/Staff badges use actual server `total`/`unreadTotal`/`interventionTotal`. Unread totals count inbound messages; intervention totals count conversations. Row unread badges and the Unread filter use persisted `unreadCount`. The Staff filter uses durable intervention reasons, including unknown sends and delivery failures. Read acknowledgement cannot unlock an unknown send or authorize a new send operation.

Search and filters explicitly apply to loaded conversations, ordered newest created first. Noura/Closed omit unsupported global counts. Follow-up/overdue/quote worklists use complete row metadata and label their counts as loaded conversations. The old awaiting-staff worklist chip is omitted because its predicate requires complete message history, which bounded row previews do not provide.

## Existing design and controls

The three-column layout, mobile drawer, Noura branding, real lead mutations, revision checks, stable `clientOpId` send handling and unknown-outcome locks are preserved. Automation labels describe enabled/paused state without claiming that the customer worker is currently replying. Accepted messages are labeled Accepted without implying delivery.

The header and existing sidebar show actual connection binding readiness, status, authorization, number and nullable verification timestamps. Binding readiness is not treated as a successful send/test or runtime activation. Unsupported knowledge-sync claims are replaced with the actual knowledge-management link. The sidebar also shows persisted intervention reasons and bounded control/handoff history with actor, action and time; older audit pages use the returned event cursor.

## Local verification

- `node ./node_modules/vitest/vitest.mjs run src/components/app/conversations-inbox.test.ts src/components/app/conversations-async.test.ts src/lib/whatsapp/inbox-contracts.test.ts src/lib/whatsapp/live-inbox.test.ts`: **61 tests passed across 4 files**, including 11 new UI/helper tests.
- New regressions were observed failing before the corresponding helper implementations: partial-page preservation, int64 ordering, exact boundaries, stale selection/scope, persisted unread/intervention semantics, independent control capabilities, message-gap pagination and changed-fingerprint cache invalidation preserving unknown-send identity.
- The actual Inbox component receives a synthetic partial page in an offline React server render. It displays server workspace totals, accurate loaded coverage, no false unread badge for an already read latest customer message, no fabricated connection/knowledge success, and disabled controls/composer until selected-thread access is refreshed.
- Focused ESLint on the four owned source/test files passed with no warnings or errors.
- Full `tsc --noEmit --pretty false` passed at 13:00 local execution. The final 13:02 rerun found two newly added root-owned `company-journey-postgres.test.ts` errors: nonexistent `changeWhatsappConversationControl` import at line 18 and `inboundMessageId` instead of `displayedInboundMessageId` at line 50. No C2 file errors were reported; these harness corrections are root-owned.
- Owned tracked-file `git diff --check` passed. Final broad suite/build/review remain root-owned.

No live browser session, cloud migration parity or real-account WhatsApp verification is claimed by this report. These remain separate acceptance work; all rollout flags remain unchanged.
