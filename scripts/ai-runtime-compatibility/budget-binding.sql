-- Synthetic isolated-only contract regression; every fixture rolls back.
begin;
set local role postgres;
do $$ declare c uuid:=gen_random_uuid();p uuid:=gen_random_uuid();v uuid:=gen_random_uuid();s uuid:=gen_random_uuid();b uuid:=gen_random_uuid();owner_id uuid;begin
 if private.ai_budget_period('2026-10-31 19:59:59+00')<>date '2026-10-01'
 or private.ai_budget_period('2026-10-31 20:00:00+00')<>date '2026-11-01' then raise exception 'MUSCAT_BOUNDARY_FAILED';end if;
 select user_id into owner_id from public.platform_admins where role='owner' and status='active' limit 1;
 insert into public.companies(id,display_name,status,created_by) values(c,'Synthetic budget binding','active',owner_id);
 insert into public.billing_plans(id,code,name,status) values(p,'synthetic-budget-'||p,'Synthetic budget','active');
 insert into public.billing_plan_versions(id,plan_id,version,amount_baisa,currency,period_days,period_unit,period_count,status) values(v,p,1,45000,'OMR',30,'month',1,'draft');
 insert into public.billing_subscriptions(id,company_id,plan_version_id,environment) values(s,c,v,'live');
 begin
  insert into public.ai_budget_accounts(id,scope,company_id,limit_baisa,enabled,period_start,subscription_id,plan_version_id)
  values(b,'company_live',c,5000,true,private.ai_budget_period(clock_timestamp()),s,v);
  raise exception 'UNCONFIGURED_BUDGET_ALLOWED';
 exception when check_violation then if SQLERRM<>'AI_BUDGET_BINDING_REQUIRED' then raise;end if;end;
 insert into private.ai_plan_budget_policies(plan_version_id,monthly_limit_baisa,created_by) values(v,5000,owner_id);
 insert into public.ai_budget_accounts(id,scope,company_id,limit_baisa,enabled,period_start,subscription_id,plan_version_id)
 values(b,'company_live',c,5000,true,private.ai_budget_period(clock_timestamp()),s,v);
 begin update public.ai_budget_accounts set limit_baisa=15000 where id=b;raise exception 'BOUND_BUDGET_MUTATED';exception when check_violation then if SQLERRM<>'AI_BUDGET_BINDING_IMMUTABLE' then raise;end if;end;
 begin update private.ai_plan_budget_policies set monthly_limit_baisa=15000 where plan_version_id=v;raise exception 'POLICY_MUTATED';exception when check_violation then if SQLERRM<>'AI_BUDGET_POLICY_IMMUTABLE' then raise;end if;end;
 begin delete from private.ai_plan_budget_policies where plan_version_id=v;raise exception 'POLICY_DELETED';exception when check_violation then if SQLERRM<>'AI_BUDGET_POLICY_IMMUTABLE' then raise;end if;end;
 begin
  insert into public.ai_budget_accounts(scope,company_id,limit_baisa,enabled,period_start,subscription_id,plan_version_id)
  values('company_live',gen_random_uuid(),5000,true,private.ai_budget_period(clock_timestamp()),s,v);
  raise exception 'CROSS_TENANT_BUDGET_ALLOWED';
 exception when check_violation then if SQLERRM<>'AI_BUDGET_BINDING_REQUIRED' then raise;end if;end;
 update public.ai_budget_accounts set held_baisa=7,spent_baisa=3 where id=b;
 if not exists(select 1 from public.ai_budget_accounts where id=b and held_baisa=7 and spent_baisa=3 and limit_baisa=5000) then raise exception 'ACCOUNTING_FIELDS_BLOCKED';end if;
end;$$;
select 'PASS|Muscat midnight boundary, explicit policy, immutable binding, cross-tenant rejection, cost counters';
do $$ begin
 if has_table_privilege('service_role','private.ai_plan_budget_policies','SELECT,INSERT,UPDATE,DELETE')
 or has_table_privilege('authenticated','private.ai_plan_budget_policies','SELECT,INSERT,UPDATE,DELETE')
 or has_function_privilege('anon','public.billing_bind_ai_budget_draft(uuid,numeric,bigint)','EXECUTE')
 or has_function_privilege('service_role','public.billing_bind_ai_budget_draft(uuid,numeric,bigint)','EXECUTE') then raise exception 'BUDGET_POLICY_ACL_FAILED';end if;
end;$$;
set local role authenticated;
select case when public.billing_bind_ai_budget_draft(gen_random_uuid(),5000,1)->>'code'='forbidden' then 'PASS|Unauthenticated owner configuration denied' else 'FAIL|Owner denial' end;
rollback;
