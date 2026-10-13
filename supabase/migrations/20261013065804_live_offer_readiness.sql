-- Read-only projection of the installed Live checkout contract. No binding or activation.
create function public.billing_read_public_live_offer(p_plan_version_id uuid,p_integration_id bigint,p_merchant_owner_id text,p_units_per_omr integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 select jsonb_build_object('ok',true,'data',jsonb_build_object('version_id',v.id,'plan_id',v.plan_id,
  'amount_baisa',v.amount_baisa,'allowance_cap',case when coalesce(v.limits->>'automated_outbound_per_month','') ~ '^[1-9][0-9]{0,8}$' then (v.limits->>'automated_outbound_per_month')::bigint end,
  'tier',f.tier,'catalog_revision',r.revision)) into result
 from public.billing_plan_versions v
 join public.billing_plans p on p.id=v.plan_id
 join private.billing_service_offers f on f.plan_version_id=v.id
 join private.ai_plan_budget_policies b on b.plan_version_id=v.id
 cross join public.billing_catalog_revision r
 where v.id=p_plan_version_id and v.status='published' and p.status='active'
 and p.code='noor_'||f.tier and v.currency='OMR' and v.amount_baisa>0 and v.amount_baisa<=9007199254740991
 and v.period_unit='month' and v.period_count=1 and r.singleton and r.revision>0
 and f.service_code='noura' and f.tier in ('basic','premium') and f.capabilities=array['noura.knowledge.read']::text[]
 and coalesce(v.limits->>'automated_outbound_per_month','') ~ '^[1-9][0-9]{0,8}$'
 and b.monthly_limit_baisa>0 and b.monthly_limit_baisa=trunc(b.monthly_limit_baisa) and b.monthly_limit_baisa<=9007199254740991
 and exists(select 1 from private.billing_live_merchant_contracts c where c.integration_id=p_integration_id
  and c.merchant_owner_id=p_merchant_owner_id and c.units_per_omr=p_units_per_omr and c.currency=v.currency
  and c.deadline_policy_approved and c.verified_at<=now());
 return coalesce(result,jsonb_build_object('ok',false,'code','LIVE_OFFER_NOT_READY'));
end;$$;
revoke all on function public.billing_read_public_live_offer(uuid,bigint,text,integer) from public,anon,authenticated;
grant execute on function public.billing_read_public_live_offer(uuid,bigint,text,integer) to service_role;
