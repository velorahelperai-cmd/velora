# Preserved WhatsApp review resolution

Scope: owner-authorized transition from an expired, pending new-number attempt to Coexistence on a different WhatsApp Business App number. This is not evidence that the old provider connection failed or succeeded.

The existing private review receipt records the operator decision. A postgres-only function checks the exact review/owner/company/branch/attempt/generation, current paid rights and latest revision, checkpoint digest and Meta asset IDs. It refuses claimed, unknown, staged or connected attempts. It retires only the expired pending local and legacy attempt, increments the scope revision and records `closed_preserved` atomically. No provider request, credential decryption, asset deletion, subscription or billing mutation is involved.

The checkpoint and Vault reference remain unchanged and protected. The old attempt cannot be resurrected; only Coexistence with the reviewed phone may be the next native attempt. Existing authentication, session, ownership, paid rights, provider identity and completion checks remain in force. A new authorization cannot reuse the retired callback. Provider registration, subscription and actual messaging acceptance remain separately unverified.

Verification uses the real project schema and Vault in a disposable network-isolated PostgreSQL database. It covers bad scope/generation/digest, same phone, rollback, idempotence, deletion/detachment/discard, old attempt resurrection, disallowed successor and the native Coexistence start. Only synthetic credentials and phone values are used.

Recovery: any failure before transaction commit rolls back the review, native attempt, legacy attempt and revision together. After commit, retain the review/checkpoint/Vault protections. Do not undo the decision after a successor starts, delete evidence, restore an expired authorization, or remove protection triggers as a deployment rollback. If continuation fails, keep provider state UNKNOWN and investigate the new attempt independently.

Operational evidence and deployment/application status are recorded separately; this document alone does not authorize or prove a Production transition.

Local evidence 2026-10-29: reproduced `MISSING_ADMINISTRATIVE_RESOLUTION` before implementation. On the isolated native schema, concurrent decisions yielded exactly one `closed_preserved` and one `already_resolved`. Scope/generation/digest/same-phone and in-flight denials, transaction rollback, retained checkpoint/Vault, deletion/detachment/discard and old-callback denials, session enforcement, rejected alternative flow/phone, valid native Coexistence successor, no connection fabrication and unchanged subscription clock all passed. An initial local fixture setup and function-owner mismatch were corrected; no provider acceptance is claimed by these tests.
