-- Forward acceptance guard; historical migration text remains unchanged.
begin;

create or replace function private.billing_payment_attempts_sync_order_scope()
returns trigger language plpgsql set search_path='' as $$
declare ord public.billing_orders%rowtype;
begin
 select * into ord from public.billing_orders where id=new.order_id and company_id=new.company_id;
 if not found then raise exception 'ATTEMPT_ORDER_SCOPE_MISSING' using errcode='23503';end if;
 if (new.provider is not null and new.provider is distinct from ord.provider)
  or (new.provider_account_ref is not null and new.provider_account_ref is distinct from ord.provider_account_ref)
  or (new.provider_environment is not null and new.provider_environment is distinct from ord.provider_environment)
 then raise exception 'ATTEMPT_PROVIDER_SCOPE_MISMATCH' using errcode='23514';end if;
 new.provider:=ord.provider;new.provider_account_ref:=ord.provider_account_ref;new.provider_environment:=ord.provider_environment;
 return new;
end;$$;
revoke all on function private.billing_payment_attempts_sync_order_scope() from public,anon,authenticated;

alter table public.billing_payment_attempts add constraint billing_attempt_bound_scope_required
 check(provider_order_id is null or (provider_account_ref is not null and provider_environment is not null));

-- A scoped unique index preserves independently allocated IDs in different
-- merchant/environment scopes. NULL scope must not evade its arbiter.
create or replace function private.billing_provider_event_binding_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare a public.billing_payment_attempts%rowtype;o public.billing_orders%rowtype;
begin
 -- Privileged only to acquire the parent-company lock. Do not grant company
 -- UPDATE to the application service role. Browser roles cannot insert events.
 if current_setting('role',true) not in ('service_role','none') then
  raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';
 end if;
 select * into a from public.billing_payment_attempts where id=new.payment_attempt_id;
 select * into o from public.billing_orders where id=a.order_id;
 if a.id is null or o.id is null or new.company_id is distinct from a.company_id or a.company_id is distinct from o.company_id
  or new.provider is distinct from o.provider or new.provider_account_ref is distinct from o.provider_account_ref
  or new.provider_environment is distinct from o.provider_environment
  or new.amount_baisa_expected is distinct from o.amount_baisa or new.currency_expected is distinct from o.currency
 then raise exception 'EVENT_PROVIDER_SCOPE_MISMATCH' using errcode='23514';end if;
 -- Serialize receipt insertion with settlement/reversal: company first, then
 -- subscription, order, attempt. No unsigned callback field selects a tenant.
 perform 1 from public.companies where id=o.company_id for update;
 perform 1 from public.billing_subscriptions where company_id=o.company_id and environment=o.provider_environment for update;
 perform 1 from public.billing_orders where id=o.id and company_id=o.company_id for update;
 perform 1 from public.billing_payment_attempts where id=a.id and company_id=o.company_id for update;
 return new;
end;$$;
revoke all on function private.billing_provider_event_binding_guard() from public,anon,authenticated;
create trigger billing_provider_event_binding_guard before insert on public.billing_provider_events
 for each row execute function private.billing_provider_event_binding_guard();

create function private.billing_order_deadline_identity_guard()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.expires_at is distinct from old.expires_at or new.product_code is distinct from old.product_code
  or new.purchase_purpose is distinct from old.purchase_purpose then
  raise exception 'LOCKED_ORDER_IDENTITY_IMMUTABLE' using errcode='23514';
 end if;
 -- This field is added by the next forward migration. No automatic approval
 -- exists; approval cannot be changed after a provider attempt is bound.
 if new.deadline_policy_approved is distinct from old.deadline_policy_approved
  and (old.status<>'locked' or exists(select 1 from public.billing_payment_attempts
   where order_id=old.id and (provider_order_id is not null or status in ('provider_submitted','unresolved','paid')))) then
  raise exception 'DEADLINE_APPROVAL_ALREADY_BOUND' using errcode='23514';
 end if;
 return new;
end;$$;
revoke all on function private.billing_order_deadline_identity_guard() from public,anon,authenticated;
create trigger billing_order_deadline_identity_guard before update on public.billing_orders
 for each row execute function private.billing_order_deadline_identity_guard();

commit;
