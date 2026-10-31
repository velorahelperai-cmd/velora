# Durable file recovery: review candidate, unapplied

This is a local review artifact, not a migration ready for production. `knowledge-recovery.review.sql` intentionally raises REVIEW_ONLY_NOT_APPROVED_FOR_EXECUTION before DDL. `knowledge-recovery.manifest.json` records exact baseline/body hashes and candidate hash. Eight generation assertions check inherited publisher content and lock order; no candidate SQL parser/native/runtime test ran. Existing isolated baseline replay was attempted, then blocked before candidate installation; see recovery-native-evidence.json.

## Missing guarantee in current application

The current retry uses one status/updated_at CAS for extraction and fences failure cleanup by observed row identity. It does not reclaim a processing row after process death. Existing g03_publish_prepared_file checks version and exact storage generation but has no durable attempt token: after a timeout takeover with unchanged content_version, a resumed old worker could still publish. Therefore automatic age-based reclaim is unsafe and remains disabled. Racing requests can both download before the CAS; only its winner extracts. The new local safe fix releases a still-owned processing row as failed when final storage observation fails; it cannot recover a terminated process.

## Application integration (local, gated OFF)

App wiring exists behind `VELORA_KNOWLEDGE_FILE_WORKER_ENABLED` (default false):
upload/reprocess enqueue via `enqueueBoundBranchKnowledgeFilePrepare` after branch bind;
worker route auth mirrors WhatsApp; provider extract requires a second gate.
SQL remains review-only and unapplied. See `docs/KNOWLEDGE-FILE-WORKER-PACKAGE.md`.

## Proposed protocol (SQL still unapplied)

1. For existing branch-bound file reprocessing, after authenticated branch membership and exact storage metadata checks, generate a server-side unique attempt UUID before dispatch. Call g03_claim_file_attempt with p_branch_id and the captured source version, updated_at, storage path and object generation. Only a successful claim may download/extract. Claim, heartbeat/fail and publication lock/recheck the same company/branch/source binding; unlinking prevents subsequent terminal writes. New uploads before branch binding remain outside this candidate and must never be represented as covered. A lost response retries that same attempt ID; never generate another ID to evade BUSY.
2. Persist the returned source identity and token across the single canonical prepare path. Replace all worker processing/fail/publish writes for enrolled sources with the new RPCs. g03_control_file_attempt heartbeat/fail requires live actor/session, unexpired token and unchanged source identity; heartbeats extend only lease metadata, not business/source versions.
3. Publish through g03_publish_file_attempt. It requires enrollment, carries the token transaction-locally and calls the existing publisher with its existing actor, company, source, exact object generation and content validation. The patched old publisher checks enrollment itself, so calling its legacy signature cannot bypass the fence. Existing publisher signature and ACL remain intact.
4. On explicit recovery, a new claim must identify the expired prior attempt and mint a different UUID. Claim/recover, heartbeat, fail and publication serialize on the source row; old tokens cannot write after replacement. Never infer termination merely from an expired lease: the token fence is what makes resumed old workers harmless. No auto-recovery for pre-protocol processing rows; these require separately reviewed reconciliation.
5. A lost publication response is reconciled by an authoritative source/proof read, without re-extraction. A same-token call after publication may return conflict; do not interpret that as a failed publication. Heartbeat duration, cadence, operation deadline and recovery policy need explicit operational review; no production defaults are invented here.
6. Before activation, drain old workers and remove all direct/tokenless lifecycle writes from application paths. Current owner edits and storage invalidation remain permitted and invalidate attempt identity by changing source/generation; do not add a broad trigger that blocks legitimate edits. Existing RLS/grants are preserved. New private attempt rows have no direct user/service-role table grants; only the new server-role RPCs expose lifecycle operations. A service-role caller remains trusted and must not bypass the protocol with raw writes.

## Required isolated native adversarial acceptance

- Two simultaneous claims: one successful owner; loser makes zero download/extraction/provider calls. Replay after lost claim response returns the same active attempt; different token stays BUSY.
- Worker A pauses, lease expires, B explicitly recovers with unchanged content_version. Resume A: publish, fail and heartbeat all reject; B can publish once. Repeat with heartbeat racing recovery, publish racing recovery, and separate DB sessions.
- Old publisher signature on enrolled source rejects both during processing and after published/failed state. New wrapper without enrollment rejects. Legacy un-enrolled processing recovery returns LEGACY_PROCESSING_REVIEW_REQUIRED.
- Source edit/delete, storage overwrite/delete, replacement generation and changed updated_at each reject stale publication and stale failure cleanup; newer source content/status/proofs remain unchanged.
- Foreign company/source, revoked session, revoked membership, suspended company, anon/authenticated RPC caller and malformed/null input fail closed; assert existing RLS and ACL snapshots unchanged.
- Transaction crash before claim commit rolls back; crash after claim is recoverable only through explicit expired-token replacement. Publication failure rolls back proof and source together. Lost success response reconciles existing proof, never double-publishes or recharges.
- Existing approval/input-epoch invalidation and ready-only approved context still work; launch/trial receipts become stale when source inputs change. Validate old proof consumption and exact file generation guards remain intact.
- Lock ordering/deadlock probes against owner edits, storage replacement, approval and company-input invalidation; confirm NOWAIT conflicts surface as retryable conflicts without partial mutation.

## Native environment and production approval

Existing engineering authorization permits the available disposable native runner with synthetic fixtures/no paid calls; no additional approval is needed for that bounded test. The cached image exists. Original replay stopped at the exact-generation prerequisite because Windows CRLF changed prosrc hashes. A task-local copy changed only SQL input line endings; LF bodies exactly match the pinned guards, which remained unchanged. Its second replay hit Docker inspect timeouts before the candidate. Both disposable containers were removed; the second removal was separately verified by exact labels, image/isolation and successful rm. No candidate SQL installed. Retry when local Docker is responsive; do not weaken/exclude migration or authorization guards. Native syntax/race/ACL validation remains NOT_RUN. Production migration/deployment still requires separate explicit approval after accepted tests and application cutover.

## Write-path coverage boundary

The inspected existing-file prepare path downloads the original blob, extracts locally, and publishes text/proof on knowledge_sources through g03_publish_prepared_file. No separate chunk/blob publication occurs in this path. The proposed token fence covers its processing claim, failure terminal write, heartbeat and ready/text/proof publication, with same-branch binding rechecked at each stage. Original upload/blob creation, pre-bind uploads, owner edits and unrelated ingestion pipelines are not silently covered by this recovery protocol. Owner edits/storage invalidation must still supersede the attempt identity; old-worker draining and removal of all tokenless lifecycle writes remain activation prerequisites. Application integration has not been implemented, so existing deployed writes are unchanged.
