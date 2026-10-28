# Setup release — 2026-10-29

Nine reviewed migrations applied successfully to Supabase project `vmpifljyozsbtssxhoxd`.
The remote migration service assigns application timestamps; match both name and the map below before any future application. Do not reapply the local filenames.

| Local version | Migration | Production version |
| --- | --- | --- |
| 20261028165254 | es02_trial_success_allowance | 20261028231132 |
| 20261028165819 | es02_launch_revision_idempotency | 20261028231141 |
| 20261028171327 | es02_branch_knowledge_mutations | 20261028231145 |
| 20261028171417 | es02_trial_result_recovery | 20261028231149 |
| 20261028171440 | es02_hours_date_exceptions | 20261028231152 |
| 20261028171538 | es02_branch_team | 20261028231156 |
| 20261028172343 | wa_checkpoint_review_request | 20261028231200 |
| 20261028172913 | es02_reply_language_cas | 20261028231204 |
| 20261028173318 | es02_worker_reply_language | 20261028231207 |

Excluded: `20261028122302_wa_unresolved_checkpoint_vault_guard.sql` and its incomplete diagnostic code. The earlier `wa_early_authorization_receipt` was already applied and was not reapplied. The separate review-request migration creates a private receipt; it does not modify existing checkpoints, credentials, or provider attempts.

Compatibility: the branch team uses existing company membership and private branch grants, preserving legacy company authority. Branch-only members do not satisfy legacy company-wide active-member checks. The dedicated branch inbox requires verified current channel binding, explicit capabilities, and billing/history gates. Worker reply-language lookup was corrected to use that existing binding rather than a nonexistent conversation branch column.

Verification reused: eight targeted PostgreSQL team cases, production-shaped installation, invitation/UI/action tests, TypeScript and scoped ESLint. The changed worker migration passed its affected PostgreSQL regression, including stale/revoked/unverified/wrong-branch/expired bindings. Auth/session/billing boundaries in isolated tests are documented doubles; they are not hosted acceptance. The release tree passed secrets and Gitleaks scans.

Post-application: all nine names recorded in the remote ledger; all three new private tables have RLS and no direct anonymous/authenticated/service-role writes. Pre/post fingerprints of existing companies, original membership fields, and signup checkpoints were unchanged. No company, subscription, payment, Meta attempt, or customer data was created or changed by release verification.

Recovery: migrations are transactional. Prior definitions and ACLs are captured locally under `.git/velora-release/setup-final/`. Restore the paired application and reviewed prior functions if needed; retain new nullable columns, grants, receipts, saved responses and ledger evidence. Never promote branch-only members to company-wide active status. Hours rollback must preserve already-saved exceptions. Prefer a corrective migration; do not delete evidence or rewind subscription state.

Hosted write/readback acceptance is **UNKNOWN**: the owner confirms no isolated authorized Production test business exists. Production verification is limited to connectivity, read/API and permission checks. CI and deployment evidence are recorded after publication; successful CI does not establish Meta integration acceptance.
