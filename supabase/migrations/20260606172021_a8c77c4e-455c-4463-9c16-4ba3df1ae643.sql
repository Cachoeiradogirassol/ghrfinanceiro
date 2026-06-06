GRANT EXECUTE ON FUNCTION public.is_master() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_date_locked(date) TO authenticated;