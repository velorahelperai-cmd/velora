# Outbound usage display compatibility

This package replaces only `public.billing_read_company_display_evidence(uuid)` over its exact deployed body (`10db3701219d724462a8fe48f408fa8d`). It retains the authenticated-only execute ACL, owner, security-definer setting, empty search path, verified-session/owner/company gates and signed subscription qualification. It adds no columns, triggers, grants, backfill, seeds or provider activation. Replay and source/ACL drift are rejected.

The previous projection referenced `whatsapp_send_intents.acceptance_observed_at`, which the deployed worker schema lacks. Its undefined-column handler consequently returned unavailable usage even for an empty company. Earlier checkout fixtures created that column and missed the actual compatibility failure.

The projection now reads the optional column through the row's JSON representation. Job accepted/held counts retain their recorded `usage_period_start`. Standalone assistant receipts count in the current Asia/Muscat month only with a real observation timestamp. Unknown observation periods, missing receipt IDs, future observations or an observation before intent creation retain `usage: null`. Creation, attempt-start, mutable updated-at and recreated display timestamps never substitute for acceptance. Staff sends and job-linked intents do not enter standalone counts. Held rows use their existing current-month creation contract with a future-time exclusion.

Legacy receipts without trustworthy acceptance timestamps remain unavailable. No historical timestamp is invented. The full canonical acceptance-observation/worker upgrade is separate and is not replayed by this package; this projection is not a quota enforcement or sending activation change.

`10-display-compatibility.review.sql` fingerprints its target and verifies every other public/private function's source, owner, security configuration and ACL remains identical. No production customer data is used by the tests.

The opt-in actual PostgreSQL regression uses an existing task-owned network-isolated container and rollback-only synthetic tenant fixtures. A fixture-helper grant exists only inside each rolled-back test transaction; it is absent from production SQL. Tests verify the old full-RPC failure, deployed-schema zero, unknown legacy receipts, month boundaries, future/impossible times, holds, repeated reads, tenant/session denial, upgrade replay rejection and preserved original synthetic financial/AI/WhatsApp history. A successful test leaves the reviewed display function installed in that task-owned isolate.

Run from the repository with `OUTBOUND_USAGE_DISPLAY_POSTGRES_TESTS=1`, `LIVE_CHECKOUT_ISOLATE_RECEIPT` pointing to its approved local isolate receipt, and optional `OUTBOUND_USAGE_DISPLAY_PROOF` pointing to a local evidence file:

```
node scripts/outbound-usage-display/postgres.optin.mjs
```

Do not run this script against a production database or restart/replace a container to make it pass.
