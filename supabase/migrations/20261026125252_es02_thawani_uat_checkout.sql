-- Thawani UAT only. Existing Paymob data and LIVE authority are unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.es02_thawani_test_accounts (
 account_id uuid primary key references auth.users(id), enabled boolean not null default false
);
create table private.es02_thawani_test_checkouts (
 order_id uuid primary key references private.es02_account_orders(id),
 account_id uuid not null references auth.users(id),
 preparation jsonb not null check(jsonb_typeof(preparation)='object'),
 state text not null default 'prepared' check(state in ('prepared','claimed','ready','paid')),
 claim_token uuid, provider_session_id text unique, invoice text unique,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '24 hours', paid_at timestamptz
);
alter table private.es02_thawani_test_accounts enable row level security;
alter table private.es02_thawani_test_checkouts enable row level security;
revoke all on private.es02_thawani_test_accounts,private.es02_thawani_test_checkouts from public,anon,authenticated,service_role;

create function public.es02_begin_thawani_test_checkout(p_expected_account_id uuid,p_client_op_id uuid,p_term text,p_slots jsonb,p_preparation jsonb,p_consent_accepted boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; result jsonb; o private.es02_account_orders; c private.es02_thawani_test_checkouts;
begin
 actor:=private.es02_require_active_actor(p_expected_account_id);
 if actor is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 if not exists(select 1 from private.es02_thawani_test_accounts where account_id=actor and enabled) then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 if p_consent_accepted is distinct from true or jsonb_typeof(p_preparation) is distinct from 'object'
  or jsonb_typeof(p_preparation->'branches') is distinct from 'array'
  or coalesce(length(trim(p_preparation->>'name')),0) not between 1 and 120
  or coalesce(length(trim(p_preparation->>'type')),0) not between 1 and 120
  or coalesce(length(trim(p_preparation->>'city')),0) not between 1 and 120
  or coalesce(p_preparation->>'phone','') !~ '^\+[1-9][0-9]{6,14}$'
 then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
 result:=private.es02_create_test_account_order(actor,p_client_op_id,p_term,p_slots,true);
 if result->>'ok' is distinct from 'true' then return result; end if;
 select * into strict o from private.es02_account_orders where id=(result->'data'->>'orderId')::uuid and account_id=actor for update;
 if o.environment<>'test' or jsonb_array_length(p_preparation->'branches')<>o.branch_slots then raise exception 'INVALID_TEST_PREPARATION'; end if;
 -- An order is never collected through two providers.
 if exists(select 1 from private.es02_test_checkouts where order_id=o.id) then return jsonb_build_object('ok',false,'code','CONFLICT'); end if;
 select * into c from private.es02_thawani_test_checkouts where order_id=o.id for update;
 if c.order_id is not null then
  if c.preparation is distinct from p_preparation then return jsonb_build_object('ok',false,'code','CONFLICT'); end if;
  return result;
 end if;
 if o.status<>'open' then return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED'); end if;
 insert into private.es02_thawani_test_checkouts(order_id,account_id,preparation) values(o.id,actor,p_preparation);
 return result;
end $$;

create function public.es02_claim_thawani_test_checkout(p_account_id uuid,p_order_id uuid,p_auth_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o private.es02_account_orders; c private.es02_thawani_test_checkouts; token uuid;
begin
 if auth.role() is distinct from 'service_role' then return jsonb_build_object('kind','rejected'); end if;
 select * into o from private.es02_account_orders where id=p_order_id and account_id=p_account_id for update;
 if o.id is null or o.environment<>'test' or o.status not in ('open','collection_pending')
  or not private.es02_test_order_catalog_consistent(o)
  or not exists(select 1 from private.es02_thawani_test_accounts where account_id=p_account_id and enabled)
  or not exists(select 1 from auth.sessions where id=p_auth_session_id and user_id=p_account_id and (not_after is null or not_after>clock_timestamp()))
 then return jsonb_build_object('kind','rejected'); end if;
 select * into c from private.es02_thawani_test_checkouts where order_id=o.id and account_id=o.account_id for update;
 if c.order_id is null then return jsonb_build_object('kind','rejected'); end if;
 if c.state='ready' and c.expires_at>clock_timestamp() then return jsonb_build_object('kind','ready','sessionId',c.provider_session_id); end if;
 if c.state<>'prepared' or c.expires_at<=clock_timestamp() then return jsonb_build_object('kind','pending'); end if;
 token:=gen_random_uuid();
 update private.es02_thawani_test_checkouts set state='claimed',claim_token=token where order_id=o.id;
 update private.es02_account_orders set status='collection_pending',updated_at=clock_timestamp() where id=o.id;
 return jsonb_build_object('kind','claimed','token',token);
end $$;

create function public.es02_complete_thawani_test_checkout(p_account_id uuid,p_order_id uuid,p_claim_token uuid,p_session_id text,p_invoice text)
returns boolean language plpgsql security definer set search_path='' as $$
declare c private.es02_thawani_test_checkouts;
begin
 if auth.role() is distinct from 'service_role' then return false; end if;
 select * into c from private.es02_thawani_test_checkouts where order_id=p_order_id and account_id=p_account_id for update;
 if c.order_id is null or c.state<>'claimed' or c.claim_token is distinct from p_claim_token
  or coalesce(p_session_id,'') !~ '^checkout_[A-Za-z0-9]{8,150}$' or coalesce(p_invoice,'') !~ '^[0-9]{1,50}$'
 then return false; end if;
 update private.es02_thawani_test_checkouts set state='ready',provider_session_id=p_session_id,invoice=p_invoice where order_id=c.order_id;
 return true;
end $$;

create function public.es02_record_thawani_test_payment(p_account_id uuid,p_order_id uuid,p_session_id text,p_claim_token uuid,p_invoice text,p_amount_baisa integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.es02_thawani_test_checkouts; o private.es02_account_orders;
begin
 if auth.role() is distinct from 'service_role' then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 select * into o from private.es02_account_orders where id=p_order_id and account_id=p_account_id for update;
 select * into c from private.es02_thawani_test_checkouts where order_id=o.id and account_id=o.account_id for update;
 if o.id is null or c.order_id is null or o.environment<>'test' or c.state not in ('ready','paid')
  or c.claim_token is distinct from p_claim_token or c.provider_session_id is distinct from p_session_id
  or c.invoice is distinct from p_invoice or o.amount_baisa is distinct from p_amount_baisa
  or not private.es02_test_order_catalog_consistent(o)
  or not exists(select 1 from private.es02_thawani_test_accounts where account_id=o.account_id and enabled)
 then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 if c.state='paid' then return jsonb_build_object('ok',true,'outcome','duplicate'); end if;
 -- A late return may still carry a server-verified payment made before expiry.
 if o.status not in ('open','collection_pending') then return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED'); end if;
 insert into private.es02_account_settlement_events(order_id,account_id,evidence_marker,provider_transaction_id,amount_baisa,currency,outcome,detail_code)
 values(o.id,o.account_id,'thawani_api_verified_uat','thawani-uat:'||c.invoice,o.amount_baisa,'OMR','applied','THAWANI_UAT');
 update private.es02_account_orders set status='settled',settled_at=clock_timestamp(),updated_at=clock_timestamp() where id=o.id and environment='test';
 update private.es02_thawani_test_checkouts set state='paid',paid_at=clock_timestamp() where order_id=o.id;
 return jsonb_build_object('ok',true,'outcome','settled');
end $$;

create function public.es02_read_thawani_test_payment(p_expected_account_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; c private.es02_thawani_test_checkouts; o private.es02_account_orders;
begin
 actor:=private.es02_require_active_actor(p_expected_account_id);
 if actor is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 if not exists(select 1 from private.es02_thawani_test_accounts where account_id=actor and enabled) then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 select * into o from private.es02_account_orders where id=p_order_id and account_id=actor;
 select * into c from private.es02_thawani_test_checkouts where order_id=p_order_id and account_id=actor;
 if o.id is null or c.order_id is null or o.environment<>'test' then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('order',private.es02_test_order_view(o),'state',c.state,'paidAt',c.paid_at,'expiresAt',c.expires_at,'sessionId',c.provider_session_id,'claimToken',c.claim_token));
end $$;

create function public.es02_finish_thawani_test_checkout(p_expected_account_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; c private.es02_thawani_test_checkouts; o private.es02_account_orders; branches jsonb;
begin
 actor:=private.es02_require_active_actor(p_expected_account_id);
 if actor is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 if not exists(select 1 from private.es02_thawani_test_accounts where account_id=actor and enabled) then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':es02-provision',0));
 select * into o from private.es02_account_orders where id=p_order_id and account_id=actor for update;
 select * into c from private.es02_thawani_test_checkouts where order_id=p_order_id and account_id=actor for update;
 if o.id is null or c.order_id is null or o.environment<>'test' then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 if c.state<>'paid' or c.paid_at is null or c.invoice is null then return jsonb_build_object('ok',false,'code','NOT_SETTLED'); end if;
 select jsonb_agg(jsonb_build_object('name',b->>'name','city',b->>'city','contact_phone',b->>'contactPhone') order by ord)
 into branches from jsonb_array_elements(c.preparation->'branches') with ordinality as branch(b,ord);
 return public.es02_provision_owned_purchase(actor,o.id,o.id,c.preparation-'branches',branches);
end $$;

revoke all on function public.es02_begin_thawani_test_checkout(uuid,uuid,text,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.es02_claim_thawani_test_checkout(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.es02_complete_thawani_test_checkout(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.es02_record_thawani_test_payment(uuid,uuid,text,uuid,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.es02_read_thawani_test_payment(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.es02_finish_thawani_test_checkout(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.es02_begin_thawani_test_checkout(uuid,uuid,text,jsonb,jsonb,boolean) to authenticated;
grant execute on function public.es02_read_thawani_test_payment(uuid,uuid) to authenticated;
grant execute on function public.es02_finish_thawani_test_checkout(uuid,uuid) to authenticated;
grant execute on function public.es02_claim_thawani_test_checkout(uuid,uuid,uuid) to service_role;
grant execute on function public.es02_complete_thawani_test_checkout(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.es02_record_thawani_test_payment(uuid,uuid,text,uuid,text,integer) to service_role;
commit;
