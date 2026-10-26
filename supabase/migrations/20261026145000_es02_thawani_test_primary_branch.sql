-- Restore primary-branch creation only for a verified, allowlisted Thawani Test order.
-- Preserve the existing provisioning function, privileges, contacts and Live behavior.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $repair$
declare
  target regprocedure := 'public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure;
  definition text;
  before_acl aclitem[];
  missing text := $old$  if primary_branch.id is null then
    raise exception 'ES02_PRIMARY_BRANCH_MISSING' using errcode = 'P0001';
  end if;$old$;
  replacement text := $new$  if primary_branch.id is null and o.environment = 'test'
     and exists (
       select 1 from private.es02_thawani_test_checkouts tc
       join private.es02_thawani_test_accounts ta on ta.account_id = tc.account_id and ta.enabled
       where tc.order_id = o.id and tc.account_id = actor
         and tc.state = 'paid' and tc.paid_at is not null and tc.invoice is not null
     ) then
    insert into public.company_branches(company_id, name, city, is_primary, status)
    values (created.id, btrim(p_branches->0->>'name'), btrim(p_branches->0->>'city'), true, 'setup')
    returning * into primary_branch;
  end if;
  if primary_branch.id is null then
    raise exception 'ES02_PRIMARY_BRANCH_MISSING' using errcode = 'P0001';
  end if;$new$;
begin
  if (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = target)
     is distinct from '54e16ce2cd2b5c3144511ecdaba5f6ec' then
    raise exception 'ES02_THAWANI_PRIMARY_BASELINE_DRIFT';
  end if;
  select proacl into before_acl from pg_proc where oid = target;
  definition := replace(pg_get_functiondef(target), chr(13), '');
  if length(definition) - length(replace(definition, missing, '')) <> length(missing) then
    raise exception 'ES02_THAWANI_PRIMARY_PATCH_AMBIGUOUS';
  end if;
  execute replace(definition, missing, replacement);
  if (select proacl from pg_proc where oid = target) is distinct from before_acl then
    raise exception 'ES02_THAWANI_PRIMARY_ACL_DRIFT';
  end if;
end $repair$;
commit;
