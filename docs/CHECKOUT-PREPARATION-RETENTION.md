# Checkout preparation retention — local candidate

This policy distinguishes a local prepayment form from the immutable preparation
bound to an initiated checkout. It does not authorize a Production cleanup or
change the retention of existing records.

* The proposed local-only onboarding change is separate and not established by
  this audit release. Existing server drafts are not modified by the audit.
* At an explicitly initiated checkout, the server binds the preparation needed
  for later provisioning to the owned order. It is not a company, branch or
  subscription. Only verified payment authorizes provisioning.
* Retain the binding while payment outcome is unknown, a provider claim is
  unresolved, or a paid order has not been successfully provisioned. Expiry of
  a checkout session is not proof of nonpayment and must not trigger deletion.
* After confirmed provisioning, retain the financial order and settlement
  evidence. A separate reviewed retention implementation may remove only
  redundant preparation after proving retries, legacy orders, disputes,
  refunds, reconciliation and any applicable retention obligations are safe.
  No deletion interval is approved or implemented here.
* Old and pending checkout bindings remain unchanged. A dry-run inventory and
  explicit approval are required before any Production cleanup. Never delete
  account preparation drafts under this policy.

The existing checkout tables retain `preparation` indefinitely: their 24-hour
`expires_at` is a session/claim boundary, not a data deletion guarantee. The
Thawani test and local-live finish functions still read that immutable payload.
The local-live candidate is not evidence that the function is installed in
Production. Until cleanup and old-order compatibility are tested against the
actual deployed schema, this document is a safe interim policy, not a claim of
retention enforcement or commercial readiness. The local read-only classifier
`src/lib/billing/es02/checkout-preparation-retention.ts` classifies holds; it
does not load records, schedule cleanup, mutate data, or grant permission to
remove the payload. Provisioning alone does not establish financial,
operational or legal closure. Unknown or inconsistent evidence remains on hold.

`scripts/live-customer/checkout-retention-audit.sql` connects the policy to the
three checkout tables and their order and settlement evidence. It returns only
aggregate counts by source and hold reason. Legacy provider records and
missing or inconsistent evidence stay `hold_unknown`. The query is read-only;
it does not schedule or authorize cleanup and must not be treated as proof of
provider status. Its compatibility test uses synthetic local records only.
