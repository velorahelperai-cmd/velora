# Paymob Live checkout compatibility

This package adds a durable, owner-bound Live checkout path. It does not enable Live payments, seed merchant contracts, publish catalog prices, or activate customer services.

Use exactly one installer for the matching starting schema:
- `10-live-checkout.review.sql`: schema-dump baseline `497dc926b6254cc0f58d5bd7b47eb740`, expected result `15fe1d44b7029baaf8523f757e1601e5`.
- `20-production-compatibility.review.sql`: verified production baseline `29c182aae51317576aecfbdfcd543d46`, expected result `f8c55effa6db01409c6611858be3431d`.

The installers differ only in their two strict footprint pins. They are alternatives; do not apply both. Production has four equivalent CHECK expressions with different PostgreSQL expression grouping. The production installer preserves those CHECKs and all existing AI definitions/ACLs. It adds three private RLS tables with all direct client/service CRUD revoked, four service-role-only RPCs, immutable evidence guards, and a Live-specific wrapper retaining the original Test implementation. No configuration or fixture rows belong in a production application.

Before application: confirm exact fresh starting footprint, preserve schema/recovery evidence and financial/AI history digests, review this exact SQL SHA and service-only grants, and verify the matching isolated install. Both installers run in one transaction with pre/post footprint guards. Any mismatch aborts. Never replay historical migrations to satisfy a guard.

Recovery: keep Live flags disabled; preserve any new durable collection evidence. The original snapshot helper is retained as `private.billing_snapshot_bound_service_order_pre_live(uuid,uuid)`. A reviewed forward correction can restore its delegation without deleting checkout, order, payment, or customer history. Do not drop populated tables or reset claims to retry an uncertain provider call.

The ready-repeat regression covers create -> claim -> complete -> create with the same operation -> ready URL reuse, with unchanged stored records and no second collection. Unknown, expired, foreign-tenant and different-operation paths remain blocked. Fixtures are synthetic and isolated only. Real merchant configuration, provider calls, webhook acceptance and customer activation require their separate rollout.
