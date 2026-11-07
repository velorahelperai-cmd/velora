-- Manual WhatsApp claim+reply travel with read access (same billing fence as read).
-- Paid send proof remains for other write caps and for automation that calls billing_chat_send.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $patch$
declare
  source text;
  patched text;
  needle_send text := $n$p_capability='wa.conversations.read' or private.billing_chat_send(p_company_id)$n$;
  repl_send text := $n$p_capability in ('wa.conversations.read','wa.conversations.reply','wa.conversations.take_over') or private.billing_chat_send(p_company_id)$n$;
  needle_es02 text := $n$p_capability='wa.conversations.read' and exists($n$;
  repl_es02 text := $n$p_capability in ('wa.conversations.read','wa.conversations.reply','wa.conversations.take_over') and exists($n$;
  target regprocedure;
  patched_count int := 0;
begin
  foreach target in array array[
    to_regprocedure('public.has_company_capability(uuid,text)'),
    to_regprocedure('private.master_archive_native_has_capability(uuid,text)'),
    to_regprocedure('private.master_files_native_has_capability(uuid,text)'),
    to_regprocedure('public.lifecycle_native_has_company_capability(uuid,text)'),
    to_regprocedure('private.user_has_company_capability(uuid,uuid,text)'),
    to_regprocedure('private.master_archive_native_user_capability(uuid,uuid,text)'),
    to_regprocedure('private.master_files_native_user_capability(uuid,uuid,text)'),
    to_regprocedure('private.lifecycle_native_company_capability(uuid,uuid,text)')
  ]
  loop
    if target is null then
      continue;
    end if;
    select pg_get_functiondef(target) into source;
    if position(needle_send in source) = 0 then
      continue;
    end if;
    patched := replace(source, needle_send, repl_send);
    if position(needle_es02 in patched) > 0 then
      patched := replace(patched, needle_es02, repl_es02);
    end if;
    if patched = source then
      raise exception 'OWNER_MANUAL_REPLY_NO_CHANGE %', target;
    end if;
    execute patched;
    patched_count := patched_count + 1;
  end loop;
  if patched_count < 1 then
    raise exception 'OWNER_MANUAL_REPLY_SEND_FENCE_NOT_FOUND';
  end if;
end;
$patch$;

commit;
