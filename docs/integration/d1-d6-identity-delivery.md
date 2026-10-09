# D1 and D6 database integration

This forward migration belongs after the reviewed billing chain ending at
`20261008120000`. It uses existing WhatsApp tables and keeps the public RPC
signatures, callers, grants, human control functions and send finalizer intact.

## Database identities

- Conversations retain their original company, phone and customer recipient.
- Messages retain their original company, conversation, provider ID, direction,
  sender, body, type and receipt timestamp.
- Inbound jobs reference the same-company inbound/customer message and original
  provider ID. Their identity and creation timestamp cannot be reassigned.
- Send intents bind to the same-company conversation, phone and recipient, link,
  and outbound message. Their operation and body identity cannot be reassigned;
  provider/message fields can be bound once after acceptance.
- Link IDs stay with their company. New intent snapshots validate the current
  verified link identity and generation; subsequent link changes preserve the
  historical intent snapshot rather than update it.
- Control events and delivery evidence retain their original scope and content.

The migration blocks when existing relationships are inconsistent. It does not
change company IDs, rewrite signed/provider evidence, delete records or guess a
recipient. An operator must review the named relation on the installed database
and explicitly resolve or quarantine it before retrying. Historical unmatched
events and old delivery rank values remain stored; transition decisions use
the actual state and bound durable evidence rather than the old failed rank.

## Delivery evidence

Only an outbound message with the matching company, provider message ID, phone
and conversation recipient can receive delivery evidence. Accepted records
are local send acceptance, while sent/delivered/read/failed snapshots require a
matching durable event. Service-role snapshot updates receive the same checks.

Delivered and read evidence survive conflicting failure events. Before delivery,
sent and failed events advance by provider timestamp; equal-time contradictory
states require review. Lower sent/delivery evidence cannot erase read. Conflict
events remain available as `conflict_review`, and stale valid events are retained
as `ignored_stale`.

Status events received before display persistence stay unmatched. Status writes
and message creation serialize by provider ID; the existing finalizer's rebind
then applies only the verified outbound identity. Global deduplication validates
the immutable original company, phone and recipient before acknowledging a replay.

## Verification and rollout

`scripts/whatsapp-integration/identity-delivery-cases.sql` uses synthetic fixtures,
real service-role writes, actual RPCs and authenticated access checks. It runs in
a rollback transaction on the isolated PostgreSQL harness. The root integration
owns database bootstrap, multi-session concurrency tests and combined validation.
The scoped run reproduced 28 missing-boundary failures before this migration and
passed all 38 assertions after it. Historical RPC owners can differ from the
forward migration owner; the migration grants its pure private transition helper
only to the retained rebind owner, while preserving public RPC permissions.

Local PostgreSQL verification does not prove cloud installation, Supabase Auth
integration, Meta ownership/credentials, provider acceptance or customer rollout.
Those checks and live customer activation remain separate authorization gates.
