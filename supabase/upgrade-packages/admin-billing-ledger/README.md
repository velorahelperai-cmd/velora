# Owner billing ledger — local review only

Dependency order: financial-proof-cloud stage 1 → stage 2a → stage 2b → checkout-slice1 → this package. No production installation is authorized or recorded.

Three read-only functions require the verified active platform owner, a matching stored Auth session, and an unexpired two-hour activity lease even when the older lease switch is disabled. Delegated platform admins and company owners/staff are denied. The installer verifies the existing financial proof definitions and supporting security relation metadata and installs atomically; it does not rewrite orders, receipts, prices or activation.

Filters use order creation in UTC. Pagination signs the server snapshot and exact timestamp/UUID position, bound to owner/session/filters, using a domain-separated key derived from the already configured service credential. No secret or session is serialized; key rotation invalidates browse links. Financial state remains qualified by the existing stored-evidence classifier. Collections are platform subscription payments, not merchant revenue. Unavailable is distinct from authorized zero.

`preflight.readonly.sql` checks dependencies without installation. The three functions must be newly installed only after approval; absent RPCs fail closed in the app. Live providers, channel activation and real Auth delivery are outside this proof.

Focused native run (external metadata files, isolated no-network Docker, no credentials):

```powershell
$env:VELORA_STAGE1_METADATA='<approved external stage1 metadata>'
$env:VELORA_STAGE2B_METADATA='<approved external stage2b metadata>'
npx vitest run --config scripts/admin-billing-ledger/postgres.optin.config.mjs
```
