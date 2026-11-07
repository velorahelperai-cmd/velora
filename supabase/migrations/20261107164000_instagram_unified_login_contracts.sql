-- Migration: instagram_unified_login_contracts
-- Register unified login contract for app 3391832644330595 and contract 1935947410704479
begin;

insert into private.instagram_provider_contracts(contract_id, app_id, required_permissions, enabled)
values(
  '1935947410704479',
  '3391832644330595',
  array['instagram_business_basic', 'instagram_business_manage_messages'],
  true
)
on conflict (contract_id) do update set
  app_id = excluded.app_id,
  required_permissions = excluded.required_permissions,
  enabled = excluded.enabled;

insert into private.instagram_manual_contracts(
  id,
  parent_app_id,
  secret_fingerprint,
  installation_proof_ref,
  provider_fixture_proof_ref,
  timestamp_unit,
  timestamp_proof_ref,
  verified_at
)
values(
  'manual_text',
  '3391832644330595',
  '81c0274786e7a57922b76a65780ec8290171684ca0de4e159a4b947527deac97',
  'meta-app-3391832644330595',
  'meta-v26-live',
  'unix_ms',
  'meta-v26-unix-ms',
  clock_timestamp()
)
on conflict (id) do update set
  parent_app_id = excluded.parent_app_id,
  secret_fingerprint = excluded.secret_fingerprint,
  verified_at = clock_timestamp();

commit;
