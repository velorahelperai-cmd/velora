-- Raw provider receipts are internal. The public application reads the bounded
-- delivery projection on whatsapp_messages, whose conversation RLS is enforced.
-- The old receipt SELECT policy checked company capability but not assigned-only
-- conversation visibility or billing/history eligibility. No product caller reads
-- this table directly; ingest/reconciliation uses service_role or definer RPCs.
-- Keep rows, policies, service_role and RPC execution privileges unchanged.
REVOKE ALL PRIVILEGES ON TABLE public.whatsapp_delivery_statuses FROM anon, authenticated;
