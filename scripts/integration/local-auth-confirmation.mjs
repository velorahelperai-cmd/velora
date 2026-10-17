// Test fixture only, installed exclusively through startStack's owned SQL path.
// Native hook contract: https://supabase.com/docs/guides/auth/auth-hooks
export function confirmationEnvironment(enabled) {
 if(typeof enabled!=='boolean')throw Error('LOCAL_CONFIRMATION_BOOLEAN_REQUIRED');
 return enabled ? {
  GOTRUE_MAILER_AUTOCONFIRM:'false',
  GOTRUE_HOOK_SEND_EMAIL_ENABLED:'true',
  GOTRUE_HOOK_SEND_EMAIL_URI:'pg-functions://postgres/local_auth_fixture/capture_email',
  GOTRUE_MAILER_OTP_LENGTH:'6',
 } : {GOTRUE_MAILER_AUTOCONFIRM:'true'};
}
export const CONFIRMATION_SQL=`
create schema local_auth_fixture;
revoke all on schema local_auth_fixture from public,anon,authenticated;
grant usage on schema local_auth_fixture to supabase_auth_admin;
create table local_auth_fixture.email_events(
 user_id uuid not null,email text not null,token text not null,action_type text not null,
 token_hash text, redirect_to text,
 created_at timestamptz not null default clock_timestamp()
);
alter table local_auth_fixture.email_events enable row level security;
revoke all on local_auth_fixture.email_events from public,anon,authenticated;
grant insert on local_auth_fixture.email_events to supabase_auth_admin;
create policy synthetic_mail_only on local_auth_fixture.email_events for insert to supabase_auth_admin
 with check(email ~ '@example\\.(invalid|test)$' and token ~ '^[0-9]{6}$');
create function local_auth_fixture.capture_email(event jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 insert into local_auth_fixture.email_events(user_id,email,token,action_type,token_hash,redirect_to)
 values((event->'user'->>'id')::uuid,lower(event->'user'->>'email'),event->'email_data'->>'token',event->'email_data'->>'email_action_type',event->'email_data'->>'token_hash',event->'email_data'->>'redirect_to');
 return '{}'::jsonb;
end;
$$;
revoke all on function local_auth_fixture.capture_email(jsonb) from public,anon,authenticated;
grant execute on function local_auth_fixture.capture_email(jsonb) to supabase_auth_admin;
`;
