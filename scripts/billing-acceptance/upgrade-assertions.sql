-- Run after historical P1 + forward correction on a database with old rows.
do $$
declare v jsonb; original_grants bigint; final_grants bigint;
begin
 if not exists(select 1 from public.billing_subscriptions where id=md5('acceptance-upgrade-sub-test')::uuid
  and environment='test' and status='active') then raise exception 'Test legacy row was not classified test';end if;
 if not exists(select 1 from public.billing_subscriptions where id=md5('acceptance-upgrade-sub-live')::uuid
  and environment='live' and status='active') then raise exception 'Documented live legacy row lost trusted entitlement';end if;
 if (select count(*) from public.billing_subscriptions where id in (
  md5('acceptance-upgrade-sub-unknown')::uuid,md5('acceptance-upgrade-sub-incomplete')::uuid,
  md5('acceptance-upgrade-sub-mixed')::uuid,md5('acceptance-upgrade-sub-reversed')::uuid,
  md5('acceptance-upgrade-sub-revoked_unverified_with_newer_live')::uuid,
  md5('acceptance-upgrade-sub-snapshot_mismatch')::uuid,
  md5('acceptance-upgrade-sub-unattested_live')::uuid,md5('acceptance-upgrade-sub-missing_owner_live')::uuid,
  md5('acceptance-upgrade-sub-unsupported_marker_live')::uuid,
  md5('acceptance-upgrade-sub-malformed_owner_live')::uuid)
  and environment='quarantined' and status='review_required')<>10 then
  raise exception 'Unknown, incomplete, mixed, reversed or mismatched snapshot history was not quarantined';end if;
 select sum(cardinality(grant_ids)) into original_grants from public.billing_subscription_upgrade_reviews
  where subscription_id in (select id from public.billing_subscriptions where company_id in (
   select id from public.companies where display_name like 'Upgrade %'));
 select count(*) into final_grants from public.billing_entitlement_applications g join public.companies c on c.id=g.company_id
  where c.display_name like 'Upgrade %';
 if original_grants<>final_grants or final_grants<>23 then raise exception 'Financial history changed during upgrade';end if;
 if (select count(*) from public.billing_subscription_upgrade_reviews where reason='no_collection_evidence')<>1 then
  raise exception 'Missing unknown-history review reason';end if;
 perform set_config('request.jwt.claim.role','service_role',true);
 v:=public.billing_read_company_operational_entitlement(md5('acceptance-upgrade-company-test')::uuid);
 if coalesce((v->>'active')::boolean,true) then raise exception 'Test row grants live service';end if;
 v:=public.billing_read_company_operational_entitlement(md5('acceptance-upgrade-company-live')::uuid);
 if (v->>'active')::boolean is distinct from true then raise exception 'Trusted live row denied service';end if;
 v:=public.billing_read_company_operational_entitlement(md5('acceptance-upgrade-company-unknown')::uuid);
 if coalesce((v->>'active')::boolean,true) then raise exception 'Unknown row grants live service';end if;
 v:=public.billing_read_company_operational_entitlement(md5('acceptance-upgrade-company-reversed_with_newer_live')::uuid);
 if (v->>'active')::boolean is distinct from true then raise exception 'Old reversal removed a newer valid paid entitlement';end if;
 v:=public.billing_read_company_operational_entitlement(md5('acceptance-upgrade-company-actual_reversed_with_newer_live')::uuid);
 if (v->>'active')::boolean is distinct from true then raise exception 'ACTUAL historical reversal removed newer valid paid entitlement';end if;
 if not exists(select 1 from public.billing_entitlement_applications where
  id=md5('acceptance-upgrade-grant-actual_reversed_with_newer_livelive')::uuid and status='revoked') then
  raise exception 'Historical old collection revocation was lost';end if;
 v:=public.billing_read_company_operational_entitlement(md5('acceptance-upgrade-company-manual_suspended_live')::uuid);
 if coalesce((v->>'active')::boolean,true) then raise exception 'Unattributed manual suspension was lifted';end if;
 v:=public.billing_read_company_operational_entitlement(md5('acceptance-upgrade-company-past_due_live')::uuid);
 if coalesce((v->>'active')::boolean,true) then raise exception 'Past-due subscription was activated';end if;
 v:=public.billing_read_company_operational_entitlement(md5('acceptance-upgrade-company-security_suspended_actual_reversal')::uuid);
 if coalesce((v->>'active')::boolean,true) then raise exception 'Company security suspension was lifted';end if;
 v:=public.billing_read_company_operational_entitlement(md5('acceptance-upgrade-company-company_only_suspended_live')::uuid);
 if coalesce((v->>'active')::boolean,true) then raise exception 'Suspended company with active paid subscription grants service';end if;
 v:=public.billing_read_company_operational_entitlement(md5('acceptance-upgrade-company-unattested_live')::uuid);
 if coalesce((v->>'active')::boolean,true) then raise exception 'Old wrapper outcome label was treated as HMAC attestation';end if;
 v:=public.billing_read_company_operational_entitlement(md5('acceptance-upgrade-company-missing_owner_live')::uuid);
 if coalesce((v->>'active')::boolean,true) then raise exception 'Missing signed merchant owner was treated as trusted receipt';end if;
 v:=public.billing_read_company_operational_entitlement(md5('acceptance-upgrade-company-unsupported_marker_live')::uuid);
 if coalesce((v->>'active')::boolean,true) then raise exception 'Unsupported adapter marker was treated as trusted receipt';end if;
 v:=public.billing_read_company_operational_entitlement(md5('acceptance-upgrade-company-malformed_owner_live')::uuid);
 if coalesce((v->>'active')::boolean,true) then raise exception 'Malformed owner either aborted upgrade or granted service';end if;
 perform set_config('request.jwt.claim.role','authenticated',true);
 v:=public.billing_read_company_operational_entitlement(md5('acceptance-upgrade-company-live')::uuid);
 if v->>'code' is distinct from 'forbidden' then raise exception 'Unauthorized caller can read another tenant entitlement';end if;
end;$$;
