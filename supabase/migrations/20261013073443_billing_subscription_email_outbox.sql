-- Additive, private email receipts. No historical backfill, provider calls or activation.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $$ begin
 if to_regprocedure('public.billing_admin_authorized_session()') is null
 or md5(replace(pg_get_viewdef(to_regclass('private.billing_verified_collection_history'),true),chr(13),'')) is distinct from 'cdda398ed1d2f6bf1b0a4db89fcced9f'
 or md5(replace(pg_get_viewdef(to_regclass('private.billing_proven_entitlement_grants'),true),chr(13),'')) is distinct from '6c6d6a29a1dfae3e667948901044a7b1'
 or to_regclass('private.billing_service_order_offers') is null then
  raise exception 'EMAIL_BILLING_EVIDENCE_PREREQUISITE_MISMATCH' using errcode='55000';
 end if;
end; $$;
create table private.billing_subscription_email_outbox (
 id uuid primary key references public.billing_entitlement_applications(id) on delete restrict,
 company_id uuid not null references public.companies(id) on delete restrict,
 order_id uuid not null references public.billing_orders(id) on delete restrict,
 recipient_user_id uuid not null,
 recipient_email text not null check(length(recipient_email)<=254 and recipient_email ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$'),
 company_name text not null check(length(company_name)<=120),
 amount_baisa bigint not null check(amount_baisa between 1 and 9007199254740991),
 paid_through timestamptz not null check(isfinite(paid_through)),
 state text not null default 'queued' check(state in ('queued','claimed','accepted','rejected','reconciliation_required','blocked')),
 claim_token uuid,
 claimed_at timestamptz,
 provider_id text check(provider_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 result_code text check(result_code in ('RESEND_ACCEPTED','RESEND_REJECTED','RESEND_OUTCOME_UNKNOWN','RECIPIENT_OR_RECEIPT_CHANGED')),
 finalized_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 check((state='accepted')=(provider_id is not null)),
 check((state in ('claimed','accepted','rejected','reconciliation_required'))=(claim_token is not null and claimed_at is not null))
);
alter table private.billing_subscription_email_outbox enable row level security;
revoke all on private.billing_subscription_email_outbox from public,anon,authenticated,service_role;
create index billing_email_queued on private.billing_subscription_email_outbox(created_at,id) where state='queued';

create function private.billing_email_guard() returns trigger language plpgsql set search_path='' as $$ begin
 if tg_op<>'UPDATE' then raise exception 'EMAIL_RECEIPT_IMMUTABLE';end if;
 if row(new.id,new.company_id,new.order_id,new.recipient_user_id,new.recipient_email,new.company_name,new.amount_baisa,new.paid_through,new.created_at)
 is distinct from row(old.id,old.company_id,old.order_id,old.recipient_user_id,old.recipient_email,old.company_name,old.amount_baisa,old.paid_through,old.created_at)
 or not ((old.state='queued' and new.state in ('claimed','blocked')) or (old.state='claimed' and new.state in ('accepted','rejected','reconciliation_required')))
 or (old.state='claimed' and row(new.claim_token,new.claimed_at) is distinct from row(old.claim_token,old.claimed_at)) then
  raise exception 'EMAIL_RECEIPT_IMMUTABLE';
 end if;return new;
end; $$;
create trigger billing_email_guard before update or delete on private.billing_subscription_email_outbox for each row execute function private.billing_email_guard();
create trigger billing_email_no_truncate before truncate on private.billing_subscription_email_outbox for each statement execute function private.billing_email_guard();

create function private.billing_enqueue_subscription_email() returns trigger language plpgsql security definer set search_path='' as $$ begin
 -- Deferred until the immutable receipt, order/attempt and subscription commit together.
 insert into private.billing_subscription_email_outbox(id,company_id,order_id,recipient_user_id,recipient_email,company_name,amount_baisa,paid_through)
 select h.id,h.company_id,h.order_id,u.id,lower(btrim(u.email)),btrim(c.display_name),o.amount_baisa,h.applied_paid_through
 from private.billing_proven_entitlement_grants h
 join public.billing_orders o on o.id=h.order_id and o.company_id=h.company_id
 join public.billing_subscriptions s on s.id=h.subscription_id and s.company_id=h.company_id and s.environment='live' and s.status='active'
 join private.billing_service_order_offers so on so.order_id=o.id and so.environment='live' and so.service_code='noura'
 join public.companies c on c.id=h.company_id and c.status in ('setup','active')
 join public.company_members m on m.company_id=c.id and m.user_id=o.created_by and m.role='owner' and m.status='active'
 join auth.users u on u.id=m.user_id and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
 where h.id=new.entitlement_application_id and h.provider_environment='live' and s.paid_through>=h.applied_paid_through and h.applied_paid_through>clock_timestamp()
 and isfinite(h.applied_paid_through) and o.amount_baisa between 1 and 9007199254740991 and length(btrim(c.display_name))<=120
 and length(lower(btrim(u.email)))<=254 and lower(btrim(u.email)) ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$'
 on conflict(id) do nothing;
 return new;
end; $$;
create constraint trigger billing_subscription_email_receipt after insert on public.billing_settlement_outcomes
 deferrable initially deferred for each row when(new.outcome='granted' and new.provider_environment='live') execute function private.billing_enqueue_subscription_email();

create function public.billing_claim_subscription_email() returns jsonb language plpgsql security definer set search_path='' as $$
declare q private.billing_subscription_email_outbox%rowtype;token uuid;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 -- Bounded scan; no lease expiry, retry, or claim reuse. An abandoned claim stays unresolved.
 for i in 1..20 loop
  select * into q from private.billing_subscription_email_outbox where state='queued' order by created_at,id for update skip locked limit 1;
  if not found then return jsonb_build_object('ok',true,'claim',null);end if;
  if not exists(select 1 from auth.users u join public.company_members m on m.user_id=u.id and m.company_id=q.company_id
    join public.companies c on c.id=m.company_id and c.status in ('setup','active')
    join private.billing_proven_entitlement_grants h on h.id=q.id and h.company_id=q.company_id and h.order_id=q.order_id and h.provider_environment='live'
    join public.billing_subscriptions s on s.id=h.subscription_id and s.company_id=h.company_id and s.environment='live' and s.status='active'
    where u.id=q.recipient_user_id and lower(btrim(u.email))=q.recipient_email and u.email_confirmed_at is not null and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=clock_timestamp()) and m.role='owner' and m.status='active'
    and s.paid_through>=h.applied_paid_through and h.applied_paid_through>clock_timestamp()) then
   update private.billing_subscription_email_outbox set state='blocked',result_code='RECIPIENT_OR_RECEIPT_CHANGED',finalized_at=clock_timestamp() where id=q.id;
   continue;
  end if;
  token:=gen_random_uuid();update private.billing_subscription_email_outbox set state='claimed',claim_token=token,claimed_at=clock_timestamp() where id=q.id;
  return jsonb_build_object('ok',true,'claim',jsonb_build_object('id',q.id,'claimToken',token,'idempotencyKey','velora-subscription-receipt/'||q.id::text||'/v1','recipient',q.recipient_email,'companyName',q.company_name,'orderId',q.order_id,'amountBaisa',q.amount_baisa,'paidThrough',q.paid_through));
 end loop;return jsonb_build_object('ok',true,'claim',null);
end; $$;
create function public.billing_finish_subscription_email(p_id uuid,p_claim_token uuid,p_status text,p_provider_id text,p_code text)
returns boolean language plpgsql security definer set search_path='' as $$ begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if p_id is null or p_claim_token is null or p_status is null or p_code is null
 or not ((p_status='accepted' and p_code='RESEND_ACCEPTED' and p_provider_id is not null and p_provider_id ~ '^[A-Za-z0-9_-]{1,128}$')
 or (p_status='rejected' and p_code='RESEND_REJECTED' and p_provider_id is null)
 or (p_status='reconciliation_required' and p_code='RESEND_OUTCOME_UNKNOWN' and p_provider_id is null)) then return false;end if;
 update private.billing_subscription_email_outbox set state=p_status,provider_id=p_provider_id,result_code=p_code,finalized_at=clock_timestamp()
 where id=p_id and state='claimed' and claim_token=p_claim_token;
 return found;
end; $$;

create function public.billing_admin_read_subscription_email(p_company_id uuid,p_order_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 if not public.billing_admin_authorized_session() then return jsonb_build_object('ok',false,'code','forbidden');end if;
 if not exists(select 1 from public.billing_orders where id=p_order_id and company_id=p_company_id) then return jsonb_build_object('ok',false,'code','not_found');end if;
 select jsonb_build_object('state',q.state,'queuedAt',q.created_at,'acceptedAt',case when q.state='accepted' then q.finalized_at else null end,'delivered',false)
 into result from private.billing_subscription_email_outbox q where q.company_id=p_company_id and q.order_id=p_order_id;
 return jsonb_build_object('ok',true,'companyId',p_company_id,'orderId',p_order_id,'email',coalesce(result,jsonb_build_object('state','not_queued','queuedAt',null,'acceptedAt',null,'delivered',false)));
end; $$;
revoke all on function private.billing_email_guard(),private.billing_enqueue_subscription_email() from public,anon,authenticated,service_role;
revoke all on function public.billing_claim_subscription_email(),public.billing_finish_subscription_email(uuid,uuid,text,text,text),public.billing_admin_read_subscription_email(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.billing_claim_subscription_email(),public.billing_finish_subscription_email(uuid,uuid,text,text,text) to service_role;
grant execute on function public.billing_admin_read_subscription_email(uuid,uuid) to authenticated;
comment on table private.billing_subscription_email_outbox is 'Immutable settled Live payment email to its verified active owner. accepted is provider acceptance only; no delivery webhook evidence. Claimed/ambiguous entries are never automatically resent.';
commit;
