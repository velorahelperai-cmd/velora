-- ES02 hosted-compat C6 — broker table + sequence privilege parity.
-- Root cause: hosted CREATE default privileges grant ALL on tables/sequences to
-- service_role (and often anon/authenticated). Source only REVOKE PUBLIC/anon/auth
-- then GRANT CRUD on six broker tables, leaving service TRUNCATE/REFERENCES/TRIGGER/MAINTAIN.
-- Sequences created without defaults are owner-postgres only; hosted sequence ALL defaults
-- would leak direct nextval/setval/SELECT to runtime roles. No direct runtime sequence grant
-- is authorized (SECURITY DEFINER owner postgres performs nextval).
-- Restores: six tables postgres ALL + service CRUD only; two sequences postgres ALL only.
-- No body/owner/default-privilege/RLS/data changes. No new helper objects.

do $broker_acl_pre$
declare
  rel text;
  kind "char";
  owner_name text;
  serial_seq text;
begin
  foreach rel in array array[
    'public.vel_broker_admission',
    'public.vel_broker_sessions',
    'public.vel_broker_browser_attempts',
    'public.vel_broker_browser_lineages',
    'public.vel_broker_operations',
    'public.vel_broker_auth_intents'
  ]
  loop
    if to_regclass(rel) is null then
      raise exception 'ES02_BROKER_ACL: missing table %', rel;
    end if;
    select c.relkind, pg_get_userbyid(c.relowner)
      into kind, owner_name
    from pg_class c
    where c.oid = to_regclass(rel);
    if kind is distinct from 'r' then
      raise exception 'ES02_BROKER_ACL: % relkind % expected r', rel, kind;
    end if;
    if owner_name is distinct from 'postgres' then
      raise exception 'ES02_BROKER_ACL: % owner % expected postgres', rel, owner_name;
    end if;
  end loop;

  foreach rel in array array[
    'public.vel_broker_auth_intents_ordinal_seq',
    'public.vel_broker_browser_issue_seq'
  ]
  loop
    if to_regclass(rel) is null then
      raise exception 'ES02_BROKER_ACL: missing sequence %', rel;
    end if;
    select c.relkind, pg_get_userbyid(c.relowner)
      into kind, owner_name
    from pg_class c
    where c.oid = to_regclass(rel);
    if kind is distinct from 'S' then
      raise exception 'ES02_BROKER_ACL: % relkind % expected S', rel, kind;
    end if;
    if owner_name is distinct from 'postgres' then
      raise exception 'ES02_BROKER_ACL: % owner % expected postgres', rel, owner_name;
    end if;
  end loop;

  -- Fail closed if bigserial wiring differs from the pinned sequence name (do not guess).
  serial_seq := pg_get_serial_sequence('public.vel_broker_auth_intents', 'ordinal');
  if serial_seq is distinct from 'public.vel_broker_auth_intents_ordinal_seq' then
    raise exception 'ES02_BROKER_ACL: ordinal serial sequence mismatch (got %)', coalesce(serial_seq, '<null>');
  end if;
end;
$broker_acl_pre$;

revoke all on table public.vel_broker_admission from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.vel_broker_admission to service_role;

revoke all on table public.vel_broker_sessions from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.vel_broker_sessions to service_role;

revoke all on table public.vel_broker_browser_attempts from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.vel_broker_browser_attempts to service_role;

revoke all on table public.vel_broker_browser_lineages from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.vel_broker_browser_lineages to service_role;

revoke all on table public.vel_broker_operations from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.vel_broker_operations to service_role;

revoke all on table public.vel_broker_auth_intents from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.vel_broker_auth_intents to service_role;

revoke all on sequence public.vel_broker_auth_intents_ordinal_seq from public, anon, authenticated, service_role;
revoke all on sequence public.vel_broker_browser_issue_seq from public, anon, authenticated, service_role;

do $broker_acl_boundary$
declare
  rel text;
  c oid;
  kind "char";
  owner_name text;
  intended aclitem[];
  actual aclitem[];
  priv text;
  role_name text;
  want boolean;
  have boolean;
  serial_seq text;
begin
  foreach rel in array array[
    'public.vel_broker_admission',
    'public.vel_broker_sessions',
    'public.vel_broker_browser_attempts',
    'public.vel_broker_browser_lineages',
    'public.vel_broker_operations',
    'public.vel_broker_auth_intents'
  ]
  loop
    c := to_regclass(rel);
    if c is null then
      raise exception 'ES02_BROKER_ACL: missing table %', rel;
    end if;
    select pg_class.relkind, pg_get_userbyid(pg_class.relowner)
      into kind, owner_name
    from pg_class
    where pg_class.oid = c;
    if kind is distinct from 'r' then
      raise exception 'ES02_BROKER_ACL: % relkind % expected r', rel, kind;
    end if;
    if owner_name is distinct from 'postgres' then
      raise exception 'ES02_BROKER_ACL: % owner % expected postgres', rel, owner_name;
    end if;

    intended := '{postgres=arwdDxtm/postgres,service_role=arwd/postgres}'::aclitem[];
    select coalesce(pg_class.relacl, acldefault('r', pg_class.relowner))
      into actual
    from pg_class
    where pg_class.oid = c;

    if exists (
      select 1 from (
        select a.grantee, a.grantor, a.privilege_type, a.is_grantable
        from aclexplode(actual) a
        except
        select e.grantee, e.grantor, e.privilege_type, e.is_grantable
        from aclexplode(intended) e
      ) tb_extra
    ) or exists (
      select 1 from (
        select e.grantee, e.grantor, e.privilege_type, e.is_grantable
        from aclexplode(intended) e
        except
        select a.grantee, a.grantor, a.privilege_type, a.is_grantable
        from aclexplode(actual) a
      ) tb_missing
    ) then
      raise exception 'ES02_BROKER_ACL: table % ACL semantic mismatch', rel;
    end if;

    foreach priv in array array[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
    ]
    loop
      foreach role_name in array array['anon','authenticated','service_role']
      loop
        -- Intended PUBLIC/direct only (rejects unexpected inherited authority).
        want := exists (
          select 1 from aclexplode(intended) e
          where e.privilege_type = priv
            and (e.grantee = 0 or e.grantee = (select oid from pg_roles where rolname = role_name))
        );
        have := has_table_privilege(role_name, c, priv);
        if have is distinct from want then
          raise exception 'ES02_BROKER_ACL: table % effective % for % (have=%, want=%)',
            rel, priv, role_name, have, want;
        end if;
      end loop;
    end loop;

    if exists (
      select 1 from aclexplode(actual) a where a.is_grantable
    ) then
      raise exception 'ES02_BROKER_ACL: table % unexpected grant option', rel;
    end if;
  end loop;

  serial_seq := pg_get_serial_sequence('public.vel_broker_auth_intents', 'ordinal');
  if serial_seq is distinct from 'public.vel_broker_auth_intents_ordinal_seq' then
    raise exception 'ES02_BROKER_ACL: ordinal serial sequence mismatch (got %)', coalesce(serial_seq, '<null>');
  end if;

  foreach rel in array array[
    'public.vel_broker_auth_intents_ordinal_seq',
    'public.vel_broker_browser_issue_seq'
  ]
  loop
    c := to_regclass(rel);
    if c is null then
      raise exception 'ES02_BROKER_ACL: missing sequence %', rel;
    end if;
    select pg_class.relkind, pg_get_userbyid(pg_class.relowner)
      into kind, owner_name
    from pg_class
    where pg_class.oid = c;
    if kind is distinct from 'S' then
      raise exception 'ES02_BROKER_ACL: % relkind % expected S', rel, kind;
    end if;
    if owner_name is distinct from 'postgres' then
      raise exception 'ES02_BROKER_ACL: % owner % expected postgres', rel, owner_name;
    end if;

    -- Owner-only: actual coalesce must equal sequence acldefault for owner (no runtime roles).
    -- PG17 acldefault type: lowercase 's' = SEQUENCE (SELECT/UPDATE/USAGE); uppercase 'S' = FOREIGN SERVER (USAGE only).
    -- pg_default_acl.defaclobjtype='S' is a different catalog API and must not be used here.
    select coalesce(pg_class.relacl, acldefault('s', pg_class.relowner)),
           acldefault('s', pg_class.relowner)
      into actual, intended
    from pg_class
    where pg_class.oid = c;

    if exists (
      select 1 from (
        select a.grantee, a.grantor, a.privilege_type, a.is_grantable
        from aclexplode(actual) a
        except
        select e.grantee, e.grantor, e.privilege_type, e.is_grantable
        from aclexplode(intended) e
      ) seq_extra
    ) or exists (
      select 1 from (
        select e.grantee, e.grantor, e.privilege_type, e.is_grantable
        from aclexplode(intended) e
        except
        select a.grantee, a.grantor, a.privilege_type, a.is_grantable
        from aclexplode(actual) a
      ) seq_missing
    ) then
      raise exception 'ES02_BROKER_ACL: sequence % ACL semantic mismatch', rel;
    end if;

    foreach priv in array array['USAGE','SELECT','UPDATE']
    loop
      foreach role_name in array array['anon','authenticated','service_role']
      loop
        want := exists (
          select 1 from aclexplode(intended) e
          where e.privilege_type = priv
            and (e.grantee = 0 or e.grantee = (select oid from pg_roles where rolname = role_name))
        );
        have := has_sequence_privilege(role_name, c, priv);
        if have is distinct from want then
          raise exception 'ES02_BROKER_ACL: sequence % effective % for % (have=%, want=%)',
            rel, priv, role_name, have, want;
        end if;
      end loop;
    end loop;

    if exists (
      select 1 from aclexplode(actual) a where a.is_grantable
    ) then
      raise exception 'ES02_BROKER_ACL: sequence % unexpected grant option', rel;
    end if;
  end loop;
end;
$broker_acl_boundary$;
