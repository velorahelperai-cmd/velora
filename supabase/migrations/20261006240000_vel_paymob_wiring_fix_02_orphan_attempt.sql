-- VEL-PAYMOB-TEST-WIRING-FIX-02
-- Atomic orphan bootstrap: at most one intent_created attempt without provider_order_id per order.
-- Allows later legitimate attempts after failed/paid/unresolved (those rows leave this predicate).
-- Concurrent orphan repairs collide here and re-read the same attempt id.
-- NOT applied to cloud from this package alone.

create unique index if not exists billing_payment_attempts_orphan_bootstrap_uidx
  on public.billing_payment_attempts (order_id)
  where provider_order_id is null
    and status = 'intent_created';

comment on index public.billing_payment_attempts_orphan_bootstrap_uidx is
  'WIRING-FIX-02: serialize concurrent orphan repair; does not block new attempts after failed/unresolved/paid lifecycle.';
