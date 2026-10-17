# es02-hosted-compat

Local self-contained Supabase upgrade package for the **actual hosted PhaseB footprint** (project `vmpifljyozsbtssxhoxd`, latest migration `20261016220450`).

**Status:** Implemented / Not Verified (local package only). No hosted apply. Not Production Ready.

## What this package adds

| Area | Change |
|------|--------|
| Native broker / revocation | Final WP01A broker schema + `20261014033007` revocation surface; preflight pins **full** `pg_get_functiondef` MD5 of hosted PhaseB kernel (not prosrc) before OID-preserving rewrite |
| Identity native-session boundary | Minimal fragment after 33007 / before broker `080000`: `master_identity_session_boundaries` (empty default) + `master_identity_session_current` + snapshot public app/check → `private.master_identity_pre_*` + exact public wrappers (33009:14–22,27–28,31–35 only). **No** phone enrollment/change/attestation/apply. Public OIDs preserved; public EXECUTE = authenticated only (service_role revoked). Idle/expiry/revocation remain via password `pre_*` snapshots |
| Recovery | REVIEW/STATUS only: minimal private tables + tip-fenced public open/read overloads from `20261016180000`. Policy `enabled=false`. No phone-change, attestation apply, or identity replacement |
| ES02 | Cumulative effective 12→15 account financial/rights in one transaction, plus primary-compat `20261017160000` |
| Owned RPC EXECUTE (C4) | Hosted `postgres`/`public` default function EXECUTE includes `service_role`; C2 `REVOKE` of `public`/`anon` alone leaves it. Fragment `03-owned-rpc-execute-boundary.sql` (after `es02-140000`, before unchanged C3 guard) `REVOKE ALL` from `public`,`anon`,`service_role` then `GRANT EXECUTE` to `authenticated` on the five owned RPCs: `es02_create_account_order(uuid,uuid,text,jsonb,boolean)`, `es02_read_owned_purchase(uuid)`, `es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)`, `es02_read_activation_foundation(uuid,uuid)`, `es02_reconcile_activation_readiness(uuid,uuid)`. No body/owner/signature/RLS/default-privilege changes. Missing exact signatures fail closed. **New package fingerprint requires separate hosted apply approval** after Codex rebuilds `upgrade.sql`/`manifest.json`. |
| Capability ACL semantic (C5) | Root cause: final contract compared `proacl::text` / `relacl::text`, so identical grants with different ACL entry or privilege-character order (proven on `public.vel_broker_revoke_sessions_at(uuid,text,timestamptz)`) failed postflight. Fragment `04-capability-acl-semantic.sql` (after `wp01a-170000`, before postflight) redefines only `private.vel_broker_capability_contract_matches()`: frozen expected function/table/column arrays, body hashes, result/owner/config/definer/volatility/RLS/types unchanged; ACL text equality replaced by symmetric `aclexplode` set equality of `(grantee,grantor,privilege_type,is_grantable)` with `acldefault('f'\|'r', owner)` for null ACLs; plus effective `anon`/`authenticated`/`service_role` rights via `has_function_privilege` / `has_table_privilege` vs pinned PUBLIC/direct grants only (rejects unexpected inherited authority; does not bless unrelated role memberships). Business grants, C3 guard, preflight/postflight/deny fences, five-owned-RPC fragment, and `public.vel_broker_capability_probe` unchanged. **Codex rebuilds `upgrade.sql`/`manifest.json`.** |
| Broker table/sequence ACL (C6/C7) | Hosted CREATE defaults grant table/sequence ALL to `service_role` (and often anon/auth). Source only revoked PUBLIC/anon/auth then granted CRUD on six broker tables, so service retained TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. Sequences `public.vel_broker_auth_intents_ordinal_seq` (bigserial) and `public.vel_broker_browser_issue_seq` are owner-postgres only in source; hosted sequence defaults would leak direct nextval/setval/SELECT. Fragment `05-broker-table-sequence-acl.sql` (end of inputs, after primary compat, before final fences) restores postgres ALL + service CRUD on the six tables and postgres-only on both sequences; final `$broker_acl_boundary$` asserts semantic ACL tuples + effective runtime rights/grant-options. **C7:** `acldefault` type mapping — lowercase `'s'` = SEQUENCE default SELECT/UPDATE/USAGE; uppercase `'S'` = FOREIGN SERVER USAGE-only (not `pg_default_acl.defaclobjtype`). C6 wrongly used `'S'` and rejected correct owner RWU. No body/owner/default-privilege/RLS/data changes; frozen capability arrays/probe untouched. **New package fingerprint requires separate hosted apply approval** after Codex rebuilds `upgrade.sql`/`manifest.json`. |
| Synthetic settle | Final `REVOKE ALL … FROM public, anon, authenticated, service_role` on `es02_settle_account_order_synthetic(jsonb)` |
| Primary branch | Reuse existing primary if present; else atomically insert first paid validated branch as primary (no enterprise trigger resurrection) |

## Files

| File | Role |
|------|------|
| `preflight.sql` | READ ONLY; reject native MD5 drift / partial footprint |
| `upgrade.sql` | Concrete atomic expand (generated by `build.mjs` from pinned inputs) |
| `postflight.sql` | READ ONLY grants/RLS/unique/synthetic-deny/policy asserts |
| `deny-rollback.sql` | Revoke runtime entrypoints; preserve data/guards/tips |
| `manifest.json` | Input sha256 pins + hosted baseline metadata |
| `build.mjs` | Regenerates `upgrade.sql` + `20261017160000_…` from sources (Codex rebuilds after delivery) |
| `fragments/02-identity-native-session-boundary.sql` | Minimal C5 identity boundary (not full 33009) |
| `fragments/03-owned-rpc-execute-boundary.sql` | Auth-only EXECUTE on five owned ES02 RPCs (service_role revoked) |
| `fragments/04-capability-acl-semantic.sql` | Semantic ACL tuples + effective runtime-role rights for final capability contract |
| `fragments/05-broker-table-sequence-acl.sql` | Six broker tables + two sequence privilege restoration + `$broker_acl_boundary$` |

Pinned ES02 migrations `20261017120000`–`20261017150000` remain byte-for-byte in `supabase/migrations/`. Source WP01A migrations including `20261016170000` remain untouched; fragment overlays the final contract comparer only.

## Apply order (local fixture / future approved hosted)

1. Backup / PITR restore point (operator).
2. `preflight.sql` — must succeed.
3. `upgrade.sql` — one transaction.
4. `postflight.sql` — must succeed.
5. Application cutover only after separate key/runtime approval (not this package).

**Repeat apply:** `preflight.sql` and `upgrade.sql` accept **only** the pre-expand PhaseB footprint with pinned hosted **full-definition** kernel MD5s (`5f3313…` / `7d7b35…` via `md5(replace(pg_get_functiondef(oid), chr(13), ''))`) plus owner/definer/`search_path=""`/grant checks. They **deterministically reject** when the final package footprint is already installed (old kernel pins do not apply after 33007 rewrite — run `postflight.sql` only). Partial footprints raise. Never duplicate financial rows. Prosrc MD5s (`b42c28…` / `f69c47…`) are informational only and are never compared.

**Capability contract:** pre-COMMIT and `postflight.sql` require `private.vel_broker_capability_contract_matches()` and `public.vel_broker_capability_probe()->>'ok'` (actual C5 RPC name; probe invoked under `service_role`, its EXECUTE grant). Frozen body/result/owner/config hashes unchanged; ACL comparison is semantic set equality of expanded privilege tuples plus effective PUBLIC/direct runtime-role rights (inheritance in scope only as a reject signal). Drift fails the whole upgrade transaction before commit.

## Rollback decision

- Prefer **PITR / restore** to pre-upgrade checkpoint for data-correct rollback.
- `deny-rollback.sql` is a **runtime deny overlay** (revoke EXECUTE on broker/ES02/recovery entrypoints). It does **not** drop tables, clear sessions, reset expiry/generation, or restore native-only old auth bodies.

## Reauthentication / key continuity

- Broker expand does not reset session generation or invent old-cookie fallbacks.
- Concurrent native + broker authority remains the accepted ES01 contract.
- Hosted key/environment changes are **out of scope** until exact separate approval.
- Paymob external verification remains **Deferred**; runtime cannot manufacture paid state via synthetic settle.

## Out of scope

- Full historical migration replay, CASCADE cleanup, enterprise/smart/phone/checkout resurrection
- ES03, UI/payment wiring, images, provider activation
- Claiming Production Ready or hosted apply completed

## Codex verification (not Cursor)

Hosted-profile baseline parity, forward/rollback/drift/grants, native login/broker/recovery, primary-present/absent paid provision, then clean candidate release gates + secret scans.
