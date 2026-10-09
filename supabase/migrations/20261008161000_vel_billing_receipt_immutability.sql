-- Forward-only C1 correction. Created by Supabase CLI, ordered after the
-- reviewed future-dated billing acceptance chain. No financial data is changed.
begin;

-- Server attestation authenticates the receipt at insertion. Later edits must
-- not turn an authorization/capture into a collection or remove refund proof.
-- Outcomes retain their existing replay-detail update. Grants retain the
-- existing active -> revoked lifecycle; restoration needs a future reviewed
-- reconciliation path, not a rewrite of the original financial receipt.
create function private.billing_financial_receipt_immutability()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op in ('DELETE','TRUNCATE') then
  raise exception 'BILLING_FINANCIAL_RECEIPT_APPEND_ONLY: % cannot be removed',tg_table_name
   using errcode='23514';
 end if;
 if tg_table_name='billing_provider_events' then
  if to_jsonb(new) is distinct from to_jsonb(old) then
   raise exception 'BILLING_PROVIDER_RECEIPT_IMMUTABLE' using errcode='23514';
  end if;
 elsif tg_table_name='billing_entitlement_applications' then
  if (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status')
   or (new.status is distinct from old.status and not (old.status='active' and new.status='revoked')) then
   raise exception 'BILLING_ENTITLEMENT_RECEIPT_IMMUTABLE' using errcode='23514';
  end if;
 elsif tg_table_name='billing_settlement_outcomes' then
  if (to_jsonb(new)-'detail') is distinct from (to_jsonb(old)-'detail') then
   raise exception 'BILLING_SETTLEMENT_RECEIPT_IMMUTABLE' using errcode='23514';
  end if;
 else
  raise exception 'BILLING_FINANCIAL_RECEIPT_TABLE_UNEXPECTED' using errcode='23514';
 end if;
 return new;
end; $$;
revoke all on function private.billing_financial_receipt_immutability() from public,anon,authenticated,service_role;

create trigger billing_provider_receipt_immutability before update or delete on public.billing_provider_events
 for each row execute function private.billing_financial_receipt_immutability();
create trigger billing_entitlement_receipt_immutability before update or delete on public.billing_entitlement_applications
 for each row execute function private.billing_financial_receipt_immutability();
create trigger billing_settlement_receipt_immutability before update or delete on public.billing_settlement_outcomes
 for each row execute function private.billing_financial_receipt_immutability();

-- TRUNCATE has no row triggers. Protect privileged maintenance mistakes as well
-- as the service-role grants inherited from the earlier UI adapter migration.
create trigger billing_provider_receipt_no_truncate before truncate on public.billing_provider_events
 for each statement execute function private.billing_financial_receipt_immutability();
create trigger billing_entitlement_receipt_no_truncate before truncate on public.billing_entitlement_applications
 for each statement execute function private.billing_financial_receipt_immutability();
create trigger billing_settlement_receipt_no_truncate before truncate on public.billing_settlement_outcomes
 for each statement execute function private.billing_financial_receipt_immutability();

revoke update,delete,truncate on public.billing_provider_events from service_role;
revoke update,delete,truncate on public.billing_entitlement_applications from service_role;
grant update(status) on public.billing_entitlement_applications to service_role;
revoke update,delete,truncate on public.billing_settlement_outcomes from service_role;
grant update(detail) on public.billing_settlement_outcomes to service_role;

commit;
