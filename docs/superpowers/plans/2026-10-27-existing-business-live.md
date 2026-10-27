# Existing TAG CITY: one settled Live purchase, same company

Owner request authorizes implementation and local tests only. No hosted apply until an exact SQL/hash approval; no commit, push, deploy, new company/payment or owner-index removal.

## Design

Use immutable environment history plus the existing single active entitlement projection. Capture the original Test order, activation, rights, credit rows, subscription and channel selection in a private immutable receipt before moving the active projection to the verified Live order. Original Test order, Test subscription, credit rows and all company/branch/content data remain unchanged. An explicit installer-created target binds the approved account, Live order, existing company/branch and original Test order. The browser cannot choose a target or price.

The runtime transition authenticates the native session, serializes with account provisioning and company writes, proves the exact Thawani settlement/grant/catalog, and rejects started/used/in-flight Test service or foreign/mismatched ownership. It updates the current rights/foundation and channel preference projection atomically, creates one Live subscription/base balance/provision receipt, and returns the same company on replay. No readiness, launch, period start or provider connection is fabricated. START-001 remains the existing accepted-real-reply authority.

The operational readiness predicate gains only the independently verified Thawani evidence alternative; existing Paymob checks and all service readiness checks remain. Active operational replies must consume the current order group; historical Test base credits are not transferred. New history/target/binding records have RLS, no client writes, immutable evidence, deletion fences when available, explicit FK ownership and scoped authorization.

The existing channel-selection `(order_id,slot_index)` FK becomes DEFERRABLE INITIALLY IMMEDIATE. The transition defers this one constraint only for its paired current-rights/channel-preference update and explicitly validates it immediately afterward. All other callers retain immediate checking; no FK is removed or disabled.

## Implementation and verification

1. `scripts/live-customer/existing-business-regression.mjs/sql`: disposable real PostgreSQL fixture with an existing Test company and same-plan settled Live order. Observe the missing transition before implementing.
2. `scripts/live-customer/existing-business-live.sql`: reviewed schema/transition/finish routing and narrowly pinned operational readiness change. Preserve installed SQL sources and baseline function ACLs.
3. Test exact target/owner/session/payment/currency/catalog/plan, no prepayment business write, one-company/branch identity, immutable Test history, one Live rights set, unchanged Test subscription/balance, unchanged company/content, channel proof revalidation, unstarted clock, retry, concurrent finish calls and forced exception rollback. No real provider calls.
4. Build a hash-pinned review installer with the one actual target row only after source/native tests pass. Present its SQL, footprint, risks and exact hash for human approval. Do not apply during preparation.
5. After approval, apply once and verify native invariants; invoke the existing authenticated finish action on the same paid order and inspect `/setup`. No card flow, state shortcut or publication.

## Acceptance boundary

Local SQL PASS does not prove Meta/AI/service operation. Docker unavailability blocks native transaction/concurrency evidence and therefore blocks the hosted approval package; never replace these with mocked success.
