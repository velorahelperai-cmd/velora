-- Synthetic isolated test fixtures only. Never part of production upgrade.
create schema if not exists test_fixture;
create or replace function test_fixture.live_context(p_tier text default 'basic',p_factor integer default 1000,p_price bigint default 45000,p_budget boolean default true,p_quota boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=gen_random_uuid();s uuid:=gen_random_uuid();c uuid:=gen_random_uuid();p uuid:=gen_random_uuid();v uuid:=gen_random_uuid();contract uuid:=gen_random_uuid();r bigint;integration bigint;begin
 insert into auth.users(id,email,email_confirmed_at) values(u,'synthetic-live-'||u||'@example.invalid',clock_timestamp());
 insert into auth.sessions(id,user_id) values(s,u);
 insert into private.app_session_activity(session_id,user_id,last_activity_at) values(s,u,clock_timestamp());
 insert into public.companies(id,display_name,status,created_by) values(c,'Synthetic isolated Live company','active',u);
 insert into public.company_members(company_id,user_id,role,status) values(c,u,'owner','active');
 insert into public.billing_catalog_revision(singleton,revision) values(true,1) on conflict do nothing;
 select revision into r from public.billing_catalog_revision where singleton;
 insert into public.billing_plans(id,code,name,status) values(p,'synthetic_live_'||p_tier||'_'||p,'Synthetic isolated Live plan','active');
 insert into public.billing_plan_versions(id,plan_id,version,amount_baisa,currency,period_days,period_unit,period_count,status,limits)
 values(v,p,1,p_price,'OMR',30,'month',1,'draft',case when p_quota then '{"automated_outbound_per_month":500}'::jsonb else '{}'::jsonb end);
 insert into private.billing_service_offers(plan_version_id,service_code,tier,capabilities) values(v,'noura',p_tier,array['noura.knowledge.read']);
 if p_budget then insert into private.ai_plan_budget_policies(plan_version_id,monthly_limit_baisa,created_by) values(v,5000,u);end if;
 update public.billing_plan_versions set status='published' where id=v;
 select coalesce(max(integration_id),98000)+1 into integration from private.billing_live_merchant_contracts;
 insert into private.billing_live_merchant_contracts(id,integration_id,merchant_owner_id,currency,units_per_omr,deadline_policy_approved,verified_by,verified_at)
 values(contract,integration,'1001','OMR',p_factor,true,u,clock_timestamp());
 return jsonb_build_object('company',c,'actor',u,'session',s,'version',v,'plan',p,'revision',r,'integration',integration,'factor',p_factor,'contract',contract);
end;$$;
revoke all on function test_fixture.live_context(text,integer,bigint,boolean,boolean) from public,anon,authenticated,service_role;
