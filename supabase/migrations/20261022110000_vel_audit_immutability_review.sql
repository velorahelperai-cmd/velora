-- Forward-only Review Migration for Admin Audit Logs Immutability.
-- Strictly enforces database-level Append-Only behavior (no updates, no deletes, no truncations).
-- Created for review and isolated testing; not applied to Production without explicit approval.

begin;

create or replace function private.admin_audit_logs_immutability()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'ADMIN_AUDIT_LOG_APPEND_ONLY: audit records cannot be deleted or truncated' using errcode='23514';
  elsif tg_op = 'UPDATE' then
    raise exception 'ADMIN_AUDIT_LOG_IMMUTABLE: audit records cannot be modified' using errcode='23514';
  end if;
  return new;
end; $$;

revoke all on function private.admin_audit_logs_immutability() from public, anon, authenticated, service_role;

drop trigger if exists admin_audit_logs_immutable on public.admin_audit_logs;
create trigger admin_audit_logs_immutable before update or delete on public.admin_audit_logs
  for each row execute function private.admin_audit_logs_immutability();

drop trigger if exists admin_audit_logs_no_truncate on public.admin_audit_logs;
create trigger admin_audit_logs_no_truncate before truncate on public.admin_audit_logs
  for each statement execute function private.admin_audit_logs_immutability();

commit;
