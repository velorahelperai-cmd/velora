-- VEL-PAYMENT-CONCURRENCY-CAPACITY-01
-- At most one open order per company + plan_version (purchase purpose).
-- Different client_op_id must not open a second charge path for the same purpose.
-- early_renew vs initial_subscribe are mutually exclusive under the purchase gate
-- while a period is active, so company+plan is the open-purpose key.
-- This does NOT prevent external Paymob collection by itself — settlement review does.

create unique index if not exists billing_orders_open_purpose_uidx
  on public.billing_orders (company_id, plan_version_id)
  where status in ('locked', 'submitted');

comment on index public.billing_orders_open_purpose_uidx is
  'VEL-PAYMENT-CONCURRENCY-CAPACITY-01: atomic open purchase purpose (company + plan). Race with distinct client_op_id resolves to one open order.';
