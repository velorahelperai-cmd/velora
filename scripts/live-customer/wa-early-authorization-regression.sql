begin;set local role postgres;
do $$declare b jsonb;a uuid;reservation uuid;r jsonb;k text;sid uuid;saved_secret_id uuid;n integer;begin
 select binding into b from private.wa_recovery_fixture;a:=(b->>'attemptId')::uuid;
 select c.reservation into reservation from private.es02_b3_early_whatsapp_authorizations c where c.attempt_id=a;
 if has_function_privilege('authenticated','public.es02_b3_early_whatsapp_authorization(text,jsonb,uuid,text)','EXECUTE') or has_function_privilege('anon','public.es02_b3_early_whatsapp_authorization(text,jsonb,uuid,text)','EXECUTE') then raise exception 'CLIENT_RPC_PRIVILEGE';end if;
 if not has_function_privilege('service_role','public.es02_b3_early_whatsapp_authorization(text,jsonb,uuid,text)','EXECUTE') or has_table_privilege('service_role','private.es02_b3_early_whatsapp_authorizations','SELECT') then raise exception 'SERVER_PRIVILEGES';end if;
 if not exists(select 1 from pg_proc where oid='public.es02_b3_early_whatsapp_authorization(text,jsonb,uuid,text)'::regprocedure and prosecdef and proowner='postgres'::regrole and proconfig @> array['search_path=""']) then raise exception 'DEFINER_CONFIGURATION';end if;
 begin
  delete from private.es02_b3_early_whatsapp_authorizations where attempt_id=a;
  perform set_config('role','service_role',true);
  r:=public.es02_b3_whatsapp_signup_checkpoint('reserve',b,gen_random_uuid(),null);
  if r->>'acquired'<>'true' then raise exception 'LEGACY_RESERVATION_FIXTURE';end if;
  r:=public.es02_b3_early_whatsapp_authorization('reserve',b,gen_random_uuid(),null);
  if r->>'ok'<>'false' then raise exception 'LEGACY_CODE_REEXCHANGE';end if;
  raise exception 'RESTORE_LEGACY_FIXTURE' using errcode='P0002';
 exception when no_data_found then null;end;
 perform set_config('role','service_role',true);
 foreach k in array array['accountId','sessionId','companyId','branchId','attemptId'] loop
  r:=public.es02_b3_early_whatsapp_authorization('load',jsonb_set(b,array[k],to_jsonb(gen_random_uuid())),null,null);
  if r->>'ok'<>'false' then raise exception 'FOREIGN_BINDING_%',k;end if;
 end loop;
 foreach k in array array['nonce','appId','configId','graphVersion','codeHash'] loop
  r:=public.es02_b3_early_whatsapp_authorization('reserve',jsonb_set(b,array[k],to_jsonb('invalid'::text)),gen_random_uuid(),null);
  if r->>'ok'<>'false' then raise exception 'MISMATCH_%',k;end if;
 end loop;
 r:=public.es02_b3_early_whatsapp_authorization('save',b,gen_random_uuid(),'synthetic-token');if r->>'ok'<>'false' then raise exception 'FOREIGN_RESERVATION';end if;
 r:=public.es02_b3_early_whatsapp_authorization('load',b,null,null);if r->>'ok'<>'false' then raise exception 'MISSING_FINISH_UNSAVED';end if;
 r:=public.es02_b3_early_whatsapp_authorization('load',jsonb_set(b,'{generation}','2'::jsonb),null,null);if r->>'ok'<>'false' then raise exception 'FOREIGN_GENERATION';end if;
 perform set_config('role','postgres',true);select count(*) into n from vault.secrets;
 perform set_config('role','service_role',true);
 begin
  r:=public.es02_b3_early_whatsapp_authorization('save',b,reservation,'synthetic-token');if r->>'ok'<>'true' then raise exception 'SAVE';end if;
  raise exception 'ROLLBACK_INJECTION' using errcode='P0002';
 exception when no_data_found then null;end;
 perform set_config('role','postgres',true);
 if (select count(*) from vault.secrets)<>n or exists(select 1 from private.es02_b3_early_whatsapp_authorizations where attempt_id=a and token_secret_id is not null) then raise exception 'ROLLBACK_LEAK';end if;
 perform set_config('role','service_role',true);
 r:=public.es02_b3_early_whatsapp_authorization('save',b,reservation,'synthetic-token');if r->>'ok'<>'true' then raise exception 'SAVE';end if;
 r:=public.es02_b3_early_whatsapp_authorization('save',b,reservation,'replacement-token');if r->>'ok'<>'false' then raise exception 'OVERWRITE';end if;
 r:=public.es02_b3_early_whatsapp_authorization('save',b,reservation,'synthetic-token');if r->>'ok'<>'true' then raise exception 'SAVE_RETRY';end if;
 r:=public.es02_b3_early_whatsapp_authorization('load',b,null,null);if r->>'token'<>'synthetic-token' then raise exception 'DURABLE_PRE_FINISH';end if;
 perform set_config('role','postgres',true);select token_secret_id into saved_secret_id from private.es02_b3_early_whatsapp_authorizations where attempt_id=a;
 if not exists(select 1 from vault.secrets where id=saved_secret_id and secret<>'synthetic-token') then raise exception 'VAULT_PLAINTEXT';end if;
 begin
  update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=(b->>'sessionId')::uuid;
  perform set_config('role','service_role',true);
  r:=public.es02_b3_early_whatsapp_authorization('load',b,null,null);if r->>'ok'<>'false' then raise exception 'CLOSED_SESSION_LOAD';end if;
  r:=public.es02_b3_early_whatsapp_authorization('promote',b,null,null);if r->>'ok'<>'false' then raise exception 'CLOSED_SESSION_PROMOTION';end if;
  raise exception 'RESTORE_SESSION_FIXTURE' using errcode='P0002';
 exception when no_data_found then null;end;
 begin
  update private.es02_b3_connection_attempts set expires_at=clock_timestamp()-interval '1 second' where id=a;
  perform set_config('role','service_role',true);
  r:=public.es02_b3_early_whatsapp_authorization('load',b,null,null);if r->>'ok'<>'false' then raise exception 'EXPIRED_LOAD';end if;
  r:=public.es02_b3_early_whatsapp_authorization('promote',b,null,null);if r->>'ok'<>'false' then raise exception 'EXPIRED_PROMOTION';end if;
  r:=public.es02_b3_early_whatsapp_authorization('cleanup',b,null,null);if r->>'ok'<>'false' then raise exception 'UNKNOWN_CLEANUP';end if;
  perform set_config('role','postgres',true);
  update private.es02_b3_early_whatsapp_authorizations set expires_at=clock_timestamp()-interval '1 second' where attempt_id=a;
  update private.es02_b3_connection_attempts set status='cancelled' where id=a;
  update public.whatsapp_embedded_signup_attempts set status='cancelled',consumed_at=clock_timestamp() where id=(select legacy_attempt_id from private.es02_b3_connection_attempts where id=a);
  perform set_config('role','service_role',true);
  r:=public.es02_b3_early_whatsapp_authorization('cleanup',b,null,null);if r->>'ok'<>'true' then raise exception 'CLEANUP';end if;
  perform set_config('role','postgres',true);
  if exists(select 1 from vault.secrets where id=saved_secret_id) or not exists(select 1 from private.es02_b3_early_whatsapp_authorizations where attempt_id=a and code_hash=b->>'codeHash' and token_secret_id is null and state='expired') then raise exception 'CLEANUP_EVIDENCE';end if;
  raise exception 'RESTORE_EXPIRY_FIXTURE' using errcode='P0002';
 exception when no_data_found then null;end;
end $$;commit;
