 -- Inserted inside the existing synthetic native fixture DO block, after paid channel selection.
 declare started jsonb; binding jsonb;
 begin
  started:=public.es02_b3_start_owned_branch_connection(actor,company,branchid,'whatsapp','wa_new_number',gen_random_uuid(),r->>'revision',null,'111','123','v25.0',repeat('a',64),null,null,sid,false);
  perform pg_temp.must(started->>'ok'='true','new_number_native_start');
  binding:=jsonb_build_object('accountId',actor,'companyId',company,'branchId',branchid,'sessionId',sid,'attemptId',started->'launch'->>'attemptId','generation',1,'nonce',repeat('a',64),'appId','111','configId','123','graphVersion','v25.0','wabaId','222','phoneNumberId','333','codeHash',repeat('b',64));
  insert into private.wa_recovery_fixture values(binding);
 end;
-- AFTER_FIXTURE
begin;
set local role postgres;
do $$
declare binding jsonb;attempt uuid;reservation uuid;result jsonb;secret_id uuid;before_count integer;
begin
 select f.binding into binding from private.wa_recovery_fixture f;
 attempt:=(binding->>'attemptId')::uuid;
 if has_function_privilege('authenticated','public.es02_b3_whatsapp_signup_checkpoint(text,jsonb,uuid,text)','EXECUTE') then raise exception 'CLIENT_CHECKPOINT_PRIVILEGE';end if;
 if has_table_privilege('service_role','private.es02_b3_whatsapp_signup_checkpoints','SELECT') then raise exception 'DIRECT_TOKEN_TABLE_PRIVILEGE';end if;
 select c.reservation into reservation from private.es02_b3_whatsapp_signup_checkpoints c where c.attempt_id=attempt;
 select count(*) into before_count from vault.secrets;
 perform set_config('role','service_role',true);
 result:=public.es02_b3_whatsapp_signup_checkpoint('reserve',jsonb_set(binding,'{nonce}',to_jsonb(repeat('c',64))),gen_random_uuid(),null);
 if result->>'ok'<>'false' then raise exception 'FOREIGN_NONCE';end if;
 result:=public.es02_b3_whatsapp_signup_checkpoint('load',jsonb_set(binding,'{sessionId}',to_jsonb(gen_random_uuid())),null,null);
 if result->>'ok'<>'false' then raise exception 'FOREIGN_SESSION';end if;
 result:=public.es02_b3_whatsapp_signup_checkpoint('load',jsonb_set(binding,'{branchId}',to_jsonb(gen_random_uuid())),null,null);
 if result->>'ok'<>'false' then raise exception 'FOREIGN_BRANCH';end if;
 result:=public.es02_b3_whatsapp_signup_checkpoint('save',binding,gen_random_uuid(),'synthetic-token');
 if result->>'ok'<>'false' then raise exception 'FOREIGN_RESERVATION';end if;
 begin
  result:=public.es02_b3_whatsapp_signup_checkpoint('save',binding,reservation,'synthetic-token');
  if result->>'ok'<>'true' then raise exception 'CHECKPOINT_SAVE';end if;
  raise exception 'EXPECTED_TEST_ROLLBACK' using errcode='P0002';
 exception when no_data_found then null;end;
 perform set_config('role','postgres',true);
 if (select count(*) from vault.secrets)<>before_count then raise exception 'VAULT_ROLLBACK_LEAK';end if;
 if exists(select 1 from private.es02_b3_whatsapp_signup_checkpoints c where c.attempt_id=attempt and c.token_secret_id is not null) then raise exception 'CHECKPOINT_ROLLBACK_LEAK';end if;
 perform set_config('role','service_role',true);
 result:=public.es02_b3_whatsapp_signup_checkpoint('save',binding,reservation,'synthetic-token');
 if result->>'ok'<>'true' then raise exception 'SAVE';end if;
 result:=public.es02_b3_whatsapp_signup_checkpoint('save',binding,reservation,'must-not-replace-existing-token');
 if result->>'ok'<>'true' then raise exception 'SAVE_RETRY';end if;
 result:=public.es02_b3_whatsapp_signup_checkpoint('load',binding,null,null);
 if result->>'token'<>'synthetic-token' or result->>'phoneNumberId'<>'333' then raise exception 'DURABLE_RELOAD';end if;
 perform set_config('role','postgres',true);
 select c.token_secret_id into secret_id from private.es02_b3_whatsapp_signup_checkpoints c where c.attempt_id=attempt;
 if not exists(select 1 from vault.secrets where id=secret_id and secret<>'synthetic-token') then raise exception 'UNENCRYPTED_VAULT';end if;
 if exists(select 1 from public.whatsapp_company_links where company_id=(binding->>'companyId')::uuid) then raise exception 'FAKE_CONNECTED';end if;
 if not exists(select 1 from private.es02_activation_foundation where company_id=(binding->>'companyId')::uuid and clock_state='waiting_readiness' and subscription_started_at is null) then raise exception 'CLOCK_CHANGED';end if;
 update private.es02_b3_connection_attempts set expires_at=clock_timestamp()-interval '1 second' where id=attempt;
 perform set_config('role','service_role',true);
 result:=public.es02_b3_whatsapp_signup_checkpoint('load',binding,null,null);
 if result->>'ok'<>'false' then raise exception 'EXPIRED_CHECKPOINT';end if;
 result:=public.es02_b3_whatsapp_signup_checkpoint('discard',binding,null,null);
 if result->>'ok'<>'true' then raise exception 'EXPIRED_CLEANUP';end if;
 perform set_config('role','postgres',true);
 if exists(select 1 from vault.secrets where id=secret_id) then raise exception 'VAULT_CLEANUP_FAILED';end if;
end $$;
rollback;
