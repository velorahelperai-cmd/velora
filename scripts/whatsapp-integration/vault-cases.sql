-- Actual local Vault extension with synthetic test strings only. Rollback all secrets.
begin;
do $$ declare f jsonb:=test_fixture.company(false);sid uuid; r jsonb;begin
 sid:=vault.create_secret('synthetic-token-one','fixture-'||gen_random_uuid(),'Test only');
 update whatsapp_company_links set access_secret_id=sid where id=(f->>'link')::uuid;
 if exists(select 1 from vault.secrets where id=sid and secret='synthetic-token-one') then raise exception 'Vault did not encrypt fake token';end if;
 perform set_config('role','service_role',true);
 r:=whatsapp_read_link_access_secret((f->>'company')::uuid,(f->>'link')::uuid,
 (select provider_phone_number_id from whatsapp_company_links where id=(f->>'link')::uuid),1);
 if r->>'access_token'<>'synthetic-token-one' then raise exception 'scoped Vault lookup failed';end if;
 r:=whatsapp_read_link_access_secret(gen_random_uuid(),(f->>'link')::uuid,
 (select provider_phone_number_id from whatsapp_company_links where id=(f->>'link')::uuid),1);
 if r->>'ok'='true' then raise exception 'Vault token leaked across tenant';end if;
 r:=whatsapp_read_link_access_secret((f->>'company')::uuid,(f->>'link')::uuid,
 (select provider_phone_number_id from whatsapp_company_links where id=(f->>'link')::uuid),2);
 if r->>'ok'='true' then raise exception 'Vault accepted obsolete link generation';end if;
end;$$;
select 'PASS|Vault encrypts synthetic token and reads only exact tenant/link/phone/generation';
rollback;
