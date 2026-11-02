-- Read-only owner projection; authorization is inherited from the established
-- company/session evidence reader, and does not activate a service or payment.
begin;
create function public.es02_read_owner_reply_balance(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare authorized jsonb; foundation private.es02_activation_foundation; total bigint; remaining bigint; held bigint; n integer;
begin
 if current_setting('role',true) is distinct from 'authenticated' then return jsonb_build_object('ok',false,'code','forbidden');end if;
 authorized:=public.billing_read_company_display_evidence(p_company_id);
 if authorized->>'ok' is distinct from 'true' or authorized->'data'->>'company_id' is distinct from p_company_id::text then return jsonb_build_object('ok',false,'code','forbidden');end if;
 select f.* into foundation from private.es02_activation_foundation f
 join private.es02_account_orders o on o.id=f.order_id and o.provisioned_company_id=f.company_id and o.original_order_group_id=f.order_group_id
 join public.billing_subscriptions s on s.id=f.ai_cost_subscription_id and s.company_id=f.company_id
 where f.company_id=p_company_id and f.clock_state='active' and f.paid_through_at>statement_timestamp()
 and o.status='provisioned' and o.environment='live' and o.settled_at is not null
 and s.environment='live' and s.plan_version_id is null and s.status in ('active','cancel_at_period_end') and s.paid_through=f.paid_through_at;
 if not found then return jsonb_build_object('ok',false,'code','unavailable');end if;
 select count(*) filter(where b.kind='base'),sum(b.granted),sum(b.remaining),
  sum((select count(*) from private.es02_reply_credit_holds h where h.balance_id=b.id and h.company_id=p_company_id and h.state in ('held','unknown')))
 into n,total,remaining,held from private.es02_credit_balances b
 where b.company_id=p_company_id and (b.kind='purchased' or (b.kind='base' and b.order_group_id=foundation.order_group_id
 and (b.ordinary_expiry is null or b.ordinary_expiry>statement_timestamp())));
 if n<>1 or total is null or remaining is null or held is null or total<0 or remaining<0 or remaining>total or held>remaining
  or total>2147483647 or remaining>2147483647 or held>2147483647 then return jsonb_build_object('ok',false,'code','unavailable');end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('company_id',p_company_id,'granted',total,'remaining',remaining,'held',held,'paid_through',foundation.paid_through_at));
end;$$;
revoke all on function public.es02_read_owner_reply_balance(uuid) from public,anon,service_role;
grant execute on function public.es02_read_owner_reply_balance(uuid) to authenticated;
commit;
