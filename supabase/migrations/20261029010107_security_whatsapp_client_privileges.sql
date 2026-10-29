-- Clients read conversation-scoped projections. Existing permissive RLS grants
-- SELECT only; writes use postgres-owned SECURITY DEFINER RPCs or service_role.
-- Remove obsolete ALL grants (including TRUNCATE, which is not governed by RLS,
-- and PostgreSQL 17 MAINTAIN). No rows, policies, RPCs or service grants change.
REVOKE ALL PRIVILEGES ON TABLE public.whatsapp_conversations, public.whatsapp_messages
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.whatsapp_conversations, public.whatsapp_messages TO authenticated;
