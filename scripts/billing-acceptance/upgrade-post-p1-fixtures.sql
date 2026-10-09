-- Execute the ACTUAL historical reversal helper after P1 schema exists, before
-- any acceptance forward fix. Old collection + newer good receipt already exist.
-- The old helper revokes old grant/order/attempt AND globally suspends the newer
-- valid subscription, a materially different fixture from appending refund flags.
select private.billing_apply_reversal(
 md5('acceptance-upgrade-company-actual_reversed_with_newer_live')::uuid,
 md5('acceptance-upgrade-order-actual_reversed_with_newer_livelive')::uuid,
 md5('acceptance-upgrade-attempt-actual_reversed_with_newer_livelive')::uuid,
 'refunded','{"fixture_only":true}'::jsonb);
select private.billing_apply_reversal(
 md5('acceptance-upgrade-company-security_suspended_actual_reversal')::uuid,
 md5('acceptance-upgrade-order-security_suspended_actual_reversallive')::uuid,
 md5('acceptance-upgrade-attempt-security_suspended_actual_reversallive')::uuid,
 'refunded','{"fixture_only":true}'::jsonb);
update public.companies set status='suspended' where id=md5('acceptance-upgrade-company-security_suspended_actual_reversal')::uuid;
update public.companies set status='suspended' where id=md5('acceptance-upgrade-company-company_only_suspended_live')::uuid;
select private.billing_apply_reversal(
 md5('acceptance-upgrade-company-manual_suspended_live')::uuid,
 md5('acceptance-upgrade-order-manual_suspended_livelive')::uuid,
 md5('acceptance-upgrade-attempt-manual_suspended_livelive')::uuid,
 'refunded','{"fixture_only":true}'::jsonb);
-- A NULL date contradicts the historical helper's non-NULL truncation. Even if
-- a legacy/manual correction retained its timestamp, attribution is unknown.
update public.billing_subscriptions set status='suspended',paid_through=null
 where id=md5('acceptance-upgrade-sub-manual_suspended_live')::uuid;
update public.billing_subscriptions set status='past_due',updated_at=clock_timestamp()
 where id=md5('acceptance-upgrade-sub-past_due_live')::uuid;
select private.billing_apply_reversal(
 md5('acceptance-upgrade-company-revoked_unverified_with_newer_live')::uuid,
 md5('acceptance-upgrade-order-revoked_unverified_with_newer_livelive')::uuid,
 md5('acceptance-upgrade-attempt-revoked_unverified_with_newer_livelive')::uuid,
 'refunded','{"fixture_only":true}'::jsonb);
