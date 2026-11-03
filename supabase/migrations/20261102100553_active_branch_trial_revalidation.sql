-- DRAFT ONLY: partial change; do not deploy until reservation and context
-- are updated and tested together with this read predicate.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Local draft only: explicit one-use authority, initially no grants.
create table private.es02_branch_revalidation_grants (
 company_id uuid not null,
 branch_id uuid not null,
 operation_id uuid unique,
 primary key (company_id, branch_id),
 foreign key (company_id, branch_id) references public.company_branches(company_id, id)
);
revoke all on table private.es02_branch_revalidation_grants from public, anon, authenticated, service_role;
do $draft$
declare body text; needle text := 'branch.status=''setup''';
begin
 body := pg_get_functiondef('public.es02_read_owned_branch_assistant_trial(uuid,uuid,uuid)'::regprocedure);
 if (length(body)-length(replace(body,needle,''))) / length(needle) <> 1 then
   raise exception 'TRIAL_READ_PREREQUISITE_MISMATCH';
 end if;
 execute replace(body,needle,'branch.status in (''setup'',''active'')');
end;
$draft$;

-- Draft read predicate mirrors the reservation exception and retains the
-- existing pending-operation check following this expression.
do $draft$
declare body text; needle text := E'<10 and\n          not exists'; replacement text;
begin
 body := pg_get_functiondef('public.es02_read_owned_branch_assistant_trial(uuid,uuid,uuid)'::regprocedure);
 if (length(body)-length(replace(body,needle,''))) / length(needle) <> 1 then
  raise exception 'TRIAL_READ_QUOTA_PREREQUISITE_MISMATCH';
 end if;
 if (length(body)-length(replace(body,'''canAsk'', branch.status in (''setup'',''active'') and',''))) / length('''canAsk'', branch.status in (''setup'',''active'') and') <> 1 then
  raise exception 'TRIAL_READ_STATUS_PREREQUISITE_MISMATCH';
 end if;
 replacement := $sql$<10 or (branch.status='active' and exists(select 1 from private.es02_branch_revalidation_grants g where g.company_id=p_company_id and g.branch_id=p_branch_id and g.operation_id is null))) and
          not exists$sql$;
 body := replace(body,'''canAsk'', branch.status in (''setup'',''active'') and', '''canAsk'', branch.status in (''setup'',''active'') and (');
 execute replace(body,needle,replacement);
end;
$draft$;

-- Draft guard for reservation: only an active branch with no previous
-- attempt at its current hours revision may exceed the initial trial count.
-- Preserve existing pending checks and both cost limits.
do $draft$
declare body text; needle text := 'if used+unresolved>=10 then'; replacement text;
begin
 body := pg_get_functiondef('public.es02_reserve_branch_trial(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,numeric,text,jsonb,jsonb)'::regprocedure);
 if (length(body)-length(replace(body,needle,''))) / length(needle) <> 1 then
  raise exception 'TRIAL_RESERVE_PREREQUISITE_MISMATCH';
 end if;
 replacement := $sql$if used+unresolved>=10 and not (
  exists(select 1 from public.company_branches b where b.id=p_branch_id and b.company_id=p_company_id and b.status='active')
  and exists(select 1 from private.es02_branch_revalidation_grants g where g.company_id=p_company_id and g.branch_id=p_branch_id and g.operation_id is null)
 ) then$sql$;
 needle := 'insert into public.ai_usage_ledger(id,budget_account_id';
 if (length(body)-length(replace(body,needle,''))) / length(needle) <> 1 then
  raise exception 'TRIAL_RESERVE_INSERT_PREREQUISITE_MISMATCH';
 end if;
 body := replace(body, 'if used+unresolved>=10 then', replacement);
 body := replace(body,needle,$sql$if used+unresolved>=10 then
   update private.es02_branch_revalidation_grants set operation_id=p_operation_id
    where company_id=p_company_id and branch_id=p_branch_id and operation_id is null;
   if not found then return jsonb_build_object('ok',false,'code','TRIAL_LIMIT_REACHED'); end if;
  end if;
  insert into public.ai_usage_ledger(id,budget_account_id$sql$);
 execute body;
end;
$draft$;

do $draft$
declare body text; needle text := 'b.status=''setup''';
begin
 body := pg_get_functiondef('private.es02_trial_context_current(private.es02_branch_trial_operations)'::regprocedure);
 if (length(body)-length(replace(body,needle,''))) / length(needle) <> 1 then
   raise exception 'TRIAL_CONTEXT_PREREQUISITE_MISMATCH';
 end if;
 execute replace(body,needle,'b.status in (''setup'',''active'')');
end;
$draft$;
commit;
