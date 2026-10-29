-- Metadata-only hardening of the nine observed invoker functions.
-- Bodies, privileges, financial rules and all customer rows remain unchanged.
ALTER FUNCTION private.billing_add_calendar_period(p_from timestamp with time zone, p_unit text, p_count integer) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION private.billing_entitlement_applications_company_guard() SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION private.billing_order_is_safe_uncirculated_draft(p_order_id uuid) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION private.billing_orders_client_op_fingerprint_guard() SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION private.billing_orders_immutability() SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION private.billing_plan_versions_immutability() SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION private.billing_reject_immutable_change(p_msg text) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION private.billing_subscription_within_paid_period(p_paid_through timestamp with time zone, p_now timestamp with time zone) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION private.wa_worker_month() SET search_path = pg_catalog, pg_temp;
