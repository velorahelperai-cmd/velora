-- REVIEW CANDIDATE. No hosted application is authorized by this file.
-- One approved account, one immutable grant/order,100 real baisa, full catalog rights.
begin;
set local role postgres;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table private.es02_thawani_live_grants (
 id uuid primary key, account_id uuid not null unique references auth.users(id),
 enabled boolean not null default false, amount_baisa integer not null check(amount_baisa=100),
 currency text not null check(currency='OMR'), approved_at timestamptz not null,
 expires_at timestamptz not null, order_id uuid unique references private.es02_account_orders(id),
 check(account_id='177ef439-3fb0-4e3e-96b8-2a9e8661386d'::uuid), check(expires_at>approved_at)
);
create table private.es02_thawani_live_checkouts (
 order_id uuid primary key references private.es02_account_orders(id),
 account_id uuid not null references auth.users(id), grant_id uuid not null unique references private.es02_thawani_live_grants(id),
 preparation jsonb not null check(jsonb_typeof(preparation)='object'),
 catalog_amount_baisa integer not null, collected_baisa integer not null check(collected_baisa=100),
 discount_baisa integer not null check(discount_baisa>=0), currency text not null check(currency='OMR'),
 state text not null default 'prepared' check(state in ('prepared','claimed','ready','paid')),
 claim_token uuid, provider_session_id text unique, invoice text unique,
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '24 hours', paid_at timestamptz,
 check(catalog_amount_baisa=collected_baisa+discount_baisa)
);
alter table private.es02_thawani_live_grants enable row level security;
alter table private.es02_thawani_live_checkouts enable row level security;
revoke all on private.es02_thawani_live_grants,private.es02_thawani_live_checkouts from public,anon,authenticated,service_role;

create function public.es02_begin_thawani_live_checkout(p_expected_account_id uuid,p_client_op_id uuid,p_term text,p_slots jsonb,p_preparation jsonb,p_consent_accepted boolean,p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; g private.es02_thawani_live_grants; c private.es02_thawani_live_checkouts; o private.es02_account_orders; offer jsonb; slot jsonb; fp text;
begin
 actor:=private.es02_require_active_actor(p_expected_account_id);
 if actor is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 if p_client_op_id is null or p_consent_accepted is distinct from true or jsonb_typeof(p_preparation) is distinct from 'object'
  or jsonb_typeof(p_preparation->'branches') is distinct from 'array' or coalesce(jsonb_array_length(p_preparation->'branches'),0)<>1
  or coalesce(length(trim(p_preparation->>'name')),0) not between 1 and 120 or coalesce(length(trim(p_preparation->>'type')),0) not between 1 and 120
  or coalesce(length(trim(p_preparation->>'country')),0) not between 1 and 120 or coalesce(length(trim(p_preparation->>'city')),0) not between 1 and 120
  or coalesce(p_preparation->>'phone','') !~ '^\+[1-9][0-9]{6,14}$'
  or coalesce(length(trim(p_preparation->'branches'->0->>'name')),0) not between 1 and 120
  or coalesce(length(trim(p_preparation->'branches'->0->>'city')),0) not between 1 and 120
  or (p_preparation->'branches'->0 ? 'contactPhone' and jsonb_typeof(p_preparation->'branches'->0->'contactPhone') not in ('string','null'))
  or (nullif(trim(p_preparation->'branches'->0->>'contactPhone'),'') is not null and trim(p_preparation->'branches'->0->>'contactPhone') !~ '^\+[1-9][0-9]{6,14}$')
 then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
 -- Persist only supported business fields. Extra browser keys such as an
 -- invalid replyLanguage must never poison post-payment provisioning.
 p_preparation:=jsonb_build_object('name',trim(p_preparation->>'name'),'type',trim(p_preparation->>'type'),'country',trim(p_preparation->>'country'),'city',trim(p_preparation->>'city'),'phone',p_preparation->>'phone','branches',jsonb_build_array(jsonb_build_object('name',trim(p_preparation->'branches'->0->>'name'),'city',trim(p_preparation->'branches'->0->>'city'))||case when nullif(trim(p_preparation->'branches'->0->>'contactPhone'),'') is not null then jsonb_build_object('contactPhone',trim(p_preparation->'branches'->0->>'contactPhone')) else '{}'::jsonb end))||case when jsonb_typeof(p_preparation->'answers')='object' then jsonb_build_object('answers',p_preparation->'answers') else '{}'::jsonb end;
 offer:=private.es02_test_resolve_slots(p_term,p_slots,case when p_slots @> '[{"persona":"level_3","package":"basic"}]'::jsonb then '2026-10-24' else '2026-10-14' end);
 if offer is null or (offer->>'branchSlots')::integer<>1 then return jsonb_build_object('ok',false,'code','OFFER_TAMPER'); end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':es02-order',0));
 select * into g from private.es02_thawani_live_grants where id=p_grant_id and account_id=actor for update;
 if g.id is null then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 fp:=concat_ws('|',offer->>'catalogRevision',offer->>'term',offer->>'branchSlots',offer->>'amountBaisa','OMR',offer->>'purpose',offer->>'productCode',offer->>'slots');
 if g.order_id is not null then
  select * into o from private.es02_account_orders where id=g.order_id and account_id=actor for update;
  select * into c from private.es02_thawani_live_checkouts where order_id=o.id and grant_id=g.id;
  if o.id is null or c.order_id is null or o.environment<>'live' or o.offer_fingerprint is distinct from fp or c.preparation is distinct from p_preparation then return jsonb_build_object('ok',false,'code','CONFLICT'); end if;
  return jsonb_build_object('ok',true,'action','reuse','data',private.es02_test_order_view(o),'collection',jsonb_build_object('amountBaisa',c.collected_baisa,'currency',c.currency,'grantId',g.id));
 end if;
 if not g.enabled or g.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 -- A client operation may never alias a previous Test order or another offer.
 if exists(select 1 from private.es02_account_orders where account_id=actor and (client_op_id=p_client_op_id or (environment='live' and status in ('open','collection_pending','settled','provisioning')))) then return jsonb_build_object('ok',false,'code','CONFLICT'); end if;
 slot:=offer->'slots'->0;
 insert into private.es02_account_orders(account_id,status,purpose,product_code,catalog_revision,persona,package,term,amount_baisa,currency,replies_per_month,employees,channels,branch_slots,offer_fingerprint,special_reference,client_op_id,capture_generation,environment,slots)
 values(actor,'open','initial_subscription','velora_subscription',offer->>'catalogRevision',slot->>'persona',slot->>'package',p_term,(offer->>'amountBaisa')::integer,'OMR',(offer->>'repliesPerMonth')::integer,(offer->>'employees')::integer,(offer->>'channels')::integer,1,fp,'ES02-'||replace(gen_random_uuid()::text,'-',''),p_client_op_id,0,'live',offer->'slots') returning * into o;
 insert into private.es02_thawani_live_checkouts(order_id,account_id,grant_id,preparation,catalog_amount_baisa,collected_baisa,discount_baisa,currency)
 values(o.id,actor,g.id,p_preparation,o.amount_baisa,g.amount_baisa,o.amount_baisa-g.amount_baisa,'OMR');
 update private.es02_thawani_live_grants set order_id=o.id where id=g.id;
 return jsonb_build_object('ok',true,'action','insert','data',private.es02_test_order_view(o),'collection',jsonb_build_object('amountBaisa',100,'currency','OMR','grantId',g.id));
end $$;

create function public.es02_claim_thawani_live_checkout(p_account_id uuid,p_order_id uuid,p_auth_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o private.es02_account_orders; c private.es02_thawani_live_checkouts; token uuid;
begin
 if auth.role() is distinct from 'service_role' then return jsonb_build_object('kind','rejected'); end if;
 select * into o from private.es02_account_orders where id=p_order_id and account_id=p_account_id for update;
 select * into c from private.es02_thawani_live_checkouts where order_id=o.id and account_id=o.account_id for update;
 if o.id is null or c.order_id is null or o.environment<>'live' or not private.es02_test_order_catalog_consistent(o) or c.catalog_amount_baisa<>o.amount_baisa
  or not exists(select 1 from auth.sessions where id=p_auth_session_id and user_id=p_account_id and (not_after is null or not_after>clock_timestamp()))
 then return jsonb_build_object('kind','rejected'); end if;
 if c.state='ready' and c.expires_at>clock_timestamp() then return jsonb_build_object('kind','ready','sessionId',c.provider_session_id); end if;
 if c.state='claimed' then return jsonb_build_object('kind','recover','token',c.claim_token); end if;
 if c.state<>'prepared' or c.expires_at<=clock_timestamp() or o.status<>'open'
  or not exists(select 1 from private.es02_thawani_live_grants where id=c.grant_id and account_id=o.account_id and order_id=o.id and enabled and expires_at>clock_timestamp())
 then return jsonb_build_object('kind','pending'); end if;
 token:=gen_random_uuid();
 update private.es02_thawani_live_checkouts set state='claimed',claim_token=token where order_id=o.id;
 update private.es02_account_orders set status='collection_pending',updated_at=clock_timestamp() where id=o.id;
 return jsonb_build_object('kind','claimed','token',token);
end $$;

create function public.es02_complete_thawani_live_checkout(p_account_id uuid,p_order_id uuid,p_claim_token uuid,p_session_id text,p_invoice text)
returns boolean language plpgsql security definer set search_path='' as $$
declare c private.es02_thawani_live_checkouts;
begin
 if auth.role() is distinct from 'service_role' then return false; end if;
 select * into c from private.es02_thawani_live_checkouts where order_id=p_order_id and account_id=p_account_id for update;
 if c.order_id is null or c.claim_token is distinct from p_claim_token or coalesce(p_session_id,'') !~ '^checkout_[A-Za-z0-9]{8,150}$' or coalesce(p_invoice,'') !~ '^[0-9]{1,50}$' then return false; end if;
 if c.state='ready' then return c.provider_session_id=p_session_id and c.invoice=p_invoice; end if;
 if c.state<>'claimed' then return false; end if;
 update private.es02_thawani_live_checkouts set state='ready',provider_session_id=p_session_id,invoice=p_invoice where order_id=c.order_id;
 return true;
end $$;

create function public.es02_record_thawani_live_payment(p_account_id uuid,p_order_id uuid,p_session_id text,p_claim_token uuid,p_invoice text,p_amount_baisa integer,p_currency text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.es02_thawani_live_checkouts; o private.es02_account_orders;
begin
 if auth.role() is distinct from 'service_role' then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 select * into o from private.es02_account_orders where id=p_order_id and account_id=p_account_id for update;
 select * into c from private.es02_thawani_live_checkouts where order_id=o.id and account_id=o.account_id for update;
 if o.id is null or c.order_id is null or o.environment<>'live' or c.state not in ('ready','paid') or c.claim_token is distinct from p_claim_token
  or c.provider_session_id is distinct from p_session_id or c.invoice is distinct from p_invoice or c.collected_baisa is distinct from p_amount_baisa
  or p_currency is distinct from 'OMR' or c.catalog_amount_baisa<>o.amount_baisa or not private.es02_test_order_catalog_consistent(o)
 then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 if c.state='paid' then return jsonb_build_object('ok',true,'outcome','duplicate'); end if;
 if o.status<>'collection_pending' then return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED'); end if;
 -- Ledger records real collected cash, never the undiscounted catalog value.
 insert into private.es02_account_settlement_events(order_id,account_id,evidence_marker,provider_transaction_id,amount_baisa,currency,outcome,detail_code)
 values(o.id,o.account_id,'thawani_api_verified_live','thawani-live:'||c.invoice,c.collected_baisa,'OMR','applied','ONE_ORDER_APPROVED_DISCOUNT');
 update private.es02_account_orders set status='settled',settled_at=clock_timestamp(),provider_transaction_id='thawani-live:'||c.invoice,updated_at=clock_timestamp() where id=o.id;
 update private.es02_thawani_live_checkouts set state='paid',paid_at=clock_timestamp() where order_id=o.id;
 return jsonb_build_object('ok',true,'outcome','settled');
end $$;

create function public.es02_read_thawani_live_payment(p_expected_account_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; c private.es02_thawani_live_checkouts; o private.es02_account_orders;
begin
 actor:=private.es02_require_active_actor(p_expected_account_id);
 if actor is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 select * into o from private.es02_account_orders where id=p_order_id and account_id=actor;
 select * into c from private.es02_thawani_live_checkouts where order_id=p_order_id and account_id=actor;
 if o.id is null or c.order_id is null or o.environment<>'live' then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('order',private.es02_test_order_view(o),'state',c.state,'paidAt',c.paid_at,'expiresAt',c.expires_at,'sessionId',c.provider_session_id,'claimToken',c.claim_token,'collection',jsonb_build_object('amountBaisa',c.collected_baisa,'currency',c.currency,'grantId',c.grant_id)));
end $$;

-- Clone the verified provisioner into a private Live-only path. Existing Test,
-- generic provisioning, START-001, subscription clocks and their ACL stay unchanged.
do $clone$
declare target regprocedure:='public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure; definition text; missing text:=$old$  if primary_branch.id is null then
    raise exception 'ES02_PRIMARY_BRANCH_MISSING' using errcode = 'P0001';
  end if;$old$;
begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=target) is distinct from '9500d3aa8d79abbafbea853bc3621258' then raise exception 'LIVE_PROVISION_BASELINE_DRIFT'; end if;
 definition:=replace(pg_get_functiondef(target),chr(13),'');
 if length(definition)-length(replace(definition,missing,''))<>length(missing) then raise exception 'LIVE_PROVISION_PATCH_AMBIGUOUS'; end if;
 definition:=replace(definition,'public.es02_provision_owned_purchase','private.es02_provision_thawani_live_purchase');
 definition:=replace(definition,'private.es02_order_catalog_consistent(o)','private.es02_test_order_catalog_consistent(o)');
 definition:=replace(definition,'private.es02_order_view(o)','private.es02_test_order_view(o)');
 definition:=replace(definition,missing,$new$  if primary_branch.id is null then
    insert into public.company_branches(company_id,name,city,is_primary,status)
    values(created.id,btrim(p_branches->0->>'name'),btrim(p_branches->0->>'city'),true,'setup') returning * into primary_branch;
  end if;$new$);
 -- This private clone is reachable only from the paid-proof wrapper below.
 execute definition;
end $clone$;
revoke all on function private.es02_provision_thawani_live_purchase(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.es02_finish_thawani_live_checkout(p_expected_account_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; c private.es02_thawani_live_checkouts; o private.es02_account_orders; branches jsonb;
begin
 actor:=private.es02_require_active_actor(p_expected_account_id);
 if actor is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':es02-provision',0));
 select * into o from private.es02_account_orders where id=p_order_id and account_id=actor for update;
 select * into c from private.es02_thawani_live_checkouts where order_id=p_order_id and account_id=actor for update;
 if o.id is null or c.order_id is null or o.environment<>'live' then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 if c.state<>'paid' or c.paid_at is null or c.invoice is null or not exists(select 1 from private.es02_account_settlement_events where order_id=o.id and account_id=actor and evidence_marker='thawani_api_verified_live' and provider_transaction_id='thawani-live:'||c.invoice and amount_baisa=c.collected_baisa and currency='OMR' and outcome='applied') then return jsonb_build_object('ok',false,'code','NOT_SETTLED'); end if;
 select jsonb_agg(jsonb_build_object('name',b->>'name','city',b->>'city','contact_phone',b->>'contactPhone') order by ord) into branches from jsonb_array_elements(c.preparation->'branches') with ordinality as branch(b,ord);
 return private.es02_provision_thawani_live_purchase(actor,o.id,o.id,c.preparation-'branches',branches);
end $$;

revoke all on function public.es02_begin_thawani_live_checkout(uuid,uuid,text,jsonb,jsonb,boolean,uuid) from public,anon,authenticated,service_role;
revoke all on function public.es02_claim_thawani_live_checkout(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.es02_complete_thawani_live_checkout(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.es02_record_thawani_live_payment(uuid,uuid,text,uuid,text,integer,text) from public,anon,authenticated,service_role;
revoke all on function public.es02_read_thawani_live_payment(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.es02_finish_thawani_live_checkout(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.es02_begin_thawani_live_checkout(uuid,uuid,text,jsonb,jsonb,boolean,uuid),public.es02_read_thawani_live_payment(uuid,uuid),public.es02_finish_thawani_live_checkout(uuid,uuid) to authenticated;
grant execute on function public.es02_claim_thawani_live_checkout(uuid,uuid,uuid),public.es02_complete_thawani_live_checkout(uuid,uuid,uuid,text,text),public.es02_record_thawani_live_payment(uuid,uuid,text,uuid,text,integer,text) to service_role;
create function public.es02_thawani_live_readiness(p_account_id uuid,p_grant_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then return false;end if;
 return exists(select 1 from private.es02_thawani_live_grants where id=p_grant_id and account_id=p_account_id and amount_baisa=100 and currency='OMR' and ((enabled and expires_at>clock_timestamp()) or order_id is not null));
end $$;
revoke all on function public.es02_thawani_live_readiness(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.es02_thawani_live_readiness(uuid,uuid) to service_role;
commit;
