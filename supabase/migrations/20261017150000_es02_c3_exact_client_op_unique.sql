-- ES02-C3: exact unique(account_id, client_op_id) footprint via catalog key attributes.
-- Replaces regex "contains both names" guards that accepted weaker unique(..., id).
-- Does not edit 20261017120000 / 20261017130000 / 20261017140000 predecessors.
-- No financial data deletion; restore exact constraint when compatible or reject atomically.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Exact two-column unique (non-partial, non-expression): account_id + client_op_id only.
create or replace function private.es02_has_exact_client_op_unique()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'private'
      and t.relname = 'es02_account_orders'
      and c.contype = 'u'
      and cardinality(c.conkey) = 2
      and (
        select array_agg(a.attname::text order by u.ord)
        from unnest(c.conkey) with ordinality as u(attnum, ord)
        join pg_attribute a
          on a.attrelid = c.conrelid
         and a.attnum = u.attnum
         and not a.attisdropped
      ) = array['account_id', 'client_op_id']::text[]
  )
  or exists (
    select 1
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'private'
      and t.relname = 'es02_account_orders'
      and i.indisunique
      and not i.indisprimary
      and i.indisvalid
      and i.indisready
      and i.indislive
      and i.indpred is null
      and i.indnkeyatts = 2
      and i.indnatts = 2
      and not (0 = any (i.indkey::int2[]))
      and (
        select array_agg(a.attname::text order by u.ord)
        from unnest(i.indkey::int2[]) with ordinality as u(attnum, ord)
        join pg_attribute a
          on a.attrelid = i.indrelid
         and a.attnum = u.attnum
         and not a.attisdropped
      ) = array['account_id', 'client_op_id']::text[]
  );
$$;

revoke all on function private.es02_has_exact_client_op_unique() from public, anon, authenticated;

-- Shared authority footprint: broker tables + exact operation-key unique (not substring match).
create or replace function private.es02_authority_footprint_ok()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if to_regclass('public.vel_broker_sessions') is null
     or to_regclass('public.vel_broker_browser_lineages') is null then
    return false;
  end if;
  if not private.es02_has_exact_client_op_unique() then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function private.es02_authority_footprint_ok() from public, anon, authenticated;

-- Safely restore exact unique when missing; reject if incompatible (no row deletion).
do $$
begin
  if not private.es02_has_exact_client_op_unique() then
    begin
      alter table private.es02_account_orders
        add constraint es02_account_orders_account_id_client_op_id_key
        unique (account_id, client_op_id);
    exception when others then
      raise exception 'ES02_C3_FOOTPRINT: exact unique(account_id,client_op_id) missing and cannot restore';
    end;
  end if;
  if not private.es02_has_exact_client_op_unique() then
    raise exception 'ES02_C3_FOOTPRINT: exact unique(account_id,client_op_id) missing after restore';
  end if;
end;
$$;

-- Signature drift guard: resolve by typed OID (not named-argument text equality).
-- Healthy catalog reports named identity args; to_regprocedure(uuid,uuid,text,jsonb,boolean) matches.
do $$
declare
  proc oid := to_regprocedure('public.es02_create_account_order(uuid,uuid,text,jsonb,boolean)');
  ret text;
  owner_name text;
  is_definer boolean;
  cfg text[];
begin
  if proc is null then
    raise exception 'ES02_C3_FOOTPRINT: es02_create_account_order signature drift';
  end if;
  select pg_get_function_result(p.oid),
         pg_get_userbyid(p.proowner),
         p.prosecdef,
         coalesce(p.proconfig, '{}'::text[])
    into ret, owner_name, is_definer, cfg
  from pg_proc p
  where p.oid = proc;
  if ret is distinct from 'jsonb'
     or owner_name is distinct from 'postgres'
     or is_definer is not true
     or not ('search_path=""' = any (cfg))
     or has_function_privilege('anon', proc, 'EXECUTE')
     or has_function_privilege('service_role', proc, 'EXECUTE')
     or not has_function_privilege('authenticated', proc, 'EXECUTE')
  then
    raise exception 'ES02_C3_FOOTPRINT: es02_create_account_order signature drift';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
