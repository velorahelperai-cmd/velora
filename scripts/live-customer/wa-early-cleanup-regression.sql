-- Synthetic fixture only, disposable database. Never apply this test to Production.
begin;
create function private.wa_cleanup_fault() returns trigger language plpgsql as $$begin
 if current_setting('wa_cleanup.fail',true)='true' then raise exception 'SYNTHETIC_DELETE_FAILURE';end if;return old;end $$;
create trigger wa_cleanup_fault before delete on vault.secrets for each row execute function private.wa_cleanup_fault();
do $$declare b jsonb;r jsonb;rid uuid:=gen_random_uuid();a uuid;secret_id uuid;n integer;begin
 select binding into b from private.wa_recovery_fixture;a:=(b->>'attemptId')::uuid;
 if exists(select 1 from cron.job where jobname='velora-wa-early-authorization-cleanup-v1' and active) then raise exception 'CRON_ENABLED';end if;
 if (select count(*) from cron.job where jobname='velora-wa-early-authorization-cleanup-v1' and schedule='*/5 * * * *')<>1 then raise exception 'CRON_NOT_REGISTERED';end if;
 if has_function_privilege('anon','public.es02_b3_cleanup_early_wa_tick(integer)','execute') or has_function_privilege('authenticated','public.es02_b3_cleanup_early_wa_tick(integer)','execute') or has_table_privilege('service_role','private.es02_b3_early_wa_cleanup_settings','update') then raise exception 'CLIENT_CLEANUP_PRIVILEGE';end if;
 perform set_config('role','service_role',true);
 r:=public.es02_b3_cleanup_early_wa_tick(1);if r->>'code'<>'CLEANUP_DISABLED' then raise exception 'DEFAULT_NOT_DISABLED';end if;
 r:=public.es02_b3_early_whatsapp_authorization('reserve',b,rid,null);if r->>'acquired'<>'true' then raise exception 'RESERVE_FIXTURE';end if;
 -- A reservation is an ambiguous external exchange, never eligible for cleanup.
 r:=public.es02_b3_early_whatsapp_authorization('cleanup',b,null,null);if r->>'ok'<>'false' then raise exception 'RESERVED_CLEANED';end if;
 r:=public.es02_b3_early_whatsapp_authorization('save',b,rid,'synthetic-cleanup-token');if r->>'ok'<>'true' then raise exception 'SAVE_FIXTURE';end if;
 perform set_config('role','postgres',true);
 select token_secret_id into secret_id from private.es02_b3_early_whatsapp_authorizations where attempt_id=a;
 begin
  delete from private.es02_b3_early_wa_cleanup_settings;
  perform set_config('role','service_role',true);r:=public.es02_b3_cleanup_early_wa_tick(1);if r->>'code'<>'CLEANUP_DISABLED' then raise exception 'MISSING_SWITCH_FAIL_OPEN';end if;
  raise exception 'RESTORE_FIXTURE' using errcode='P0002';exception when no_data_found then null;end;
 update private.es02_b3_early_wa_cleanup_settings set enabled=true where singleton;
 perform set_config('role','service_role',true);
 r:=public.es02_b3_cleanup_early_wa_tick(51);if r->>'code'<>'INVALID_LIMIT' then raise exception 'UNBOUNDED_SWEEP';end if;
 r:=public.es02_b3_cleanup_early_wa_tick(1);if (r->>'cleaned')::integer<>0 then raise exception 'FRESH_CLEANED';end if;
 perform set_config('role','postgres',true);
 update private.es02_b3_connection_attempts set expires_at=clock_timestamp()-interval '1 hour' where id=a;
 update private.es02_b3_early_whatsapp_authorizations set expires_at=clock_timestamp()-interval '1 hour' where attempt_id=a;
 perform set_config('role','service_role',true);
 r:=public.es02_b3_cleanup_early_wa_tick(1);if (r->>'cleaned')::integer<>0 then raise exception 'EXPIRED_UNKNOWN_CLEANED';end if;
 r:=public.es02_b3_early_whatsapp_authorization('cleanup',b,null,null);if r->>'ok'<>'false' then raise exception 'DIRECT_UNKNOWN_CLEANED';end if;
 perform set_config('role','postgres',true);
 update private.es02_b3_connection_attempts set status='claimed' where id=a;
 perform set_config('role','service_role',true);r:=public.es02_b3_cleanup_early_wa_tick(1);if (r->>'cleaned')::integer<>0 then raise exception 'CLAIMED_CLEANED';end if;
 perform set_config('role','postgres',true);
 update private.es02_b3_connection_attempts set status='cancelled' where id=a;
 perform set_config('role','service_role',true);r:=public.es02_b3_cleanup_early_wa_tick(1);if (r->>'cleaned')::integer<>0 then raise exception 'UNCONFIRMED_LEGACY_CLEANED';end if;
 perform set_config('role','postgres',true);
 update public.whatsapp_embedded_signup_attempts set status='cancelled',consumed_at=clock_timestamp() where id=(select legacy_attempt_id from private.es02_b3_connection_attempts where id=a);
 begin
  update private.es02_b3_early_whatsapp_authorizations set state='reserved' where attempt_id=a;
  perform set_config('role','service_role',true);r:=public.es02_b3_cleanup_early_wa_tick(1);if (r->>'cleaned')::integer<>0 then raise exception 'TERMINAL_RESERVED_CLEANED';end if;
  raise exception 'RESTORE_FIXTURE' using errcode='P0002';exception when no_data_found then null;end;
 perform set_config('role','postgres',true);
 begin
  insert into private.es02_b3_whatsapp_signup_checkpoints(attempt_id,reservation,code_hash,waba_id,phone_number_id) values(a,gen_random_uuid(),repeat('c',64),'222','333');
  perform set_config('role','service_role',true);r:=public.es02_b3_cleanup_early_wa_tick(1);if (r->>'cleaned')::integer<>0 then raise exception 'CHECKPOINT_CLEANED';end if;
  raise exception 'RESTORE_FIXTURE' using errcode='P0002';exception when no_data_found then null;end;
 perform set_config('wa_cleanup.fail','true',true);perform set_config('role','service_role',true);
 r:=public.es02_b3_cleanup_early_wa_tick(1);if (r->>'failed')::integer<>1 then raise exception 'FAULT_NOT_REPORTED';end if;
 perform set_config('wa_cleanup.fail','false',true);perform set_config('role','postgres',true);
 if not exists(select 1 from vault.secrets where id=secret_id) or not exists(select 1 from private.es02_b3_early_whatsapp_authorizations where attempt_id=a and state='stored' and token_secret_id=secret_id) then raise exception 'FAILURE_DESTROYED_EVIDENCE';end if;
 perform set_config('role','service_role',true);r:=public.es02_b3_cleanup_early_wa_tick(1);if (r->>'cleaned')::integer<>1 then raise exception 'CLEANUP_FAILED';end if;
 r:=public.es02_b3_cleanup_early_wa_tick(1);if (r->>'cleaned')::integer<>0 then raise exception 'REPEAT_SIDE_EFFECT';end if;
 perform set_config('role','postgres',true);
 if exists(select 1 from vault.secrets where id=secret_id) or not exists(select 1 from private.es02_b3_early_whatsapp_authorizations where attempt_id=a and state='expired' and token_secret_id is null and code_hash=b->>'codeHash') then raise exception 'CLEANUP_AUDIT_LOST';end if;
 -- Reconstitute only a synthetic eligible credential for four-session worker contention.
 select vault.create_secret('synthetic-concurrent-cleanup-token') into secret_id;
 update private.es02_b3_early_whatsapp_authorizations set state='stored',token_secret_id=secret_id where attempt_id=a;
 if not exists(select 1 from private.es02_activation_foundation where company_id=(b->>'companyId')::uuid and subscription_started_at is null) then raise exception 'CLOCK_CHANGED';end if;
end $$;
reset role;
drop trigger wa_cleanup_fault on vault.secrets;drop function private.wa_cleanup_fault();
commit;
