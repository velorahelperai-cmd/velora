# Check variable collision review

Candidate SHA256: a81eccfa37a256f9acd609de4d2c08a4ffa0d438acec31efdb39a323759a8d6f

Compared against previously approved 342c5f4319c75028f270ce259144b3f7174c3dca92ecd6275b478ad4d6671511. NOT APPLIED.

- Postflight `t` -> `v_postflight_table`: removes conflict with catalog-derived output column `t`.
- Postflight `r` -> `v_postflight_role`: removes conflict with `pg_roles r` catalog alias.
- Postflight `f` -> `v_postflight_item`: distinctive loop variable throughout all three JSON loops.
- Postflight `actual` -> `v_postflight_catalog`: distinctive capture target and references.
- Existing `v_postflight_proc` retained; reviewed against pg_proc/table references.
- Preflight declarations `actual` and `object_name` reviewed against all embedded catalog aliases, output columns and its company/history/job queries: no shared identifiers; unchanged.
- Catalog aliases/columns remain unchanged, including `p`, `r`, `t`; no variable_conflict override, disabled guard or changed SQL predicate.

Scope proof: reverse the four renamed variables in the final SQL and the resulting bytes reproduce the exact previously approved SHA256. Entire manifest is identical except generated SQL hash/size: all function bodies, roles, grants, tables, source pins and security flags preserved. Full line changes are in variable-rename.diff.

Verification: deterministic generator, node --check, ESLint and exact byte comparison passed. No database compilation/application or functional tests performed. Static inspection is not proof of successful database execution. Both previous failed attempts remain historical and fully rolled back.

Sources: current generator, catalog-footprint.sql, final SQL and prior actual PostgreSQL 42702 error receipts. No dependency added or Production connection used for this correction. Real payment remains closed; PAYMOB_EXTERNAL_DEFERRED remains independent.
