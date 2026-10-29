-- Read-only inventory of checkout preparation. No payloads or identifiers are returned.
-- This is not a cleanup authorization: all categories mean retain.
with checkout as (
 select 'thawani_live' as source, c.order_id, c.account_id, c.state, c.paid_at, c.invoice,
        c.collected_baisa as expected_amount, 'live' as expected_environment,
        'thawani_api_verified_live' as marker, 'thawani-live:' || c.invoice as transaction_id
 from private.es02_thawani_live_checkouts c
 union all
 select 'thawani_test', c.order_id, c.account_id, c.state, c.paid_at, c.invoice,
        o.amount_baisa, 'test', 'thawani_api_verified_uat', 'thawani-uat:' || c.invoice
 from private.es02_thawani_test_checkouts c left join private.es02_account_orders o on o.id=c.order_id and o.account_id=c.account_id
 union all
 select 'legacy_test', c.order_id, c.account_id, c.state, c.paid_at, null::text,
        null::integer, 'test', null::text, null::text
 from private.es02_test_checkouts c
), classified as (
 select source,
 case
  when o.id is null or o.environment is distinct from expected_environment or source='legacy_test' then 'hold_unknown'
  when state in ('prepared','claimed','ready') and paid_at is null and o.provisioned_company_id is null
   and o.status in ('open','collection_pending') and not exists(select 1 from private.es02_account_settlement_events e where e.order_id=checkout.order_id and e.account_id=checkout.account_id and e.outcome='applied') then 'hold_unpaid'
  when state='paid' and paid_at is not null and invoice is not null and exists(
   select 1 from private.es02_account_settlement_events e where e.order_id=checkout.order_id and e.account_id=checkout.account_id
    and e.evidence_marker=checkout.marker and e.provider_transaction_id=checkout.transaction_id
    and e.amount_baisa=checkout.expected_amount and e.currency='OMR' and e.outcome='applied'
  ) then case
   when o.provisioned_company_id is null and o.status in ('settled','provisioning') then 'hold_paid_unprovisioned'
   when o.provisioned_company_id is not null and o.status='provisioned' then 'hold_provisioned_obligations_unknown'
   else 'hold_unknown' end
  else 'hold_unknown'
 end as decision
 from checkout left join private.es02_account_orders o on o.id=checkout.order_id and o.account_id=checkout.account_id
)
select source, decision, count(*)::integer as count from classified group by source,decision order by source,decision;
