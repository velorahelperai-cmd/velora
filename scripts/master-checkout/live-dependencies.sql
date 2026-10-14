-- Offline provider/service boundary ports. No provider execution or settlement claim.
create table private.billing_service_offers(plan_version_id uuid primary key,service_code text,tier text,capabilities text[]);
create table private.ai_plan_budget_policies(plan_version_id uuid primary key,monthly_limit_baisa bigint);
create table private.billing_service_order_offers(order_id uuid primary key,plan_version_id uuid,service_code text,tier text,capabilities text[],environment text);
create table private.billing_live_merchant_contracts(id uuid primary key,integration_id bigint,merchant_owner_id text,units_per_omr integer,currency text,deadline_policy_approved boolean,verified_at timestamptz);
create table private.billing_live_order_bindings(order_id uuid primary key,contract_id uuid,plan_version_id uuid,allowance_cap bigint,monthly_limit_baisa bigint);
create table private.billing_live_checkouts(payment_attempt_id uuid primary key,order_id uuid,company_id uuid,status text default 'claiming',checkout_url text,provider_intention_id text,created_at timestamptz default clock_timestamp());
create function private.master_activation_blocks_purchase(uuid) returns boolean language sql as $$select false$$;
create function private.master_activation_company_end(cid uuid) returns timestamptz language sql as $$select max(paid_through) from public.billing_subscriptions where company_id=cid and environment='live'$$;
create function private.master_activation_waiting(uuid) returns boolean language sql as $$select false$$;
create function private.fixture_pin_provider() returns trigger language plpgsql as $$begin if new.provider_environment='live' then new.provider_amount:=new.amount_baisa;new.provider_amount_unit:='paymob_amount';end if;return new;end;$$;
create trigger fixture_provider_port before insert on public.billing_orders for each row execute function private.fixture_pin_provider();
create function private.fixture_service_snapshot() returns trigger language plpgsql as $$begin insert into private.billing_service_order_offers select new.id,new.plan_version_id,service_code,tier,capabilities,'live' from private.billing_service_offers where plan_version_id=new.plan_version_id;return new;end;$$;
create trigger fixture_service_port after insert on public.billing_orders for each row execute function private.fixture_service_snapshot();
insert into public.billing_catalog_revision values(true,1) on conflict do nothing;
-- Explicit offline E boundary double; E agent verifies real credit ledger.
create table private.fixture_upgrade_credit_calls(receipt_id uuid primary key);
create function public.master_apply_cycle_upgrade(p_company_id uuid,p_receipt_id uuid) returns jsonb language plpgsql as $$begin insert into private.fixture_upgrade_credit_calls values(p_receipt_id) on conflict do nothing;return '{"ok":true}'::jsonb;end;$$;
