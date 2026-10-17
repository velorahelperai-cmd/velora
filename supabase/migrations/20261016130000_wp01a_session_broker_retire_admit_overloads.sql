-- WP01A — RETIRE old vel_broker_admit_session overloads (C4-07).
--
-- STATUS: documented placeholder — NO DROP executed.
-- Forbidden until: C4 admit verified, dependency inventory complete, explicit approval.
-- Production cleanup approval remains distinct (OPS / SEC-REL-001).
--
-- Exact retirement list (do not uncomment without approval):
--   drop function if exists public.vel_broker_admit_session(uuid,uuid,uuid,text,text,text,text,text,timestamptz,text);
--   drop function if exists public.vel_broker_admit_session(uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,uuid);
--   drop function if exists public.vel_broker_admit_session(uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,uuid,text);
-- Retain: check_app_session(boolean), app_session_is_valid(), master_revoke_account_sessions(uuid).

begin;
-- no-op: retirement not authorized
commit;
