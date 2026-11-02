-- Keep live ES02 WhatsApp ingress available after the first reply starts its
-- subscription clock. This authorizes incoming storage only; paid answer,
-- number confirmation, source freshness, cost and send gates remain separate.
begin;
create function private.es02_active_whatsapp_ingress(p_company uuid,p_phone text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare a private.es02_activation_foundation;o private.es02_account_orders;s public.billing_subscriptions;branch uuid;binding jsonb;
begin
 select * into a from private.es02_activation_foundation where company_id=p_company;
 if a.company_id is null or a.clock_state<>'active' or a.paid_through_at is null or a.paid_through_at<=statement_timestamp() then return false;end if;
 select * into o from private.es02_account_orders where id=a.order_id;
 if o.id is null or o.provisioned_company_id is distinct from p_company or o.account_id is distinct from a.account_id
  or o.original_order_group_id is distinct from a.order_group_id or o.status is distinct from 'provisioned'
  or o.environment is distinct from 'live' or (o.settlement_authority is distinct from 'paymob_hmac' and not coalesce(private.es02_verified_live_catalog_order(o),false))
  or o.settled_at is null or nullif(btrim(o.provider_transaction_id),'') is null
  or not exists(select 1 from private.es02_account_settlement_events e where e.order_id=o.id and e.account_id=o.account_id
   and e.provider_transaction_id=o.provider_transaction_id and e.outcome='applied'
   and (e.amount_baisa=o.amount_baisa or (coalesce(private.es02_verified_live_catalog_order(o),false) and e.evidence_marker='thawani_api_verified_live' and e.amount_baisa=100)) and e.currency=o.currency)
  or not exists(select 1 from auth.users u where u.id=a.account_id and u.email_confirmed_at is not null and u.deleted_at is null)
  or not exists(select 1 from public.companies where id=p_company and status='active') then return false;end if;
 select * into s from public.billing_subscriptions where company_id=p_company and environment='live';
 if s.id is null or s.plan_version_id is not null or s.status not in ('active','cancel_at_period_end') or s.status is null
  or s.paid_through is distinct from a.paid_through_at then return false;end if;
 branch:=private.whatsapp_resolve_conversation_branch(p_company,p_phone,statement_timestamp());
 if branch is null or not exists(select 1 from public.company_branches where id=branch and company_id=p_company and status='active')
  or not exists(select 1 from private.es02_branch_slot_rights where company_id=p_company and branch_id=branch and order_id=a.order_id)
  or not exists(select 1 from private.es02_branch_channel_selections where company_id=p_company and branch_id=branch and account_id=a.account_id and channels ? 'whatsapp') then return false;end if;
 binding:=private.es02_b3_current_binding(a.account_id,p_company,branch,'whatsapp');
 if binding->>'ok' is distinct from 'true' or not exists(select 1 from private.es02_b3_connection_links l
  join private.es02_b3_connection_attempts t on t.id=l.attempt_id where l.company_id=p_company and l.branch_id=branch
  and l.channel='whatsapp' and l.status='active' and l.revoked_at is null and l.verified and t.status='bound'
  and private.es02_b3_pin_matches(t,binding)) then return false;end if;
 return true;
exception when lock_not_available or deadlock_detected then return false;
end;$$;
revoke all on function private.es02_active_whatsapp_ingress(uuid,text) from public,anon,authenticated,service_role;
do $patch$
declare body text;old_expr text:=$old$if not private.billing_chat_access((gate->>'company_id')::uuid,'whatsapp') then$old$;
new_expr text:=$new$if not private.billing_chat_access((gate->>'company_id')::uuid,'whatsapp') and not private.es02_active_whatsapp_ingress((gate->>'company_id')::uuid,p_phone_number_id) then$new$;
begin
 select pg_get_functiondef('private.whatsapp_meta_asset_binding(text,text)'::regprocedure) into body;
 if (length(body)-length(replace(body,old_expr,'')))/length(old_expr)<>1 then raise exception 'ES02_INGRESS_SOURCE_DRIFT';end if;
 execute replace(body,old_expr,new_expr);
end;$patch$;
commit;
