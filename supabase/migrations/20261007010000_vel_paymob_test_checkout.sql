-- Paymob Test checkout, durable claim before external I/O. Apply to the TEST environment first.
-- Existing order immutability and settlement procedures remain intact.
create or replace function private.billing_pin_test_provider_amount()
returns trigger language plpgsql set search_path = public, private, pg_temp as $$
declare factor numeric; amount numeric;
begin
 if nullif(current_setting('velora.test_omr_units', true),'') is null then return new; end if;
 factor := current_setting('velora.test_omr_units', true)::numeric;
 if new.provider_environment <> 'test' or new.currency <> 'OMR' or factor <= 0 or factor > 1000000 or factor <> trunc(factor) then raise exception 'invalid test conversion'; end if;
 amount := new.amount_baisa::numeric * factor / 1000;
 if amount <= 0 or amount <> trunc(amount) or amount > 9007199254740991 then raise exception 'provider amount not exactly representable'; end if;
 new.provider_amount := amount::bigint;
 new.provider_amount_unit := 'paymob_amount';
 return new;
end; $$;
drop trigger if exists billing_pin_test_provider_amount_trg on public.billing_orders;
create trigger billing_pin_test_provider_amount_trg before insert on public.billing_orders for each row execute function private.billing_pin_test_provider_amount();

create or replace function public.billing_create_test_checkout_order(p_input jsonb, p_units_per_omr integer)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare result jsonb;
begin
 if p_input->>'p_provider_environment' <> 'test' or p_units_per_omr <= 0 or p_units_per_omr > 1000000 then raise exception 'test only'; end if;
 perform set_config('velora.test_omr_units', p_units_per_omr::text, true);
 result := public.billing_create_or_reuse_subscription_order(
 (p_input->>'p_company_id')::uuid,p_input->>'p_product_code',p_input->>'p_purchase_purpose',
 (p_input->>'p_plan_version_id')::uuid,(p_input->>'p_requested_plan_id')::uuid,
 p_input->>'p_client_op_id',p_input->>'p_input_fingerprint',p_input->>'p_special_reference',
 (p_input->>'p_amount_baisa')::bigint,p_input->>'p_currency',(p_input->>'p_period_days')::integer,
 p_input->>'p_period_unit',(p_input->>'p_period_count')::integer,p_input->>'p_provider_account_ref',
 p_input->>'p_provider_environment',(p_input->>'p_created_by')::uuid);
 perform set_config('velora.test_omr_units','',true);
 return result;
end; $$;
revoke all on function public.billing_create_test_checkout_order(jsonb,integer) from public,anon,authenticated;
grant execute on function public.billing_create_test_checkout_order(jsonb,integer) to service_role;

create table if not exists public.billing_test_checkouts (
 payment_attempt_id uuid primary key references public.billing_payment_attempts(id) on delete restrict,
 company_id uuid not null references public.companies(id) on delete restrict,
 order_id uuid not null references public.billing_orders(id) on delete restrict,
 status text not null default 'claiming' check(status in ('claiming','ready')),
 checkout_url text,
 provider_intention_id text,
 created_at timestamptz not null default now()
);
alter table public.billing_test_checkouts enable row level security;
revoke all on public.billing_test_checkouts from public,anon,authenticated;
grant select,insert,update on public.billing_test_checkouts to service_role;

create or replace function public.billing_claim_test_checkout(p_company_id uuid,p_order_id uuid,p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare ord public.billing_orders%rowtype; attempt public.billing_payment_attempts%rowtype; saved public.billing_test_checkouts%rowtype;
begin
 -- Same lock order as purchase persistence: company -> order -> attempt.
 perform 1 from public.companies where id=p_company_id and status <> 'suspended' for update;
 if not found then return jsonb_build_object('kind','rejected','code','not_owner'); end if;
 select * into ord from public.billing_orders where id=p_order_id and company_id=p_company_id for update;
 if not found or ord.provider_environment <> 'test' or ord.status not in ('locked','submitted') or ord.provider_amount is null then return jsonb_build_object('kind','rejected','code','order_not_ready'); end if;
 select * into attempt from public.billing_payment_attempts where id=p_attempt_id and order_id=p_order_id and company_id=p_company_id for update;
 if not found then return jsonb_build_object('kind','rejected','code','order_not_ready'); end if;
 -- Terminal attempts must never reopen a stored checkout.
 if attempt.status in ('paid','failed') then return jsonb_build_object('kind','pending'); end if;
 select * into saved from public.billing_test_checkouts where payment_attempt_id=p_attempt_id;
 if found then
  if saved.status='ready' then return jsonb_build_object('kind','ready','url',saved.checkout_url); end if;
  return jsonb_build_object('kind','pending');
 end if;
 if attempt.status <> 'intent_created' or attempt.provider_order_id is not null then return jsonb_build_object('kind','pending'); end if;
 insert into public.billing_test_checkouts(payment_attempt_id,company_id,order_id) values(p_attempt_id,p_company_id,p_order_id);
 -- A crash or timeout stays unresolved: no automatic second collection.
 update public.billing_payment_attempts set status='unresolved',updated_at=now() where id=p_attempt_id;
 return jsonb_build_object('kind','claimed');
end; $$;
revoke all on function public.billing_claim_test_checkout(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.billing_claim_test_checkout(uuid,uuid,uuid) to service_role;

create or replace function public.billing_complete_test_checkout(p_company_id uuid,p_order_id uuid,p_attempt_id uuid,p_provider_order_id text,p_checkout_url text,p_intention_id text)
returns boolean language plpgsql security definer set search_path = public, private, pg_temp as $$
begin
 if p_provider_order_id !~ '^[0-9]+$' or p_checkout_url not like 'https://om.checkout.paymob.com/?%' then return false; end if;
 perform 1 from public.companies where id=p_company_id for update;
 perform 1 from public.billing_orders where id=p_order_id and company_id=p_company_id and provider_environment='test' and status='locked' for update;
 if not found then return false; end if;
 perform 1 from public.billing_payment_attempts where id=p_attempt_id and company_id=p_company_id and order_id=p_order_id and status='unresolved' and provider_order_id is null for update;
 if not found then return false; end if;
 update public.billing_test_checkouts set status='ready',checkout_url=p_checkout_url,provider_intention_id=p_intention_id where payment_attempt_id=p_attempt_id and company_id=p_company_id and order_id=p_order_id and status='claiming';
 if not found then return false; end if;
 update public.billing_payment_attempts set provider_order_id=p_provider_order_id,status='provider_submitted',updated_at=now() where id=p_attempt_id;
 update public.billing_orders set status='submitted' where id=p_order_id;
 return true;
end; $$;
revoke all on function public.billing_complete_test_checkout(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.billing_complete_test_checkout(uuid,uuid,uuid,text,text,text) to service_role;

-- Native idle-session enforcement also covers this server-only backing table.
drop policy if exists velora_active_session on public.billing_test_checkouts;
create policy velora_active_session on public.billing_test_checkouts as restrictive for all to authenticated
 using ((select public.app_session_is_valid())) with check ((select public.app_session_is_valid()));
