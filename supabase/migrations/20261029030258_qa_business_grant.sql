-- Owner-authorized non-cash QA grant. No gateway, synthetic settlement or collected revenue.
-- Rollback: revoke the two public mutation RPCs. Preserve grant/order history.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table private.es02_qa_setup_grants (
 order_id uuid primary key references private.es02_account_orders(id),
 account_id uuid not null references auth.users(id),
 company_id uuid references public.companies(id),
 granted_at timestamptz not null default clock_timestamp(),
 reset_at timestamptz,
 reset_by uuid references auth.users(id),
 check(account_id='83ad69f7-cbb0-4e3a-a34e-8085e5203dc7'::uuid)
);
alter table private.es02_qa_setup_grants enable row level security;
alter table private.es02_qa_setup_grants owner to postgres;
revoke all on private.es02_qa_setup_grants from public,anon,authenticated,service_role;
create unique index es02_qa_one_active_grant on private.es02_qa_setup_grants(account_id) where reset_at is null;

create function private.es02_qa_order_authorized(p_order uuid,p_account uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_account='83ad69f7-cbb0-4e3a-a34e-8085e5203dc7'::uuid
 and exists(select 1 from private.es02_qa_setup_grants g
 join private.es02_account_orders o on o.id=g.order_id and o.account_id=g.account_id
 join auth.users u on u.id=g.account_id
 where g.order_id=p_order and g.account_id=p_account and g.reset_at is null
 and lower(u.email)='velorahelperai+meta-review@gmail.com' and u.email_confirmed_at is not null and u.deleted_at is null
 and o.environment='test' and o.settled_at is null and o.settlement_authority is null and o.provider_transaction_id is null
 and not exists(select 1 from private.es02_account_settlement_events e where e.order_id=o.id));
$$;
alter function private.es02_qa_order_authorized(uuid,uuid) owner to postgres;
revoke all on function private.es02_qa_order_authorized(uuid,uuid) from public,anon,authenticated,service_role;

-- A non-cash grant has no payment timestamp. Ordinary purchases still require one.
alter table private.es02_activation_foundation alter column payment_confirmed_at drop not null;
create function private.es02_qa_foundation_guard() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if new.payment_confirmed_at is null and not private.es02_qa_order_authorized(new.order_id,new.account_id) then
  raise exception 'PAYMENT_OR_EXPLICIT_QA_GRANT_REQUIRED';
 end if;
 return new;
end$$;
alter function private.es02_qa_foundation_guard() owner to postgres;
revoke all on function private.es02_qa_foundation_guard() from public,anon,authenticated,service_role;
create trigger es02_qa_foundation_guard before insert or update on private.es02_activation_foundation
 for each row execute function private.es02_qa_foundation_guard();

-- Reuse the installed atomic provisioner. Exact anchors fail closed on incompatible schema.
do $patch$
declare body text;old text;replacement text;
begin
 body:=pg_get_functiondef('public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure);
 old:='if o.status is distinct from ''settled'' then';
 if strpos(body,old)=0 then raise exception 'QA_PROVISION_BASELINE_CHANGED';end if;
 body:=replace(body,old,'if o.status is distinct from ''settled'' and not (o.status = ''open'' and private.es02_qa_order_authorized(o.id, actor)) then');
 old:='if primary_branch.id is null and o.environment = ''test''';
 if strpos(body,old)=0 then raise exception 'QA_PRIMARY_BASELINE_CHANGED';end if;
 -- Create the ordinary primary branch for an explicit grant, before existing compatibility fallback.
 replacement:='if primary_branch.id is null and private.es02_qa_order_authorized(o.id, actor) then
 insert into public.company_branches(company_id,name,city,is_primary,status)
 values(created.id,btrim(p_branches->0->>''name''),btrim(p_branches->0->>''city''),true,''setup'') returning * into primary_branch;
 end if;
 '||old;
 body:=replace(body,old,replacement);
 old:='paid_at := coalesce(o.settled_at, clock_timestamp());';
 if strpos(body,old)=0 then raise exception 'QA_CLOCK_BASELINE_CHANGED';end if;
 body:=replace(body,old,'paid_at := case when private.es02_qa_order_authorized(o.id,actor) then null else coalesce(o.settled_at,clock_timestamp()) end;');
 body:=replace(body,'deadline := paid_at + interval ''7 days'';','deadline := coalesce(paid_at,clock_timestamp()) + interval ''7 days'';');
 execute body;
 -- Configuration/binding accepts the explicit grant; LIVE operational/payment checks stay intact.
 for body in select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='public' and p.proname='es02_read_owned_branch_setup')
 or (n.nspname='private' and p.proname='es02_b3_current_binding') loop
  old:='a.payment_confirmed_at, a.clock_state';
  if strpos(body,old)=0 then raise exception 'QA_SETUP_BASELINE_CHANGED';end if;
  execute replace(body,old,'coalesce(a.payment_confirmed_at, (select g.granted_at from private.es02_qa_setup_grants g where g.order_id=a.order_id and g.account_id=a.account_id and g.reset_at is null and private.es02_qa_order_authorized(g.order_id,g.account_id))), a.clock_state');
 end loop;
 -- Confirmed hosted compatibility defect: companies has display_name, not name.
 body:=pg_get_functiondef('public.es02_read_owned_branch_reply_language(uuid,uuid,uuid)'::regprocedure);
 old:='coalesce(company.display_name, company.name, ''Velora Business'')';
 if strpos(body,'company.name')>0 then
  if strpos(body,old)=0 then raise exception 'QA_LANGUAGE_BASELINE_CHANGED';end if;
  execute replace(body,old,'coalesce(nullif(company.display_name, ''''), ''Velora Business'')');
 end if;
end $patch$;

create function public.es02_grant_qa_setup(p_expected_account_id uuid,p_client_op_id uuid,p_term text,p_slots jsonb,p_business jsonb,p_branches jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;g private.es02_qa_setup_grants;o private.es02_account_orders;r jsonb;oid uuid;
begin
 actor:=private.es02_require_active_actor(p_expected_account_id);
 if actor is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if actor<>'83ad69f7-cbb0-4e3a-a34e-8085e5203dc7'::uuid or not exists(select 1 from auth.users where id=actor and lower(email)='velorahelperai+meta-review@gmail.com' and deleted_at is null)
 then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_client_op_id is null or p_business->>'name' is distinct from 'VELORA QA' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':es02-qa-grant',0));
 select * into g from private.es02_qa_setup_grants where account_id=actor and reset_at is null for update;
 if g.order_id is not null then
  select * into o from private.es02_account_orders where id=g.order_id;
  if o.term is distinct from p_term or (private.es02_test_resolve_slots(p_term,p_slots,o.catalog_revision))->'slots' is distinct from o.slots or not private.es02_qa_order_authorized(o.id,actor) then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
  return jsonb_build_object('ok',true,'companyId',g.company_id,'source','qa_grant','action','reuse');
 end if;
 if exists(select 1 from public.company_members where user_id=actor and status='active')
 or exists(select 1 from private.es02_account_orders where account_id=actor and status not in ('cancelled','failed'))
 then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 r:=private.es02_create_test_account_order(actor,p_client_op_id,p_term,p_slots,true);
 if r->>'ok' is distinct from 'true' then return r;end if;
 oid:=(r->'data'->>'orderId')::uuid;
 if oid is null then raise exception 'QA_ORDER_ACK_INVALID';end if;
 insert into private.es02_qa_setup_grants(order_id,account_id) values(oid,actor);
 r:=public.es02_provision_owned_purchase(actor,oid,p_client_op_id,p_business,p_branches);
 if r->>'ok' is distinct from 'true' then raise exception 'QA_PROVISION_FAILED';end if;
 update private.es02_qa_setup_grants set company_id=(r->'data'->>'companyId')::uuid where order_id=oid;
 return jsonb_build_object('ok',true,'companyId',r->'data'->>'companyId','source','qa_grant','action','created');
exception when others then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
end$$;
alter function public.es02_grant_qa_setup(uuid,uuid,text,jsonb,jsonb,jsonb) owner to postgres;
revoke all on function public.es02_grant_qa_setup(uuid,uuid,text,jsonb,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.es02_grant_qa_setup(uuid,uuid,text,jsonb,jsonb,jsonb) to authenticated;

-- Preview and explicit reset share the same locks/checks. No deletion of payment/provider evidence.
create function public.es02_admin_reset_qa_setup(p_company_id uuid,p_confirm text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;g private.es02_qa_setup_grants;o private.es02_account_orders;prior_status_setting text;
begin
 actor:=private.es02_require_active_actor(auth.uid());
 if actor is null or public.is_platform_owner() is distinct from true then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform pg_advisory_xact_lock(hashtextextended('83ad69f7-cbb0-4e3a-a34e-8085e5203dc7:es02-qa-grant',0));
 select * into g from private.es02_qa_setup_grants where company_id=p_company_id and reset_at is null for update;
 if g.order_id is null or p_company_id='40d2d885-8b63-49c4-b3da-d2e9566f2750'::uuid then return jsonb_build_object('ok',false,'code','NOT_QA_GRANT');end if;
 select * into o from private.es02_account_orders where id=g.order_id for update;
 perform 1 from public.companies where id=p_company_id for update;
 if not private.es02_qa_order_authorized(o.id,g.account_id)
 or exists(select 1 from private.es02_account_orders where provisioned_company_id=p_company_id and id<>o.id)
 or exists(select 1 from public.billing_subscriptions where company_id=p_company_id and (environment<>'test' or status<>'awaiting_payment' or paid_through is not null))
 or exists(select 1 from public.company_members where company_id=p_company_id and user_id<>g.account_id and status='active')
 or exists(select 1 from private.es02_b3_connection_links where company_id=p_company_id and status='active')
 or exists(select 1 from private.es02_b3_connection_attempts where company_id=p_company_id and status not in ('cancelled','failed','expired'))
 then return jsonb_build_object('ok',false,'code','DEPENDENCIES_REQUIRE_REVIEW');end if;
 if p_confirm is null then return jsonb_build_object('ok',true,'companyId',p_company_id,'name','VELORA QA','branches',(select count(*) from public.company_branches where company_id=p_company_id),'operation','archive_and_revoke','preservesHistory',true);end if;
 if p_confirm is distinct from 'RESET VELORA QA' then return jsonb_build_object('ok',false,'code','CONFIRMATION_REQUIRED');end if;
 prior_status_setting:=coalesce(current_setting('velora.allow_status_change',true),'');
 perform set_config('velora.allow_status_change','on',true);
 update public.companies set status='suspended',archived_at=clock_timestamp() where id=p_company_id;
 perform set_config('velora.allow_status_change',prior_status_setting,true);
 update public.company_branches set status='suspended' where company_id=p_company_id;
 update public.company_members set status='disabled' where company_id=p_company_id and user_id=g.account_id;
 update private.es02_account_orders set status='cancelled',updated_at=clock_timestamp() where id=o.id;
 update private.es02_qa_setup_grants set reset_at=clock_timestamp(),reset_by=actor where order_id=o.id;
 return jsonb_build_object('ok',true,'action','reset','preservesHistory',true);
exception when others then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end$$;
alter function public.es02_admin_reset_qa_setup(uuid,text) owner to postgres;
revoke all on function public.es02_admin_reset_qa_setup(uuid,text) from public,anon,service_role;
grant execute on function public.es02_admin_reset_qa_setup(uuid,text) to authenticated;
create function public.es02_admin_list_qa_setup() returns jsonb
language plpgsql security definer set search_path='' as $$begin
 if private.es02_require_active_actor(auth.uid()) is null or public.is_platform_owner() is distinct from true then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 return jsonb_build_object('ok',true,'grants',coalesce((select jsonb_agg(jsonb_build_object('companyId',g.company_id,'name',c.display_name,'persona',o.persona,'package',o.package,'term',o.term,'grantedAt',g.granted_at))
 from private.es02_qa_setup_grants g join private.es02_account_orders o on o.id=g.order_id join public.companies c on c.id=g.company_id where g.reset_at is null),'[]'::jsonb));
end$$;
alter function public.es02_admin_list_qa_setup() owner to postgres;
revoke all on function public.es02_admin_list_qa_setup() from public,anon,service_role;
grant execute on function public.es02_admin_list_qa_setup() to authenticated;
commit;
