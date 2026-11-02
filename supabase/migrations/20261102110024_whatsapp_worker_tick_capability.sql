-- Capability primitive only. Installing this does not start a worker or schedule a cron.
-- pg_net queues may expose headers to database login roles; never queue a long-lived secret.
begin;
create table private.whatsapp_worker_ticks (
  token_hash bytea primary key,
  expires_at timestamptz not null
);
alter table private.whatsapp_worker_ticks enable row level security;
revoke all on private.whatsapp_worker_ticks from public, anon, authenticated, service_role;
create index whatsapp_worker_ticks_expires_at_idx on private.whatsapp_worker_ticks(expires_at);

create function private.whatsapp_issue_worker_tick() returns text
language plpgsql security definer set search_path='' as $$
declare token text;
begin
  delete from private.whatsapp_worker_ticks where expires_at < clock_timestamp() - interval '5 minutes';
  token := encode(extensions.gen_random_bytes(32),'hex');
  insert into private.whatsapp_worker_ticks(token_hash,expires_at)
  values(extensions.digest(decode(token,'hex'),'sha256'),clock_timestamp()+interval '90 seconds');
  return token;
end;$$;
revoke all on function private.whatsapp_issue_worker_tick() from public, anon, authenticated, service_role;

create function public.whatsapp_redeem_worker_tick(p_token text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return false; end if;
  delete from private.whatsapp_worker_ticks
  where token_hash=extensions.digest(decode(p_token,'hex'),'sha256') and expires_at>clock_timestamp();
  return found;
end;$$;
revoke all on function public.whatsapp_redeem_worker_tick(text) from public, anon, authenticated;
grant execute on function public.whatsapp_redeem_worker_tick(text) to service_role;
create table private.whatsapp_worker_scheduler_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  endpoint text check (endpoint is null or endpoint='https://www.velorahelper.com/api/internal/whatsapp/worker'),
  check (not enabled or endpoint is not null)
);
alter table private.whatsapp_worker_scheduler_settings enable row level security;
revoke all on private.whatsapp_worker_scheduler_settings from public, anon, authenticated, service_role;
insert into private.whatsapp_worker_scheduler_settings(singleton) values(true);

create table private.whatsapp_worker_tick_runs (
  request_id bigint primary key,
  queued_at timestamptz not null default clock_timestamp()
);
alter table private.whatsapp_worker_tick_runs enable row level security;
revoke all on private.whatsapp_worker_tick_runs from public, anon, authenticated, service_role;
-- This function only queues a short-lived one-use capability. It has no
-- accessible grants and cannot be used as an arbitrary-URL HTTP proxy.
create function private.whatsapp_schedule_worker_tick() returns boolean
language plpgsql security definer set search_path='' as $$
declare target text; token text; signing_key text; key_count bigint; signature text; request_id bigint;
begin
  select endpoint into target from private.whatsapp_worker_scheduler_settings where singleton and enabled;
  if target is null then return false; end if;
  select count(*),min(decrypted_secret) into key_count,signing_key from vault.decrypted_secrets where name='whatsapp_worker_tick_hmac_v1';
  if key_count<>1 or length(btrim(coalesce(signing_key,'')))<32 then raise exception 'WORKER_TICK_SIGNING_KEY_REQUIRED'; end if;
  token := private.whatsapp_issue_worker_tick();
  signature:=encode(extensions.hmac(convert_to(token,'UTF8'),convert_to(btrim(signing_key),'UTF8'),'sha256'),'hex');
  select net.http_post(url:=target, headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer tick.'||token||'.'||signature), body:='{}'::jsonb, timeout_milliseconds:=300000) into request_id;
  if request_id is null then raise exception 'WORKER_TICK_ENQUEUE_FAILED'; end if;
  delete from private.whatsapp_worker_tick_runs where queued_at < clock_timestamp() - interval '7 days';
  insert into private.whatsapp_worker_tick_runs(request_id) values(request_id);
  return true;
end;$$;
revoke all on function private.whatsapp_schedule_worker_tick() from public, anon, authenticated, service_role;
commit;