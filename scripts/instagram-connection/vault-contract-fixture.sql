-- TEST DOUBLE ONLY. Not actual Supabase Vault, encryption or managed-key proof.
-- Synthetic tokens only; installed solely in verified offline tmpfs fixture.
create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text not null,name text unique,description text);
create view vault.decrypted_secrets as select id,substring(secret from 9) as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text,new_name text default null,new_description text default '',new_key_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$declare result uuid;begin
 insert into vault.secrets(secret,name,description) values('fixture:'||new_secret,new_name,new_description) returning id into result;
 return result;
end;$$;
revoke all on schema vault from public,anon,authenticated,service_role;
revoke all on vault.secrets,vault.decrypted_secrets from public,anon,authenticated,service_role;
revoke all on function vault.create_secret(text,text,text,uuid) from public,anon,authenticated,service_role;
-- Model the native platform's trusted-server read boundary, not a production ACL change.
grant usage on schema vault to service_role;
grant select on vault.secrets,vault.decrypted_secrets to service_role;
