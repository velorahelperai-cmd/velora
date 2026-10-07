-- VEL-SUBSCRIPTION-SINGLE-PRODUCT-FIX-01
-- One subscription product per company. Open purchase key =
--   (company_id, product_code, purchase_purpose) while locked/submitted.
-- plan_version_id remains the catalog price/tier/cycle row — not the open-purpose key.
-- Replaces company+plan_version open index from CAPACITY-01.
-- Does NOT modify attempt-repair FIX-03 functions.
-- Upgrade collection / proration NOT configured here.
-- NOT applied to cloud from this package alone.

alter table public.billing_orders
  add column if not exists product_code text;

alter table public.billing_orders
  add column if not exists purchase_purpose text;

-- Backfill existing rows to the single product + initial purpose.
update public.billing_orders
set product_code = coalesce(nullif(btrim(product_code), ''), 'velora_ai_staff')
where product_code is null or btrim(product_code) = '';

update public.billing_orders
set purchase_purpose = coalesce(nullif(btrim(purchase_purpose), ''), 'initial')
where purchase_purpose is null or btrim(purchase_purpose) = '';

alter table public.billing_orders
  alter column product_code set default 'velora_ai_staff';

alter table public.billing_orders
  alter column product_code set not null;

alter table public.billing_orders
  alter column purchase_purpose set not null;

do $$
begin
  alter table public.billing_orders
    drop constraint if exists billing_orders_product_code_chk;
  alter table public.billing_orders
    add constraint billing_orders_product_code_chk
    check (
      char_length(btrim(product_code)) between 1 and 64
      and product_code = btrim(product_code)
    );

  alter table public.billing_orders
    drop constraint if exists billing_orders_purchase_purpose_chk;
  alter table public.billing_orders
    add constraint billing_orders_purchase_purpose_chk
    check (purchase_purpose in ('initial', 'renew', 'upgrade'));
exception
  when duplicate_object then null;
end;
$$;

comment on column public.billing_orders.product_code is
  'VEL-SUBSCRIPTION-SINGLE-PRODUCT-FIX-01: fixed commercial product (velora_ai_staff). Tiers/cycles are plan_version rows, not products.';

comment on column public.billing_orders.purchase_purpose is
  'VEL-SUBSCRIPTION-SINGLE-PRODUCT-FIX-01: initial | renew | upgrade. Open-order uniqueness uses this with company+product, not plan_version_id.';

-- Drop plan_version-scoped open index if present.
drop index if exists public.billing_orders_open_purpose_uidx;

-- At most one open order per company + product + purpose (any plan_version/tier/cycle).
create unique index if not exists billing_orders_open_product_purpose_uidx
  on public.billing_orders (company_id, product_code, purchase_purpose)
  where status in ('locked', 'submitted');

comment on index public.billing_orders_open_product_purpose_uidx is
  'SINGLE-PRODUCT-FIX-01: serialize open purchase by company+product+purpose; tier/cycle/version changes reuse this key.';
