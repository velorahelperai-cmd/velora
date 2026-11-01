-- Local candidate. Prevent loss of unresolved WhatsApp signup authorization evidence.
-- Rollback: DROP TRIGGER wa_unresolved_checkpoint_vault_guard ON vault.secrets;
--           DROP TRIGGER wa_checkpoint_secret_reference_guard ON private.es02_b3_whatsapp_signup_checkpoints;
--           DROP FUNCTION private.wa_checkpoint_secret_reference_guard();
--           DROP TRIGGER wa_unresolved_checkpoint_evidence_guard ON private.es02_b3_whatsapp_signup_checkpoints;
--           DROP FUNCTION private.wa_unresolved_checkpoint_evidence_guard();
--           DROP FUNCTION public.wa_expired_checkpoint_review(jsonb);
--           DROP FUNCTION private.wa_unresolved_checkpoint_vault_guard();
begin;
create function private.wa_unresolved_checkpoint_vault_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(old.id::text, 20261028));
  if exists (
    select 1 from private.es02_b3_whatsapp_signup_checkpoints c
    join private.es02_b3_connection_attempts a on a.id=c.attempt_id
    where c.token_secret_id=old.id and a.status <> 'bound'
  ) then
    raise exception 'WHATSAPP_CHECKPOINT_UNRESOLVED' using errcode='23514';
  end if;
  return old;
end;
$$;
alter function private.wa_unresolved_checkpoint_vault_guard() owner to postgres;
revoke all on function private.wa_unresolved_checkpoint_vault_guard() from public, anon, authenticated, service_role;
create trigger wa_unresolved_checkpoint_vault_guard before delete on vault.secrets
for each row execute function private.wa_unresolved_checkpoint_vault_guard();
create function private.wa_checkpoint_secret_reference_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.token_secret_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.token_secret_id::text, 20261028));
    perform 1 from vault.secrets where id=new.token_secret_id;
    if not found then raise exception 'WHATSAPP_CHECKPOINT_SECRET_MISSING' using errcode='23503'; end if;
  end if;
  return new;
end;
$$;
alter function private.wa_checkpoint_secret_reference_guard() owner to postgres;
revoke all on function private.wa_checkpoint_secret_reference_guard() from public, anon, authenticated, service_role;
create trigger wa_checkpoint_secret_reference_guard before insert or update of token_secret_id
on private.es02_b3_whatsapp_signup_checkpoints for each row execute function private.wa_checkpoint_secret_reference_guard();
create function private.wa_unresolved_checkpoint_evidence_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare attempt_status text;
begin
  select a.status into attempt_status from private.es02_b3_connection_attempts a
    where a.id=old.attempt_id for update;
  if attempt_status is distinct from 'bound' and
    (tg_op='DELETE' or (old.token_secret_id is not null and new.token_secret_id is distinct from old.token_secret_id)
     or new.attempt_id is distinct from old.attempt_id) then
    raise exception 'WHATSAPP_CHECKPOINT_UNRESOLVED' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
alter function private.wa_unresolved_checkpoint_evidence_guard() owner to postgres;
revoke all on function private.wa_unresolved_checkpoint_evidence_guard() from public, anon, authenticated, service_role;
create trigger wa_unresolved_checkpoint_evidence_guard before delete or update of token_secret_id, attempt_id
on private.es02_b3_whatsapp_signup_checkpoints for each row execute function private.wa_unresolved_checkpoint_evidence_guard();
create function public.wa_expired_checkpoint_review(p_binding jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a private.es02_b3_connection_attempts%rowtype; c private.es02_b3_whatsapp_signup_checkpoints%rowtype;
 actor uuid; sid uuid; company uuid; branch uuid; attempt uuid; gen integer; observed jsonb; token text;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501'; end if;
 begin
  actor:=(p_binding->>'accountId')::uuid; sid:=(p_binding->>'sessionId')::uuid; company:=(p_binding->>'companyId')::uuid;
  branch:=(p_binding->>'branchId')::uuid; attempt:=(p_binding->>'attemptId')::uuid; gen:=(p_binding->>'generation')::integer;
 exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('ok',false); end;
 if not private.es02_b3_session_open(actor,sid) then return jsonb_build_object('ok',false); end if;
 observed:=private.es02_b3_current_binding(actor,company,branch,'whatsapp');
 if observed->>'ok' is distinct from 'true' then return jsonb_build_object('ok',false); end if;
 select * into a from private.es02_b3_connection_attempts x where x.id=attempt and x.account_id=actor and x.session_id=sid
  and x.company_id=company and x.branch_id=branch and x.generation=gen and x.channel='whatsapp' and x.flow='wa_new_number' for update;
 if a.id is null or a.status not in ('pending','claimed','unknown') or a.expires_at>clock_timestamp()
  or not private.es02_b3_pin_matches(a,observed) then return jsonb_build_object('ok',false); end if;
 select * into c from private.es02_b3_whatsapp_signup_checkpoints x where x.attempt_id=a.id for update;
 if c.attempt_id is null or c.token_secret_id is null then return jsonb_build_object('ok',false); end if;
 select decrypted_secret into token from vault.decrypted_secrets where id=c.token_secret_id;
 if nullif(btrim(token),'') is null then return jsonb_build_object('ok',false); end if;
 return jsonb_build_object('ok',true,'token',token,'wabaId',c.waba_id,'phoneNumberId',c.phone_number_id,'appId',a.app_id,'configId',a.config_id,'graphVersion',a.graph_version);
end; $$;
alter function public.wa_expired_checkpoint_review(jsonb) owner to postgres;
revoke all on function public.wa_expired_checkpoint_review(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.wa_expired_checkpoint_review(jsonb) to service_role;
commit;
