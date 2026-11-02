# Dashboard billing missing-proof guard

Production logs on 2026-11-02 at 06:41:02/32/46 UTC identified SQLSTATE 57014 inside the current-proof assignment of `billing_read_company_display_evidence`. The affected subscription has both `plan_version_id` and `paid_through` NULL. Planning the nested proof-view query exhausted the statement deadline even though equality against either missing value cannot match.

Migration `20261102064655_dashboard_billing_null_proof_guard.sql` returns false for current proof and service binding when any required subscription identity field is NULL. The existing paid-history check, authorization/session gates, refund validation, complete-subscription queries and usage projection are unchanged. No rows, grants, session limits, timeouts or sending flags are changed. Exact source hash, owner, ACL, security-definer and search-path guards reject drift and replay.

PostgreSQL documents that ordinary comparisons yield NULL when either operand is NULL: https://www.postgresql.org/docs/17/functions-comparison.html . Therefore these EXISTS predicates cannot return true when one of their required equality inputs is absent.

The opt-in regression requires a task-owned, network-isolated Supabase Postgres 17 container labelled `velora.task=f48-billing-null`, with database `f48_billing` containing the native schema and no customer rows. It never connects to a hosted database. Set `DASHBOARD_BILLING_GUARD_TESTS=1`, `DASHBOARD_BILLING_GUARD_CONTAINER` to that container, and optionally `DASHBOARD_BILLING_GUARD_PROOF` to a new evidence path; run:

```
node scripts/dashboard-billing-guard/postgres.optin.mjs
```

Eleven checks compare old/new native RPC results for absent subscription, both missing fields, each individually missing field, complete but unproven subscription, foreign company and wrong session; assert every other body character unchanged; reject replay and ACL drift; and verify owner/ACL/security/search-path preservation. All passed against the current hosted financial proof view definitions. There is no positive paid-receipt fixture in this scoped regression; the complete-proof path is verified unchanged, not newly reimplemented.

One implementation-time assertion failed because PostgreSQL array-text escaping was compared as a JavaScript string. Comparing structured JSON corrected that test; the actual ACL/configuration never changed.
