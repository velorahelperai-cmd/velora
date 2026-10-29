-- Provisional engineering thresholds, not provider quotas. All start in monitor.
-- SQL settings are private; change mode/threshold only after reviewing observations.
create table private.security_rate_policies (
 endpoint text primary key,
 mode text not null default 'monitor' check (mode in ('monitor','enforce')),
 window_seconds integer not null check (window_seconds between 1 and 86400),
 max_requests integer not null check (max_requests between 1 and 100000)
);
create table private.security_rate_counters (
 endpoint text not null references private.security_rate_policies(endpoint),
 subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null,
 hits integer not null check (hits>0),
 exceeded bigint not null default 0,
 primary key(endpoint,subject_hash)
);
alter table private.security_rate_policies enable row level security;
alter table private.security_rate_counters enable row level security;
revoke all on private.security_rate_policies,private.security_rate_counters from public,anon,authenticated,service_role;
insert into private.security_rate_policies(endpoint,window_seconds,max_requests) values
 ('checkout',60,5),('invitation',600,10),('ai_trial',60,6),
 ('auth_login',300,20),('otp_verify',300,10),('otp_resend',300,3),('auth_signup',300,5);

create function public.security_consume_rate_limit(p_endpoint text,p_subject_hash text,p_account_id uuid default null,p_operation_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare policy private.security_rate_policies%rowtype; bucket private.security_rate_counters%rowtype; ts timestamptz:=clock_timestamp(); over_limit boolean;
begin
 if p_subject_hash is null or p_subject_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_RATE_SUBJECT'; end if;
 select * into policy from private.security_rate_policies where endpoint=p_endpoint for share;
 if not found then raise exception 'UNKNOWN_RATE_POLICY'; end if;
 -- Actual persisted account ownership, never a client-asserted replay flag.
 -- Downstream financial RPC still validates the operation fingerprint and session.
 if p_endpoint='checkout' and p_account_id is not null and p_operation_id is not null
    and exists(select 1 from private.es02_account_orders where account_id=p_account_id and client_op_id=p_operation_id) then
  return jsonb_build_object('allowed',true,'mode',policy.mode,'exceeded',false,'retryAfterSeconds',0,'replayed',true);
 end if;
 insert into private.security_rate_counters as c(endpoint,subject_hash,expires_at,hits,exceeded)
 values(p_endpoint,p_subject_hash,ts+make_interval(secs=>policy.window_seconds),1,0)
 on conflict(endpoint,subject_hash) do update set
  hits=case when c.expires_at<=ts then 1 else least(c.hits+1,100001) end,
  expires_at=case when c.expires_at<=ts then ts+make_interval(secs=>policy.window_seconds) else c.expires_at end,
  exceeded=c.exceeded+case when c.expires_at>ts and c.hits>=policy.max_requests then 1 else 0 end
 returning * into bucket;
 over_limit:=bucket.hits>policy.max_requests;
 -- Bounded cleanup of this new, non-authoritative observation store only.
 delete from private.security_rate_counters where ctid in
  (select ctid from private.security_rate_counters where expires_at<ts-interval '7 days' limit 100 for update skip locked);
 return jsonb_build_object('allowed',policy.mode='monitor' or not over_limit,'mode',policy.mode,'exceeded',over_limit,
  'retryAfterSeconds',case when over_limit then greatest(1,ceil(extract(epoch from bucket.expires_at-ts))::integer) else 0 end,'replayed',false);
end; $$;
revoke all on function public.security_consume_rate_limit(text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.security_consume_rate_limit(text,text,uuid,uuid) to service_role;
