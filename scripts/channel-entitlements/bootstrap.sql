-- Dependency doubles in the network-isolated disposable Postgres fixture ONLY.
create table public.billing_plan_versions(id uuid primary key);
create table public.billing_subscriptions(id uuid primary key,company_id uuid,environment text,plan_version_id uuid,paid_through timestamptz);
create table private.billing_proven_entitlement_grants(id uuid primary key,company_id uuid,subscription_id uuid,provider_environment text,applied_paid_through timestamptz,applied_at timestamptz default clock_timestamp());
-- Same qualified receipt predicate as the lifecycle candidate. The financial
-- proof table here is a labelled dependency double, not payment verification.
create function private.billing_lifecycle_receipt(cid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('receiptId',g.id,'subscriptionId',s.id,'expiredAt',g.applied_paid_through)
 from public.billing_subscriptions s join private.billing_proven_entitlement_grants g on g.subscription_id=s.id and g.company_id=s.company_id
 where s.company_id=cid and s.environment='live' and g.provider_environment='live'
 and isfinite(s.paid_through) and s.paid_through=g.applied_paid_through
 order by g.applied_paid_through desc,g.applied_at desc,g.id desc limit 1
$$;
