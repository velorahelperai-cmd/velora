-- LOCAL-ONLY REVIEW CANDIDATE. No top-level transaction: the caller must wrap
-- installer + native tests in BEGIN/ROLLBACK. Not a Production apply approval.
-- These owner-only helpers consume authority established by the native integration;
-- they are NOT standalone worker/browser authorization or provider receipt APIs.
create table private.es02_reply_credit_holds (
 job_id uuid primary key references public.whatsapp_inbound_jobs(id),
 company_id uuid not null references public.companies(id),
 balance_id uuid not null references private.es02_credit_balances(id),
 order_group_id uuid not null,
 state text not null default 'held' check(state in ('held','accepted','unknown','released')),
 review_required boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 accepted_at timestamptz,
 released_at timestamptz,
 check((state='accepted')=(accepted_at is not null)),
 check((state='released')=(released_at is not null))
);
alter table private.es02_reply_credit_holds owner to postgres;
alter table private.es02_reply_credit_holds enable row level security;
revoke all on private.es02_reply_credit_holds from public,anon,authenticated,service_role;
create index es02_reply_credit_holds_balance_pending on private.es02_reply_credit_holds(balance_id) where state in ('held','unknown');
create index es02_reply_credit_holds_company_review on private.es02_reply_credit_holds(company_id) where review_required;

create function private.es02_reply_credit_hold_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'ES02_CREDIT_HISTORY_IMMUTABLE' using errcode='23514';end if;
 if tg_op='INSERT' then
  if new.state<>'held' or new.review_required or not exists(select 1 from public.whatsapp_inbound_jobs j
   join private.es02_credit_balances b on b.id=new.balance_id and b.company_id=j.company_id
   where j.id=new.job_id and j.company_id=new.company_id) then
   raise exception 'ES02_CREDIT_HOLD_BINDING_INVALID' using errcode='23514';
  end if;
 else
  if row(new.job_id,new.company_id,new.balance_id,new.order_group_id,new.created_at)
   is distinct from row(old.job_id,old.company_id,old.balance_id,old.order_group_id,old.created_at)
   or (old.review_required and not new.review_required)
   or (old.state='accepted' and row(new.state,new.accepted_at,new.released_at) is distinct from row(old.state,old.accepted_at,old.released_at))
   or (old.state='released' and row(new.state,new.accepted_at,new.released_at) is distinct from row(old.state,old.accepted_at,old.released_at)) then
   raise exception 'ES02_CREDIT_HOLD_IMMUTABLE' using errcode='23514';
  end if;
 end if;
 return new;
end;$$;
alter function private.es02_reply_credit_hold_guard() owner to postgres;
revoke all on function private.es02_reply_credit_hold_guard() from public,anon,authenticated,service_role;
create trigger es02_reply_credit_hold_guard before insert or update or delete on private.es02_reply_credit_holds
 for each row execute function private.es02_reply_credit_hold_guard();

create function private.es02_hold_reply_credit(p_job_id uuid,p_company_id uuid,p_order_group_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h private.es02_reply_credit_holds;b private.es02_credit_balances;
begin
 if p_job_id is null or p_company_id is null or p_order_group_id is null then
  return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 -- Native caller already holds company -> subscription -> conversation -> job.
 -- Reacquiring the same company/job locks does not change that global order.
 perform 1 from public.companies where id=p_company_id for no key update;
 if not found then return jsonb_build_object('ok',false,'code','CREDIT_SCOPE_INVALID');end if;
 perform 1 from public.whatsapp_inbound_jobs where id=p_job_id and company_id=p_company_id for update;
 if not found then return jsonb_build_object('ok',false,'code','CREDIT_SCOPE_INVALID');end if;
 select * into h from private.es02_reply_credit_holds where job_id=p_job_id for update;
 if h.job_id is not null then
  if h.company_id<>p_company_id or h.order_group_id<>p_order_group_id then return jsonb_build_object('ok',false,'code','CREDIT_SCOPE_INVALID');end if;
  if h.state='accepted' then return jsonb_build_object('ok',false,'code','CREDIT_ALREADY_ACCEPTED');end if;
  if h.state='unknown' then return jsonb_build_object('ok',false,'code','CREDIT_RECONCILIATION_REQUIRED');end if;
  if h.state='released' then return jsonb_build_object('ok',false,'code','CREDIT_RESERVATION_RELEASED');end if;
 end if;
 if exists(select 1 from private.es02_reply_credit_holds where company_id=p_company_id and review_required) then
  return jsonb_build_object('ok',false,'code','CREDIT_ACCOUNTING_REVIEW');end if;
 -- Before the INITIAL clock starts, exactly one real-customer reply may be
 -- potentially accepted. UNKNOWN (and accepted-but-clock-pending) fences all
 -- competing initial dispatches. Test-number work does not start that clock.
 if to_regclass('private.es02_operational_recipient_proofs') is not null then
  if exists(select 1 from private.es02_activation_foundation a where a.company_id=p_company_id and a.clock_state='waiting_readiness')
   and exists(select 1 from private.es02_operational_recipient_proofs r where r.job_id=p_job_id and r.company_id=p_company_id and r.recipient_class='real_customer')
   and exists(select 1 from private.es02_reply_credit_holds pending join private.es02_operational_recipient_proofs r on r.job_id=pending.job_id
    where pending.company_id=p_company_id and pending.job_id<>p_job_id and r.company_id=p_company_id
     and r.recipient_class='real_customer' and pending.state in ('held','unknown','accepted')) then
   return jsonb_build_object('ok',false,'code','INITIAL_REPLY_PENDING');
  end if;
 end if;
 if h.job_id is not null then return jsonb_build_object('ok',true,'reused',true,'state','held','balanceId',h.balance_id);end if;
 -- Purchased capacity is company-owned across order groups, without ordinary
 -- expiry. Base capacity remains bound to this authorized order group/expiry.
 -- No SKIP LOCKED: never fall through to base because a purchased row is busy.
 select x.* into b from private.es02_credit_balances x
 where x.company_id=p_company_id
 and ((x.kind='purchased') or (x.kind='base' and x.order_group_id=p_order_group_id
  and (x.ordinary_expiry is null or x.ordinary_expiry>clock_timestamp())))
 and x.remaining>(select count(*) from private.es02_reply_credit_holds pending
  where pending.balance_id=x.id and pending.state in ('held','unknown'))
 order by case x.kind when 'purchased' then 0 else 1 end,x.created_at,x.id
 limit 1 for update;
 if b.id is null then return jsonb_build_object('ok',false,'code','CREDITS_EXHAUSTED');end if;
 insert into private.es02_reply_credit_holds(job_id,company_id,balance_id,order_group_id)
 values(p_job_id,p_company_id,b.id,p_order_group_id);
 return jsonb_build_object('ok',true,'reused',false,'state','held','kind',b.kind,'balanceId',b.id);
end;$$;
alter function private.es02_hold_reply_credit(uuid,uuid,uuid) owner to postgres;
revoke all on function private.es02_hold_reply_credit(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function private.es02_settle_reply_credit(p_job_id uuid,p_state text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h private.es02_reply_credit_holds;cid uuid;left_units integer;
begin
 if p_job_id is null or p_state is null or p_state not in ('accepted','unknown','released') then
  return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select company_id into cid from private.es02_reply_credit_holds where job_id=p_job_id;
 if cid is null then return jsonb_build_object('ok',false,'code','CREDIT_HOLD_MISSING');end if;
 perform 1 from public.companies where id=cid for no key update;
 perform 1 from public.whatsapp_inbound_jobs where id=p_job_id and company_id=cid for update;
 select * into h from private.es02_reply_credit_holds where job_id=p_job_id for update;
 if h.state='accepted' then
  if p_state='accepted' then return jsonb_build_object('ok',true,'reused',true,'state','accepted');end if;
  return jsonb_build_object('ok',false,'code','CREDIT_ALREADY_ACCEPTED');
 end if;
 if h.state='released' then
  if p_state='released' then return jsonb_build_object('ok',true,'reused',true,'state','released');end if;
  -- A contradictory late receipt must not consume unrelated capacity, create
  -- units or silently vanish. Retain the liability and stop fresh allocations.
  update private.es02_reply_credit_holds set review_required=true,updated_at=clock_timestamp() where job_id=p_job_id;
  return jsonb_build_object('ok',false,'code','CREDIT_ACCOUNTING_REVIEW','accountingReview',true);
 end if;
 if p_state='accepted' then
  update private.es02_credit_balances set remaining=remaining-1
   where id=h.balance_id and company_id=h.company_id and remaining>=1 returning remaining into left_units;
  if not found then
   update private.es02_reply_credit_holds set review_required=true,updated_at=clock_timestamp() where job_id=p_job_id;
   return jsonb_build_object('ok',false,'code','CREDIT_ACCOUNTING_REVIEW','accountingReview',true);
  end if;
  update private.es02_reply_credit_holds set state='accepted',accepted_at=clock_timestamp(),updated_at=clock_timestamp() where job_id=p_job_id;
  return jsonb_build_object('ok',true,'reused',false,'state','accepted','remaining',left_units);
 end if;
 update private.es02_reply_credit_holds set state=p_state,
  released_at=case when p_state='released' then clock_timestamp() else null end,
  updated_at=clock_timestamp() where job_id=p_job_id;
 return jsonb_build_object('ok',true,'reused',h.state=p_state,'state',p_state);
end;$$;
alter function private.es02_settle_reply_credit(uuid,text) owner to postgres;
revoke all on function private.es02_settle_reply_credit(uuid,text) from public,anon,authenticated,service_role;
