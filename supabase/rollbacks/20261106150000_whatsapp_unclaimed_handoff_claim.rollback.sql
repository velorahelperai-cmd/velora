-- Restores the previous open-and-automation claim predicate and frame loader.
-- Does not delete conversations, messages, jobs, or events.

drop function if exists public.billing_load_worker_frame(uuid, uuid);
alter function private.continuity_pre_load_worker_frame(uuid, uuid) rename to billing_load_worker_frame;
alter function private.billing_load_worker_frame(uuid, uuid) set schema public;
revoke all on function public.billing_load_worker_frame(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.billing_load_worker_frame(uuid, uuid) to service_role;

do $patch$
declare
  fn record;
  body text;
  occurrences integer;
  target oid;
  item record;
begin
  -- Longer replacements first so "not claimable(c)" is restored before the bare call.
  -- Walk only ordinary functions; pg_get_functiondef() rejects aggregates (42809).
  for item in select * from (values
    ('not private.whatsapp_continuity_ai_claimable(c)', 'c.status<>''open'' or not c.automation_allowed'),
    ('not private.whatsapp_continuity_ai_claimable(v_conv)', 'v_conv.automation_allowed is not true'),
    ('private.whatsapp_continuity_ai_claimable(c)', 'c.status=''open'' and c.automation_allowed')
  ) as replacements(old_expr, new_expr) loop
    for target in
      select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
        and p.prokind = 'f'
    loop
      body := pg_get_functiondef(target);
      if position(item.old_expr in body) = 0 then
        continue;
      end if;
      select n.nspname, p.proname into fn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.oid = target;
      occurrences := (length(body) - length(replace(body, item.old_expr, ''))) / length(item.old_expr);
      if occurrences <> 1 then
        raise exception 'WA_CONTINUITY_CLAIM_ROLLBACK_DRIFT %.% count %', fn.nspname, fn.proname, occurrences;
      end if;
      execute replace(body, item.old_expr, item.new_expr);
    end loop;
  end loop;
end
$patch$;

drop function if exists private.whatsapp_continuity_ai_claimable(public.whatsapp_conversations);
