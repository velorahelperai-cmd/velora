-- LOCAL-ONLY REVIEW CANDIDATE. Caller owns transaction and reviewed installation.
-- Reuses native company_live AI budget/cost ledger. No prices, budgets, balances
-- or financial grants are created. Legacy worker RPCs and plan bindings remain.
alter table public.ai_usage_ledger
 add column es02_order_id uuid references private.es02_account_orders(id),
 add column es02_branch_id uuid references public.company_branches(id),
 add column es02_slot_index integer,
 add column es02_paid_fingerprint text,
 add column es02_persona text;
alter table public.ai_usage_ledger add constraint ai_es02_worker_profile_complete check(
 (es02_order_id is null and es02_branch_id is null and es02_slot_index is null and es02_paid_fingerprint is null and es02_persona is null)
 or (es02_order_id is not null and es02_branch_id is not null and es02_slot_index is not null and es02_slot_index between 0 and 31
 and es02_paid_fingerprint is not null and es02_paid_fingerprint ~ '^[0-9a-f]{64}$'
 and es02_persona is not null and es02_persona in ('noura','lina','dana')
 and usage_mode='company_live' and worker_job_id is not null and worker_claim_token is not null
 and answer_persona is null and answer_plan_version_id is null));

create function private.es02_worker_cost_binding_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare authority jsonb;
begin
 if tg_op='UPDATE' then
  if row(new.es02_order_id,new.es02_branch_id,new.es02_slot_index,new.es02_paid_fingerprint,new.es02_persona)
   is distinct from row(old.es02_order_id,old.es02_branch_id,old.es02_slot_index,old.es02_paid_fingerprint,old.es02_persona) then
   raise exception 'ES02_WORKER_COST_BINDING_IMMUTABLE' using errcode='23514';end if;
 elsif new.es02_order_id is not null then
  authority:=private.es02_claimed_reply_authority(new.worker_job_id,new.worker_claim_token);
  if new.status is distinct from 'reserved' or not exists(
   select 1 from public.whatsapp_inbound_jobs j
   join private.es02_branch_slot_rights r on r.company_id=j.company_id
    and r.branch_id=new.es02_branch_id and r.order_id=new.es02_order_id and r.slot_index=new.es02_slot_index
   where j.id=new.worker_job_id and j.company_id=new.company_id
   and j.claim_token=new.worker_claim_token and j.expected_automation_generation=new.automation_generation
  ) or authority->>'ok' is distinct from 'true'
   or authority->>'company_id' is distinct from new.company_id::text or authority->>'order_id' is distinct from new.es02_order_id::text
   or authority->>'branch_id' is distinct from new.es02_branch_id::text or authority->>'slot_index' is distinct from new.es02_slot_index::text
   or authority->>'paid_fingerprint' is distinct from new.es02_paid_fingerprint or authority->>'persona' is distinct from new.es02_persona
   or not exists(select 1 from private.es02_reply_credit_holds h where h.job_id=new.worker_job_id and h.company_id=new.company_id and h.state='held')
   then raise exception 'ES02_WORKER_COST_BINDING_INVALID' using errcode='23514';end if;
 end if;
 return new;
end;$$;
alter function private.es02_worker_cost_binding_guard() owner to postgres;
revoke all on function private.es02_worker_cost_binding_guard() from public,anon,authenticated,service_role;
create trigger ai_es02_worker_cost_binding_guard before insert or update on public.ai_usage_ledger
 for each row execute function private.es02_worker_cost_binding_guard();

-- Citation conventions are the actual server loader conventions: native UUID,
-- page-<uuid> for indexed same-branch website pages, hours-<branch uuid> for B4.
create function private.es02_whatsapp_citations_current(p_company_id uuid,p_branch_id uuid,p_citations jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare x jsonb;sid text;v numeric;k public.knowledge_sources;page private.es02_branch_website_pages;hours private.es02_branch_hours;
begin
 if p_company_id is null or p_branch_id is null or jsonb_typeof(p_citations) is distinct from 'array'
 then return false;end if;
 if jsonb_array_length(p_citations) not between 1 and 40 then return false;end if;
 if not exists(select 1 from public.company_branches where id=p_branch_id and company_id=p_company_id) then return false;end if;
 for x in select value from jsonb_array_elements(p_citations) loop
  if jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'sourceId') is distinct from 'string'
   or jsonb_typeof(x->'contentVersion') is distinct from 'number' then return false;end if;
  sid:=x->>'sourceId';v:=(x->>'contentVersion')::numeric;
  if v<1 or v>2147483647 or v<>trunc(v) then return false;end if;
  if sid='hours-'||p_branch_id::text then
   select * into hours from private.es02_branch_hours where company_id=p_company_id and branch_id=p_branch_id for share;
   if not found or hours.revision is distinct from v::bigint or (x ? 'title' and x->>'title' is distinct from 'Working Hours') then return false;end if;
  elsif left(sid,5)='page-' then
   select * into page from private.es02_branch_website_pages where id=substring(sid from 6)::uuid
    and company_id=p_company_id and branch_id=p_branch_id for share;
   if not found or page.status<>'indexed' or length(btrim(page.extracted_text))=0 or page.version is distinct from v::integer
    or (x ? 'title' and x->>'title' is distinct from coalesce(nullif(page.title,''),page.url)) then return false;end if;
  else
   select * into k from public.knowledge_sources where id=sid::uuid and company_id=p_company_id for share;
   if not found or k.status<>'ready' or not k.approved_for_answers or k.approved_version is distinct from k.content_version
    or k.content_version is distinct from v::integer or length(btrim(k.content))=0
    or (x ? 'title' and x->>'title' is distinct from k.title) then return false;end if;
  end if;
 end loop;
 if (select count(distinct value->>'sourceId') from jsonb_array_elements(p_citations))<>jsonb_array_length(p_citations) then return false;end if;
 -- Preserve the existing mandatory business-instruction inclusion rule.
 return private.whatsapp_citations_include_current_instructions(p_company_id,p_citations);
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;$$;
alter function private.es02_whatsapp_citations_current(uuid,uuid,jsonb) owner to postgres;
revoke all on function private.es02_whatsapp_citations_current(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.es02_reserve_whatsapp_capacity_cost_attempt(
 p_id uuid,p_job_id uuid,p_claim_token uuid,p_attempt integer,p_model_id text,p_provider text,p_reserved_baisa numeric,
 p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb,p_expected_persona text,
 p_expected_order_id uuid,p_expected_branch_id uuid,p_expected_slot_index integer,p_expected_paid_fingerprint text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare gate jsonb;final_gate jsonb;r jsonb;budget public.ai_budget_accounts;j public.whatsapp_inbound_jobs;cid uuid;generation integer;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if p_id is null or p_job_id is null or p_claim_token is null or p_attempt is null or p_attempt not between 1 and 3
 or p_reserved_baisa is null or p_reserved_baisa<=0 or p_reserved_baisa>1000 or p_reserved_baisa::text in ('NaN','Infinity','-Infinity')
 or p_model_id is null or p_provider is null
 or not ((p_model_id='gemini-3.8-flash' and p_provider='google') or (p_model_id in ('gpt-6-luna','gpt-6.1-sol') and p_provider='openai'))
 or length(btrim(coalesce(p_pricing_version,'')))=0 or jsonb_typeof(p_pricing_snapshot) is distinct from 'object'
 or p_pricing_snapshot->>'modelId' is distinct from p_model_id or p_pricing_snapshot->>'version' is distinct from p_pricing_version
 or p_expected_persona is null or p_expected_persona not in ('noura','lina','dana') or p_expected_order_id is null or p_expected_branch_id is null
 or p_expected_slot_index is null or p_expected_slot_index not between 0 and 31 or coalesce(p_expected_paid_fingerprint,'') !~ '^[0-9a-f]{64}$'
 then return jsonb_build_object('ok',false,'code','INVALID_RESERVATION');end if;
 begin
  gate:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
  if gate->>'ok' is distinct from 'true' then r:=gate;raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  if gate->>'persona' is distinct from p_expected_persona or gate->>'order_id' is distinct from p_expected_order_id::text
   or gate->>'branch_id' is distinct from p_expected_branch_id::text or gate->>'slot_index' is distinct from p_expected_slot_index::text
   or gate->>'paid_fingerprint' is distinct from p_expected_paid_fingerprint then
   r:=jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  cid:=(gate->>'company_id')::uuid;
  select * into j from public.whatsapp_inbound_jobs where id=p_job_id and company_id=cid for update;
  if not found or j.expected_automation_generation is null or j.claim_token is distinct from p_claim_token then
   r:=jsonb_build_object('ok',false,'code','CLAIM_REJECTED');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  generation:=j.expected_automation_generation;
  if j.usage_status in ('accepted','unknown') then
   r:=jsonb_build_object('ok',false,'code','usage_already_final_or_unknown');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  if gate->>'subscription_id' is null or gate->>'period_start' is null or (j.usage_status='reserved' and
   (j.usage_subscription_id is distinct from (gate->>'subscription_id')::uuid or j.usage_period_start is distinct from (gate->>'period_start')::timestamptz)) then
   r:=jsonb_build_object('ok',false,'code','USAGE_BINDING_CHANGED');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  r:=private.es02_hold_reply_credit(p_job_id,cid,(gate->>'order_group_id')::uuid);
  if r->>'ok' is distinct from 'true' then raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  update public.whatsapp_inbound_jobs set usage_status='reserved',usage_subscription_id=(gate->>'subscription_id')::uuid,
   usage_period_start=(gate->>'period_start')::timestamptz where id=p_job_id and company_id=cid;
  if not private.es02_whatsapp_citations_current(cid,p_expected_branch_id,p_source_citations) then
   r:=jsonb_build_object('ok',false,'code','KNOWLEDGE_CHANGED');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  select * into budget from public.ai_budget_accounts where scope='company_live' and company_id=cid
   and period_start=date_trunc('month',clock_timestamp())::date for update;
  if not found or not budget.enabled then r:=jsonb_build_object('ok',false,'code','BUDGET_DISABLED');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  if exists(select 1 from public.ai_usage_ledger where id=p_id or (execution_id=p_job_id and attempt=p_attempt)) then
   r:=jsonb_build_object('ok',false,'code','DUPLICATE_REQUEST');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  if exists(select 1 from public.ai_usage_ledger where worker_job_id=p_job_id and
   (automation_generation is distinct from generation or status<>'rejected' or cost_baisa is distinct from 0
    or cost_usd is distinct from 0 or error_code not in ('KEY_MISSING','PROVIDER_HTTP_403','PROVIDER_HTTP_404') or error_code is null)) then
   r:=jsonb_build_object('ok',false,'code','PRIOR_ATTEMPT_NOT_RETRYABLE');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  if (select count(*) from public.ai_usage_ledger where worker_job_id=p_job_id and automation_generation=generation)<>p_attempt-1
   or (p_attempt>1 and not exists(select 1 from public.ai_usage_ledger where worker_job_id=p_job_id
    and automation_generation=generation and attempt=p_attempt-1 and worker_claim_token=p_claim_token
    and es02_order_id=p_expected_order_id and es02_branch_id=p_expected_branch_id and es02_slot_index=p_expected_slot_index
    and es02_paid_fingerprint=p_expected_paid_fingerprint and es02_persona=p_expected_persona)) then
   r:=jsonb_build_object('ok',false,'code','ATTEMPT_SEQUENCE_REJECTED');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  if budget.spent_baisa+budget.held_baisa+p_reserved_baisa>budget.limit_baisa then
   r:=jsonb_build_object('ok',false,'code','BUDGET_EXCEEDED');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  insert into public.ai_usage_ledger(id,budget_account_id,company_id,execution_id,attempt,usage_mode,model_id,provider,
   reserved_baisa,pricing_version,pricing_snapshot,worker_job_id,worker_claim_token,automation_generation,source_citations,
   es02_order_id,es02_branch_id,es02_slot_index,es02_paid_fingerprint,es02_persona)
  values(p_id,budget.id,cid,p_job_id,p_attempt,'company_live',p_model_id,p_provider,p_reserved_baisa,p_pricing_version,p_pricing_snapshot,
   p_job_id,p_claim_token,generation,p_source_citations,p_expected_order_id,p_expected_branch_id,p_expected_slot_index,p_expected_paid_fingerprint,p_expected_persona);
  update public.ai_budget_accounts set held_baisa=held_baisa+p_reserved_baisa where id=budget.id;
  -- Recheck authority after shared locks and all new writes. Any denial rolls
  -- this subtransaction back, preserving earlier durable/unknown reservations.
  final_gate:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
  if final_gate->>'ok' is distinct from 'true' or (final_gate-'asOf') is distinct from (gate-'asOf') then
   r:=jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  return jsonb_build_object('ok',true,'id',p_id,'job_id',p_job_id,'company_id',cid,'automation_generation',generation,
   'answer_persona',p_expected_persona,'es02_order_id',p_expected_order_id,'es02_branch_id',p_expected_branch_id,
   'es02_slot_index',p_expected_slot_index,'es02_paid_fingerprint',p_expected_paid_fingerprint,
   'remaining_baisa',budget.limit_baisa-budget.spent_baisa-budget.held_baisa-p_reserved_baisa);
 exception when sqlstate 'PEC01' then return r;end;
end;$$;
alter function public.es02_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid,uuid,integer,text) owner to postgres;
revoke all on function public.es02_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.es02_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid,uuid,integer,text) to service_role;

create function private.es02_start_whatsapp_attempt(p_id uuid,p_claim_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare a public.ai_usage_ledger;gate jsonb;final_gate jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 select * into a from public.ai_usage_ledger where id=p_id;
 if not found or a.es02_order_id is null or a.worker_job_id is null or p_claim_token is null
  or a.worker_claim_token is distinct from p_claim_token or a.status<>'reserved' then return false;end if;
 begin
  gate:=private.es02_claimed_reply_authority(a.worker_job_id,p_claim_token);
  if gate->>'ok' is distinct from 'true' or gate->>'company_id' is distinct from a.company_id::text
   or gate->>'order_id' is distinct from a.es02_order_id::text or gate->>'branch_id' is distinct from a.es02_branch_id::text
   or gate->>'slot_index' is distinct from a.es02_slot_index::text or gate->>'paid_fingerprint' is distinct from a.es02_paid_fingerprint
   or gate->>'persona' is distinct from a.es02_persona then return false;end if;
  if not exists(select 1 from public.whatsapp_inbound_jobs where id=a.worker_job_id and company_id=a.company_id
   and expected_automation_generation=a.automation_generation and usage_status='reserved'
   and usage_subscription_id=(gate->>'subscription_id')::uuid and usage_period_start=(gate->>'period_start')::timestamptz)
   or not exists(select 1 from private.es02_reply_credit_holds where job_id=a.worker_job_id and company_id=a.company_id and state='held' and not review_required)
   or exists(select 1 from private.es02_reply_credit_holds where company_id=a.company_id and review_required)
   or not private.es02_whatsapp_citations_current(a.company_id,a.es02_branch_id,a.source_citations) then return false;end if;
  perform 1 from public.ai_budget_accounts where id=a.budget_account_id and enabled and scope='company_live' and company_id=a.company_id
   and period_start=date_trunc('month',clock_timestamp())::date for update;
  if not found then return false;end if;
  select * into a from public.ai_usage_ledger where id=p_id and status='reserved' and worker_claim_token=p_claim_token for update;
  if not found then return false;end if;
  final_gate:=private.es02_claimed_reply_authority(a.worker_job_id,p_claim_token);
  if final_gate->>'ok' is distinct from 'true' or (final_gate-'asOf') is distinct from (gate-'asOf') then return false;end if;
  update public.ai_usage_ledger set status='running' where id=p_id and status='reserved' and worker_claim_token=p_claim_token;
  return found;
 end;
end;$$;
alter function private.es02_start_whatsapp_attempt(uuid,uuid) owner to postgres;
revoke all on function private.es02_start_whatsapp_attempt(uuid,uuid) from public,anon,authenticated,service_role;
