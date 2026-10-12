-- Read-only installed signing authority. No contract, token, rollout or grant seed.
begin;
create function public.instagram_read_installed_runtime(p_parent_app_id text,p_secret_fingerprint text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.instagram_manual_contracts%rowtype;
begin
 if current_setting('role',true) is distinct from 'service_role' then
  raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';
 end if;
 if p_parent_app_id is null or p_parent_app_id !~ '^[0-9]{1,64}$'
  or p_secret_fingerprint is null or p_secret_fingerprint !~ '^[0-9a-f]{64}$' then
  return jsonb_build_object('ok',false);
 end if;
 select * into c from private.instagram_manual_contracts
 where id='manual_text' and parent_app_id=p_parent_app_id
  and secret_fingerprint=p_secret_fingerprint and verified_at<=clock_timestamp();
 if not found then return jsonb_build_object('ok',false);end if;
 return jsonb_build_object('ok',true,'installedSecretVerified',true,'providerFixtureVerified',true,
  'timestampContractVerified',c.timestamp_unit in ('unix_ms','unix_seconds') and c.timestamp_proof_ref is not null);
end;$$;
alter function public.instagram_read_installed_runtime(text,text) owner to postgres;
revoke all on function public.instagram_read_installed_runtime(text,text) from public,anon,authenticated;
grant execute on function public.instagram_read_installed_runtime(text,text) to service_role;
commit;
