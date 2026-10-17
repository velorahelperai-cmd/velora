# WP01A post-stage cleanup package

Independent of `supabase/migrations/` (historical installers retained).

| File | Gate | Scope |
|---|---|---|
| `20261017180000_wp01a_post_stage_cleanup_phase_a_gated.sql` | `WP01A-POST-STAGE-PHASE-A` | Deny stubs replaced by continuity |
| `20261017181000_wp01a_post_stage_cleanup_phase_b_gated.sql` | `WP01A-POST-STAGE-PHASE-B` | Nine Auth-excluded installers' objects |

## Paths

- **Fresh Auth WP01A:** sorted migrations with Auth-scope skip of the nine; Phase B objects absent; optional Phase A under gate.
- **Existing DB that applied the nine:** backup, then gated Phase A then Phase B; RESTRICT only; no CASCADE.
- **Production:** forbidden until owner names project ref + object/data-loss list.

## Restore

DB backup taken before gated apply, or rebuild fixture from historical `supabase/migrations/`.
