REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_master() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_date_locked(date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_audit_fields() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_locked_transactions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_locked_allocations() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "view periods" ON public.reconciliation_periods;
CREATE POLICY "view periods master" ON public.reconciliation_periods
  FOR SELECT TO authenticated
  USING (public.is_master());