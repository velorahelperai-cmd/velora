# VELORA QA persisted setup grant

Owner scope: meta-review only (`83ad69f7-cbb0-4e3a-a34e-8085e5203dc7` plus server-verified email).
Create an actual QA company, branches, immutable catalog selection, term, seats and reply rights through the installed atomic ES02 provisioner. The review button requires a separate explicit confirmation. The normal `/setup` UI then reads and writes the existing company/branch tables.

This is a non-cash internal grant, not a gateway payment. Orders use `environment=test`, retain null `settled_at`, `settlement_authority`, `provider_transaction_id` and foundation `payment_confirmed_at`. No settlement event is manufactured. The foundation trigger continues to require a payment timestamp for every ordinary purchase. The existing LIVE operational readiness/payment checks are unchanged. Provider authorization, live AI service, subscription clock start and refunds are not proven by this grant.

One active grant per account, advisory locking, catalog resolution and the existing atomic provisioner prevent duplicate companies/rights. A different selected offer cannot silently replace an existing grant. Other company memberships or unresolved non-QA orders block creation. A failed provision rolls back the order and grant together.

Platform owner: `/admin/qa` lists the active QA grant and selected package. Preview the exact company/branch scope; type `RESET VELORA QA` to archive it and revoke access. This is archival reset, not physical deletion. Payment, grant and setup history remain preserved. Only a grant created by this feature can be reset. TAG CITY is explicitly excluded. Active provider links, other active members, non-QA orders or financial/subscription obligations block reset for separate review. A fresh creation operation starts a new grant after reset; it does not reuse the cancelled order.

Migration rollback: revoke execution of `public.es02_grant_qa_setup` and `public.es02_admin_reset_qa_setup`; preserve records and schema. Do not remove the nullable-payment guard while grants with no payment timestamp exist. No global synthetic-settlement gate is enabled.

Local verification: `node scripts/live-customer/qa-business-grant-integration.mjs` starts its own disposable loopback database, loads the current ES02 baseline and tests grant/persistence, original setup binding/save, cross-account denial, retry, concurrent creation, preview/confirmation, archival reset, restart and failed-provision rollback. All fixtures are synthetic and no payment/provider network is used. Hosted migration/application and browser acceptance must be reported separately.
