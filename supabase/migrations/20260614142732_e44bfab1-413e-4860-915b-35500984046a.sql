REVOKE EXECUTE ON FUNCTION public.close_period_month(integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reopen_period_month(integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.guard_locked_projections() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_period_month(integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reopen_period_month(integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_locked_projections() TO service_role;