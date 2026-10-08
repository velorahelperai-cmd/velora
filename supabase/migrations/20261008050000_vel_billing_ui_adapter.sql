-- Durable UI adapters over BILLING foundation, FIX-02, ATOMIC+FIX-01,
-- and SINGLE-PRODUCT-FIX-01. No business seeds, payment activation, or ACCESS dependency.
begin;

-- One currently published price per plan; earlier published versions retire intact.
create unique index billing_plan_versions_current_published_unique
 on public.billing_plan_versions(plan_id) where status='published';

create table public.billing_catalog_revision (
 singleton boolean primary key default true check(singleton),
 revision bigint not null default 1 check(revision between 1 and 9007199254740991)
);
insert into public.billing_catalog_revision(singleton,revision) values(true,1);
alter table public.billing_catalog_revision enable row level security;
revoke all on public.billing_catalog_revision from public,anon,authenticated;
grant all on public.billing_catalog_revision to service_role;

-- These policies supplement explicit checks in the SECURITY DEFINER RPCs.
-- Billing tables remain unavailable for direct browser reads/writes.
do $$
declare target text;
begin
 foreach target in array array['billing_plans','billing_plan_versions','billing_orders',
  'billing_payment_attempts','billing_provider_events','billing_subscriptions',
  'billing_entitlement_applications','billing_settlement_outcomes','billing_catalog_revision'] loop
  execute format('alter table public.%I enable row level security',target);
  execute format('drop policy if exists velora_active_session on public.%I',target);
  execute format('create policy velora_active_session on public.%I as restrictive for all to authenticated using ((select public.app_session_is_valid())) with check ((select public.app_session_is_valid()))',target);
  execute format('grant all on table public.%I to service_role',target);
 end loop;
end;$$;

create function private.billing_ui_owner() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.app_session_is_valid() and public.is_platform_owner();
$$;
revoke all on function private.billing_ui_owner() from public,anon,authenticated;

create function private.billing_ui_company_owner(p_company_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.app_session_is_valid()
 and exists(select 1 from public.companies c where c.id=p_company_id)
 and (public.is_platform_owner() or exists(select 1 from public.company_members m
  where m.company_id=p_company_id and m.user_id=auth.uid() and m.role='owner' and m.status='active'));
$$;
revoke all on function private.billing_ui_company_owner(uuid) from public,anon,authenticated;

create function private.billing_ui_valid_draft(p_draft jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare feature record;
begin
 if jsonb_typeof(p_draft) is distinct from 'object'
  or (p_draft->>'code') is null
  or (p_draft->>'code') not in ('noor_basic','noor_premium','lina_basic','lina_premium','dana_basic','dana_premium')
  or (p_draft->>'currency') is distinct from 'OMR'
  or (p_draft->>'period_unit') is distinct from 'month'
  or jsonb_typeof(p_draft->'period_count') is distinct from 'number'
  or (p_draft->>'period_count') is distinct from '1'
  or jsonb_typeof(p_draft->'amount_baisa') is distinct from 'number'
  or coalesce(p_draft->>'amount_baisa','') !~ '^[1-9][0-9]{0,15}$'
  or jsonb_typeof(p_draft->'automated_outbound_per_month') is distinct from 'number'
  or coalesce(p_draft->>'automated_outbound_per_month','') !~ '^[1-9][0-9]{0,8}$'
  or jsonb_typeof(p_draft->'feature_availability') is distinct from 'object' then return false; end if;
 if (p_draft->>'amount_baisa')::numeric>9007199254740991
  or (p_draft->>'automated_outbound_per_month')::numeric>100000000 then return false;end if;
 for feature in select * from jsonb_each_text(p_draft->'feature_availability') loop
  if feature.key not in ('faq','knowledge','enquiry_handoff','website','lead_followup','reports','pos','orders','endcustomer_payment','accounting')
   or feature.value is null or feature.value not in ('target','not_verified') then return false;end if;
 end loop;
 return true;
end;$$;
revoke all on function private.billing_ui_valid_draft(jsonb) from public,anon,authenticated;

create function private.billing_ui_catalog_draft(p_code text,p_version public.billing_plan_versions) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('code',p_code,'currency',p_version.currency,'amount_baisa',p_version.amount_baisa,
  'period_unit',p_version.period_unit,'period_count',p_version.period_count,
  'automated_outbound_per_month',p_version.limits->'automated_outbound_per_month',
  'feature_availability',p_version.limits->'feature_availability');
$$;
revoke all on function private.billing_ui_catalog_draft(text,public.billing_plan_versions) from public,anon,authenticated;

create function public.billing_read_public_catalog() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 -- Anonymous catalog reads are public; authenticated reads require a live app session.
 if auth.uid() is not null and not public.app_session_is_valid() then
  raise exception 'Active session required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(
  private.billing_ui_catalog_draft(p.code,v)||jsonb_build_object('product_code','velora_ai_staff',
   'plan_id',p.id,'version_id',v.id,'version',v.version,'persona',split_part(p.code,'_',1),
   'variant',split_part(p.code,'_',2),'checkout_enabled',false) order by p.code)
  from public.billing_plans p join public.billing_plan_versions v on v.plan_id=p.id
  where p.status='active' and v.status='published'
   and private.billing_ui_valid_draft(private.billing_ui_catalog_draft(p.code,v))), '[]'::jsonb);
end;$$;
revoke all on function public.billing_read_public_catalog() from public;
grant execute on function public.billing_read_public_catalog() to anon,authenticated;

create function public.billing_catalog_admin_read() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.billing_ui_owner() then return jsonb_build_object('ok',false,'code','forbidden');end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object(
  'revision',(select revision from public.billing_catalog_revision where singleton),
  'versions',coalesce((select jsonb_agg(private.billing_ui_catalog_draft(p.code,v)||
   jsonb_build_object('version_id',v.id,'version',v.version,'status',v.status,'limits',v.limits)
   order by p.code,v.version desc)
   from public.billing_plans p join public.billing_plan_versions v on v.plan_id=p.id
   where p.code in ('noor_basic','noor_premium','lina_basic','lina_premium','dana_basic','dana_premium')),'[]'::jsonb)));
end;$$;
revoke all on function public.billing_catalog_admin_read() from public,anon;
grant execute on function public.billing_catalog_admin_read() to authenticated;

create function public.billing_catalog_admin_mutate(p_operation text,p_expected_revision bigint,p_version_id uuid,p_draft jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare catalog_revision bigint;plan_id_value uuid;version_id_value uuid;entry public.billing_plan_versions%rowtype;draft_code text;next_version integer;
begin
 if not private.billing_ui_owner() then return jsonb_build_object('ok',false,'code','forbidden');end if;
 if p_operation is null or p_operation not in ('save_draft','publish') or p_expected_revision is null or p_expected_revision<1 then
  return jsonb_build_object('ok',false,'code','invalid_input');end if;
 select revision into catalog_revision from public.billing_catalog_revision where singleton for update;
 if catalog_revision<>p_expected_revision then return jsonb_build_object('ok',false,'code','conflict');end if;
 -- Revalidate after waiting for the serialization lock.
 if not private.billing_ui_owner() then return jsonb_build_object('ok',false,'code','forbidden');end if;
 if p_operation='save_draft' then
  if not private.billing_ui_valid_draft(p_draft) then return jsonb_build_object('ok',false,'code','invalid_input');end if;
  draft_code:=p_draft->>'code';
  if p_version_id is not null then
   select * into entry from public.billing_plan_versions where id=p_version_id for update;
   if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
   if entry.status<>'draft' then return jsonb_build_object('ok',false,'code','immutable');end if;
   if not exists(select 1 from public.billing_plans where id=entry.plan_id and code=draft_code) then
    return jsonb_build_object('ok',false,'code','invalid_input');end if;
   -- period_days is a required legacy field. Calendar period_unit/count govern
   -- monthly entitlement arithmetic; this value is never an invented paid period.
   update public.billing_plan_versions set amount_baisa=(p_draft->>'amount_baisa')::bigint,
    limits=jsonb_build_object('automated_outbound_per_month',p_draft->'automated_outbound_per_month','feature_availability',p_draft->'feature_availability'),
    currency='OMR',period_days=30,period_unit='month',period_count=1 where id=p_version_id;
   version_id_value:=p_version_id;
  else
   insert into public.billing_plans(code,name) values(draft_code,replace(draft_code,'_',' / '))
    on conflict(code) do nothing;
   select id into plan_id_value from public.billing_plans where code=draft_code;
   select coalesce(max(version),0)+1 into next_version from public.billing_plan_versions where plan_id=plan_id_value;
   insert into public.billing_plan_versions(plan_id,version,currency,amount_baisa,period_days,period_unit,period_count,limits)
   values(plan_id_value,next_version,'OMR',(p_draft->>'amount_baisa')::bigint,30,'month',1,
    jsonb_build_object('automated_outbound_per_month',p_draft->'automated_outbound_per_month','feature_availability',p_draft->'feature_availability'))
   returning id into version_id_value;
  end if;
 else
  if p_version_id is null then return jsonb_build_object('ok',false,'code','invalid_input');end if;
  select * into entry from public.billing_plan_versions where id=p_version_id for update;
  if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
  if entry.status<>'draft' then return jsonb_build_object('ok',false,'code','immutable');end if;
  select code into draft_code from public.billing_plans where id=entry.plan_id;
  if not private.billing_ui_valid_draft(private.billing_ui_catalog_draft(draft_code,entry)) then
   return jsonb_build_object('ok',false,'code','invalid_input');end if;
  update public.billing_plan_versions set status='retired' where plan_id=entry.plan_id and status='published';
  update public.billing_plan_versions set status='published' where id=p_version_id;
  update public.billing_plans set status='active',updated_at=clock_timestamp() where id=entry.plan_id;
  version_id_value:=p_version_id;
 end if;
 update public.billing_catalog_revision set revision=revision+1 where singleton returning revision into catalog_revision;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('revision',catalog_revision,'version_id',version_id_value));
end;$$;
revoke all on function public.billing_catalog_admin_mutate(text,bigint,uuid,jsonb) from public,anon;
grant execute on function public.billing_catalog_admin_mutate(text,bigint,uuid,jsonb) to authenticated;

-- Paid customer projections use live collections only. Test orders/grants are never invoices.
create function public.billing_read_company_journey(p_company_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare subscription_data jsonb;
begin
 if not private.billing_ui_company_owner(p_company_id) then return jsonb_build_object('ok',false,'code','forbidden');end if;
 select jsonb_build_object('id',s.id,'company_id',s.company_id,
  'plan_version_id',coalesce(live_grant.plan_version_id,s.plan_version_id),
  'status',case when live_grant.id is not null then case when live_grant.applied_paid_through>statement_timestamp()
   then case when s.cancel_at_period_end then 'cancel_at_period_end' else 'active' end else 'ended' end else s.status end,
  'paid_through',live_grant.applied_paid_through,'cancel_at_period_end',s.cancel_at_period_end,
  'cap',case when live_grant.applied_paid_through>statement_timestamp()
   then v.limits->'automated_outbound_per_month' else null end) into subscription_data
 from public.billing_subscriptions s
 left join lateral(select g.id,g.applied_paid_through,o.plan_version_id from public.billing_entitlement_applications g
  join public.billing_orders o on o.id=g.order_id and o.company_id=g.company_id
  where g.subscription_id=s.id and g.company_id=p_company_id and g.provider_environment='live' and o.provider_environment='live'
  order by g.applied_paid_through desc,g.applied_at desc,g.id desc limit 1) live_grant on true
 left join public.billing_plan_versions v on v.id=coalesce(live_grant.plan_version_id,s.plan_version_id)
 where s.company_id=p_company_id and (live_grant.id is not null or not exists(
  select 1 from public.billing_entitlement_applications any_grant where any_grant.subscription_id=s.id));
 return jsonb_build_object('ok',true,'data',jsonb_build_object('subscription',subscription_data,
  'orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'plan_version_id',o.plan_version_id,
   'amount_baisa',o.amount_baisa,'currency',o.currency,'purchase_purpose',o.purchase_purpose,'status',o.status,'created_at',o.created_at,
   'paid_through',grant_row.applied_paid_through,'payment_state',case when grant_row.id is not null then 'confirmed'
    when attempt.status='failed' then 'failed' when attempt.status='unresolved' then 'unresolved'
    when attempt.status='provider_submitted' then 'awaiting_processing' when attempt.status='paid' then 'verifying' else 'awaiting_processing' end)
   order by o.created_at desc,o.id desc)
   from (select * from public.billing_orders where company_id=p_company_id and provider_environment='live' order by created_at desc,id desc limit 100) o
   left join lateral(select a.status from public.billing_payment_attempts a where a.order_id=o.id and a.company_id=p_company_id order by a.created_at desc,a.id desc limit 1) attempt on true
   left join public.billing_entitlement_applications grant_row on grant_row.order_id=o.id and grant_row.company_id=p_company_id and grant_row.provider_environment='live'),'[]'::jsonb)));
end;$$;
revoke all on function public.billing_read_company_journey(uuid) from public,anon;
grant execute on function public.billing_read_company_journey(uuid) to authenticated;

create function public.billing_read_company_usage(p_company_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare month_start timestamptz:=date_trunc('month',statement_timestamp() at time zone 'Asia/Muscat') at time zone 'Asia/Muscat';
 month_end timestamptz;successful bigint;held bigint;journey jsonb;cap_value jsonb;
begin
 if not private.billing_ui_company_owner(p_company_id) then return jsonb_build_object('ok',false,'code','forbidden');end if;
 month_end:=((month_start at time zone 'Asia/Muscat')+interval '1 month') at time zone 'Asia/Muscat';
 -- Source is provider acceptance evidence, never inbound/customer/staff message counts.
 select count(*) filter(where i.outcome='accepted' and coalesce(m.delivery_state,'accepted')<>'failed'
   and coalesce(m.received_at,i.updated_at)>=month_start and coalesce(m.received_at,i.updated_at)<month_end),
  count(*) filter(where i.outcome in ('ready','attempting','unknown') and i.created_at>=month_start and i.created_at<month_end)
 into successful,held from public.whatsapp_send_intents i
 left join public.whatsapp_messages m on m.id=i.message_id and m.company_id=i.company_id
 where i.company_id=p_company_id and i.sender_kind='assistant';
 journey:=public.billing_read_company_journey(p_company_id);
 cap_value:=journey->'data'->'subscription'->'cap';
 return jsonb_build_object('ok',true,'data',jsonb_build_object('month_start',to_char(month_start at time zone 'Asia/Muscat','YYYY-MM-DD'),
  'successful_automated_outbound',successful,'held_outbound_capacity',held,'cap',cap_value));
end;$$;
revoke all on function public.billing_read_company_usage(uuid) from public,anon;
grant execute on function public.billing_read_company_usage(uuid) to authenticated;

create function public.billing_cancel_at_period_end(p_company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare subscription_entry public.billing_subscriptions%rowtype;
begin
 if not private.billing_ui_company_owner(p_company_id) then return jsonb_build_object('ok',false,'code','forbidden');end if;
 -- Follow the same company -> subscription lock order as the payment foundation.
 perform 1 from public.companies where id=p_company_id for update;
 select * into subscription_entry from public.billing_subscriptions where company_id=p_company_id for update;
 if not found then return jsonb_build_object('ok',false,'code','no_active_subscription');end if;
 if not private.billing_ui_company_owner(p_company_id) then return jsonb_build_object('ok',false,'code','forbidden');end if;
 if not exists(select 1 from public.billing_entitlement_applications g
  join public.billing_orders o on o.id=g.order_id and o.company_id=g.company_id
  where g.subscription_id=subscription_entry.id and g.company_id=p_company_id
   and g.provider_environment='live' and o.provider_environment='live' and g.applied_paid_through>clock_timestamp()) then
  return jsonb_build_object('ok',false,'code','no_active_subscription');end if;
 update public.billing_subscriptions set cancel_at_period_end=true,status='cancel_at_period_end',updated_at=clock_timestamp()
  where id=subscription_entry.id;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('cancel_at_period_end',true));
end;$$;
revoke all on function public.billing_cancel_at_period_end(uuid) from public,anon;
grant execute on function public.billing_cancel_at_period_end(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
