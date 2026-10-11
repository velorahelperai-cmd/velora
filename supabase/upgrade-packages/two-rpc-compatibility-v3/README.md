# Two-RPC compatibility repair v3

This manual upgrade package preserves the exact reviewed lead-state v3 and staff-dispatch SQL supplied by the desktop parent. It is not an applied migration record or an automatic deployment step. No SQL was executed while packaging it in cloud. The owner authorized publication after the desktop installation report.

Desktop reports **production installation succeeded and was verified** in `vmpifljyozsbtssxhoxd`. Both transactions committed under the actual migration records:

| Applied version | Applied name | Preserved artifact |
| --- | --- | --- |
| `20261011063646` | `velora_lead_state_authority_compatibility_v3` | `10-lead-state.v3.sql` |
| `20261011063723` | `velora_staff_dispatch_authority_compatibility_v2` | `20-staff-dispatch.candidate.sql` |

Desktop verified all seven installed function bodies against reviewed SQL, six new functions, five columns, two validated checks, two enabled guards, two authenticated-only public RPCs, four owner-only private helpers and the existing service-only claim. All 288 production-compared original function owners/ACLs and 55 previous migration records were unchanged; the 310-function preservation count belongs to the isolated review baseline. These are desktop verification reports; cloud verified artifact integrity only. An initial automatic review denial left both transactions unapplied; the owner subsequently explicitly revoked the original SQL prohibition in the desktop execution context before the successful installation.

These applied artifacts and their history mapping are intentionally stored only in this upgrade package. Static source comparison shows that `supabase/migrations/20261006140000_vel_leads_journey_01.sql` already creates the lead RPC, and `supabase/migrations/20261010092530_staff_final_dispatch_authority.sql` creates the staff RPC and provenance columns. Appending these baseline-pinned compatibility files to that canonical chain would fail their target-absence preflight. No full-chain replay was performed or is claimed to work. No preflight was weakened, prior migration relabelled, or duplicate canonical migration added.

The parent reports independent approval of exact v3 with R1–R4 closed, 126 passing actual PostgreSQL test groups, fixed-ack 16/16, assignment/delegation and inbox contract/race coverage, and all 15 preflight cases passing. The author-owned isolate was reportedly removed. The evidence file location is recorded in `manifest.json`; that desktop file was not available here, and these tests were not rerun in cloud. Historical approval-pending comments inside the SQL remain untouched to preserve the exact reviewed bytes. The rejected v1 archive is provenance only and is not included or reapplied.

Cloud verification checks the following exact byte counts and SHA256 hashes:

| File | Bytes | SHA256 |
| --- | ---: | --- |
| `10-lead-state.v3.sql` | 13837 | `ff5c71c39eb4074f7464a43cdf9f13f62acdd9905ee5725efb5778d5449d4887` |
| `20-staff-dispatch.candidate.sql` | 22789 | `09dc668461080d235e4a3b5d62580fbcb15c71e99de9585e0162040616a3de97` |

Lead v3 was reconstructed from the supplied v2 and exact v3 patch; staff SQL was supplied unchanged. Transport HTML entities were decoded and file endings matched against the required hashes. No SQL semantics were edited. The files retain their own transactions and prerequisite checks; desktop performed the separately authorized installation and final verification reported above.

The reviewed scope is two authenticated-only public RPCs, `upsert_conversation_lead_state(uuid,integer,text,text,text,text,timestamptz)` and `whatsapp_authorize_staff_dispatch(uuid,uuid)`, four private helper/trigger functions, two enforcement triggers, five staff provenance columns and two completeness constraints. The existing claim RPC remains service-only, with receipt enforcement added to its body. The parent reports owner/ACL preservation against 310 isolated-baseline functions and 288 production-compared functions. This package adds no application UI, credentials, auto-apply script, or historical backfill.

The reported emergency recovery approach is to revoke authenticated execution of the two new endpoints while preserving provenance, guards and history. Reverting the old claim body or dropping guards or columns requires separate approval. No recovery SQL or execution is added here.
