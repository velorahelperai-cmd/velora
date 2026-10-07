-- VEL-PAYMOB-TEST-WIRING-01
-- New settlement entry for server-side Paymob HMAC verification.
-- Does NOT open billing_settle_verified_payment.
-- Does NOT accept synthetic test evidence.
-- service_role only. Live env rejected. Call private.billing_settle_payment_core.
-- NOT applied to cloud from this package alone — review before enable.

create or replace function public.billing_settle_paymob_hmac_verified(p_evidence jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    case
      when nullif(current_setting('request.jwt.claims', true), '') is not null
        then (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
      else null
    end,
    ''
  );
  v_marker text;
  v_auth jsonb;
  v_method text;
  v_env text;
  v_source text;
  v_verified text;
begin
  if v_jwt_role in ('anon', 'authenticated') then
    raise exception 'billing_settle_paymob_hmac_verified: forbidden for role %', v_jwt_role
      using errcode = '42501';
  end if;
  if v_jwt_role is distinct from 'service_role'
     and current_user is distinct from 'postgres'
     and current_user is distinct from 'supabase_admin' then
    raise exception 'billing_settle_paymob_hmac_verified: forbidden for role % (user %)',
      coalesce(nullif(v_jwt_role, ''), '<none>'), current_user
      using errcode = '42501';
  end if;

  if p_evidence is null or jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'billing_settle_paymob_hmac_verified: evidence incomplete'
      using errcode = '22023';
  end if;

  if p_evidence ? 'signature_verified' then
    raise exception 'billing_settle_paymob_hmac_verified: signature_verified is not accepted; use server authenticity attestation'
      using errcode = '22023';
  end if;

  v_marker := nullif(btrim(p_evidence ->> 'evidence_marker'), '');
  v_auth := p_evidence -> 'authenticity';
  v_env := nullif(btrim(p_evidence ->> 'provider_environment'), '');

  if v_env is not distinct from 'live' then
    raise exception 'billing_settle_paymob_hmac_verified: live environment settlement disabled in this package'
      using errcode = '22023';
  end if;

  if v_auth is null or jsonb_typeof(v_auth) <> 'object' then
    raise exception 'billing_settle_paymob_hmac_verified: authenticity attestation missing or invalid'
      using errcode = '22023';
  end if;

  v_source := nullif(btrim(v_auth ->> 'source'), '');
  v_verified := nullif(btrim(v_auth ->> 'verified'), '');
  v_method := nullif(btrim(v_auth ->> 'method'), '');

  -- Reject synthetic helper evidence on this path.
  if v_marker is not distinct from 'VEL_BILLING_SYNTHETIC_TEST_EVIDENCE'
     or v_method is not distinct from 'synthetic_test_only' then
    raise exception 'billing_settle_paymob_hmac_verified: synthetic evidence is not accepted'
      using errcode = '22023';
  end if;

  -- Accept only the server HMAC marker + method documented in settlement-bridge.ts
  if v_marker is distinct from 'VEL_PAYMOB_SERVER_HMAC_VERIFIED'
     or v_source is distinct from 'server_adapter_attestation'
     or v_verified is distinct from 'true'
     or v_method is distinct from 'paymob_hmac_sha512' then
    raise exception 'billing_settle_paymob_hmac_verified: authenticity attestation missing or invalid'
      using errcode = '22023';
  end if;

  -- Caller (Next.js webhook processor) must have verified HMAC before invoking.
  return private.billing_settle_payment_core(p_evidence);
end;
$$;

comment on function public.billing_settle_paymob_hmac_verified(jsonb) is
  'WIRING-01: settle after server Paymob HMAC verification. Marker VEL_PAYMOB_SERVER_HMAC_VERIFIED + method paymob_hmac_sha512. Rejects synthetic + live. service_role only. Does not open billing_settle_verified_payment.';

revoke all on function public.billing_settle_paymob_hmac_verified(jsonb)
  from public, anon, authenticated;

do $$
begin
  grant execute on function public.billing_settle_paymob_hmac_verified(jsonb) to service_role;
exception
  when undefined_object then null;
end;
$$;
