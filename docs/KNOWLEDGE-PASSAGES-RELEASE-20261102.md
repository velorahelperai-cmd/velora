# Approved knowledge passages

Large approved documents previously entered the reply context as whole sources and could exceed its 12,000-character limit. Version-bound indexed passages now select at most six relevant excerpts while retaining complete branch business instructions. Original source text remains unchanged. Arabic normalization affects search only, not returned text or prices.

Migration `20261102121201_approved_knowledge_passages.sql` was applied to the existing Velora project on 2026-11-02. Its SHA256 is `1329BE63763C34711D1C8A03CB13639D3C38AABB783E68366BD79EEEAAD81F73`. Compatible application envelopes were released in `3f0b99c` before SQL activation. Legacy native-plan retrieval remains unchanged.

The worker retains native claim, company, question, service-window, paid-readiness and final authority checks. Citations require current branch bindings and approved parent versions. Derived tables enable RLS and deny direct reads and writes to anon, authenticated and service roles; only the existing privileged worker entrypoint can retrieve context. Helpers have no client-role execute grants. Approval changes invalidate the index in the same transaction.

## Evidence and limits

- Native disposable PostgreSQL run 19700 completed with exit 0 at 12:07 UTC: original purchase/setup/channel/trial/launch, Meta-ingress RPC with explicitly synthetic provider evidence, conversation resume, job claim, recipient classification and passage retrieval passed. Foreign-company, invalid-claim, changed-question and native approval-revocation rejection passed. No real provider request, model execution, payment or outbound message occurred.
- Actual selector benchmarks used synthetic approved branch-bound sources, five samples per query type/size. At 30,000 sources, selective queries took 101.694–123.122 ms and common-term queries 289.264–378.929 ms. These are local selector timings, not hosted P95, complete reply latency or answer-quality acceptance.
- Four native concurrent approval/binding lock-order cases passed in earlier run 44132. Retrieval waits for committed revocation, and mutation waits for a reader's retained locks.
- The assembled migration and rollback passed source-lifecycle, Arabic/English, UTF-16 budget, mandatory-instruction and ACL tests. Rollback restored exact original function bodies, owners, ACLs, definer attributes and search paths.
- Hosted checks after apply: four approved sources produced seven passages; zero stale/version/text mismatches. Both derived tables deny direct reads to all three client roles. No helper has unexpected execute privileges. A scoped internal read returned success, two sources and 761 context characters, all company-bound.
- Security advisors added only two informational RLS-without-policy entries for intentionally private deny-all index tables. Existing warning counts were unchanged; this is not a claim that all unrelated project advisories are resolved.

## Verification and recovery

`node scripts/performance/knowledge-passages-prerequisite.test.mjs --release` runs rollback-only checks against the existing labelled isolated C2 test database. It does not create, reset or target a hosted database. It also rejects body, ACL, definer, search-path and pre-existing-object drift. Full native lifecycle and capacity evidence are separate from this smaller reproducible release check.

`scripts/performance/knowledge-passages-rollback.sql` restores the original reader and citation verifier transactionally with bounded lock/statement timeouts. It intentionally retains unused derived indexes and triggers, and deletes no customer content, approvals or history. Review current function ownership and intervening changes before applying it. Hosted rollback must use the migration mechanism.

Live authenticated site verification and complete provider response latency remain required for the broader performance task. SQL installation and local capacity results do not close that task.
