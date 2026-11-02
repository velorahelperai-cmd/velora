-- Match production's versioned budget indexes without treating NULL plan IDs
-- as equal accidentally. More than one live account for a month fails closed.
begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
do $guard$ begin
 if to_regclass('public.ai_budget_company_es02_unique') is not null
  or exists(select 1 from public.ai_budget_accounts where scope='company_live' and subscription_id is not null and plan_version_id is null
    group by company_id,period_start having count(*)>1)
 then raise exception 'ES02_NATIVE_BUDGET_INDEX_PREREQUISITE_MISMATCH';end if;
end;$guard$;
create unique index ai_budget_company_es02_unique on public.ai_budget_accounts(company_id,period_start)
 where scope='company_live' and subscription_id is not null and plan_version_id is null;
do $patch$
declare body text; old_conflict text:='on conflict (company_id,period_start) where scope=''company_live'' do nothing';
 new_conflict text:='on conflict (company_id,period_start) where scope=''company_live'' and subscription_id is not null and plan_version_id is null do nothing';
 old_read text:='  select * into existing from public.ai_budget_accounts where scope=''company_live'' and company_id=policy.company_id';
 new_read text:='  if (select count(*) from public.ai_budget_accounts where scope=''company_live'' and company_id=policy.company_id and period_start=private.ai_budget_period(clock_timestamp()))<>1 then return jsonb_build_object(''ok'',false,''code'',''BUDGET_BINDING_CHANGED'');end if;'||chr(10)||old_read;
begin
 select pg_get_functiondef('public.es02_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid,uuid,integer,text)'::regprocedure) into body;
 if (length(body)-length(replace(body,old_conflict,'')))/length(old_conflict)<>1
  or (length(body)-length(replace(body,old_read,'')))/length(old_read)<>1 then raise exception 'ES02_NATIVE_BUDGET_SOURCE_DRIFT';end if;
 execute replace(replace(body,old_conflict,new_conflict),old_read,new_read);
end;$patch$;
commit;
