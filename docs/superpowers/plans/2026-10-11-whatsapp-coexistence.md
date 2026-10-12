# WhatsApp coexistence implementation plan

The controlling specification is Library `libfile_5f10d1bdf43081918bf1a6c057b02657`, read completely (234 lines). Its supported local transfer remains blocked on Windows filesystem metadata; this document is an implementation plan, not a reconstructed specification. Owner's latest delegation explicitly authorizes independent internal persistence and authorization work while retaining all provider and release gates.

Goal: keep the same number usable in the mobile Business app and persist company-isolated conversations and manual replies in Velora. Cloud-only numbers retain their existing independent onboarding. Connected, synchronized, inbound-tested and outbound-receipt-verified are separate states.

Source: isolated external snapshot copied from the accepted desktop Teams candidate; claimed baseline `281468d00bd02688ed9b45730de062720031324f`. All ten paths in its current identity manifest were independently checked after LF normalization. Full local Git object identity is unavailable. Original `ec3c91e` and the untracked IG plan are preserved. No branch or shared checkout edit.

Current bounded implementation ownership:

- `src/lib/whatsapp/coexistence/browser.ts` and adjacent test: exact-origin, bounded signup parsing and attempt-scoped signal joining. Browser assets remain untrusted selectors. v4 configuration does not invent a session version; compatibility WABA-only completion requires server discovery.
- `src/lib/whatsapp/coexistence/asset-selection.ts` and adjacent test: server-fetched complete asset lists, app/scope/expiry verification, explicit ID or confirmed exact number selection, ambiguity rejection and positive Business-app evidence. This helper cannot replace tenant/session authorization.
- `src/lib/whatsapp/coexistence/observation-store.ts` and adjacent test, plus `supabase/upgrade-packages/whatsapp-coexistence/10-observations.review.sql`: durable bounded history/mobile-echo observations, exact connection-generation authorization, idempotency and collision rejection. Projection remains explicitly pending; no automatic-reply jobs, send intents, paid usage or service-window evidence.

Each owner runs only changed-path tests. SQL review source is not a timestamped migration and is not applied; the sole release writer must generate the forward migration using the supported CLI after review and actual local database acceptance.

Next coordinated slices, after current safeguards and prerequisites:

1. Mode-aware signup start/claim/finalize, owner and native-session checks, nonce/code one-use expiry, per-connection Vault pending credential and durable provider-step checkpoint. Before any provider mutation, persist claimed state; after unknown outcome persist reconciliation state and forbid blind repeats. Validate authorized assets, subscribe the exact WABA and skip ordinary register for coexistence. Never reuse old IDs as proof.
2. Signed webhook normalization for history, state-sync contacts, mobile echoes and removal; durable observation receipt before acknowledgement. Canonical projection must reconcile immutable sender/body/provider-time identities and accepted-send receipts across out-of-order sources without overwriting or counting mobile messages as Velora sends. Imported history and phone echoes cannot mint live inbound/service-window/AI authority. Add positive live-customer provenance enforcement to job insertion/claim/worker locks.
3. Persist owner consent, request ID, history phases/chunks/progress/decline, sync deadline and unknown request state. A lost one-use sync response requires reconciliation, never automatic repeat. Contact updates compare provider chronology; removal/revocation invalidates active generation and pending work, clears authorization, rejects later use, and never calls independent-number deregister.
4. Wire owner UI and canonical inbox only after existing-file coordination. Show connected separately from tested, projection/sync limitations, provider uncertainty and errors. Reload must read persisted status. Preserve entitlements, window restrictions and accepted-versus-delivered semantics.

Focused acceptance must cover tenant/session denial, nonce/code replay and expiry, supported completions, exact selection, no register, provider-success/local-save failure, secret isolation, event deduplication and source ordering, no AI for imported/app messages, and revoked-send rejection. Mock tests prove adapters only. Genuine local SQL/Auth/PostgREST/browser evidence and live Meta evidence are separate gates.

Release stays with thread `01a1293c-1dfb-740c-9e4a-e4e33053a060`. Do not apply production SQL/grants, change secrets/rollout/Meta settings/subscriptions, create credentials or OAuth grants, connect/disconnect a real number, send real messages, submit app review or enable AI without the specific handoff/approval. Existing webhook mTLS stays enabled. Confirm mobile activation, number ownership and Ahmed's chosen company workspace before live binding; the reviewer workspace is not implicitly authorized.

Final live checklist: mobile works before and after connection; correct authorized assets and reload persistence; external inbound; manual outbound received; mobile echo exactly once with no automatic response; other-company denial; correct disconnect and subsequent send rejection.
