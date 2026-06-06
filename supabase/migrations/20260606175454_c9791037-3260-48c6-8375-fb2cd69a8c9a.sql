
-- 1) Harden has_role: explicit NULL guards
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _user_id IS NULL OR _role IS NULL THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _user_id AND role = _role
    )
  END
$$;

-- 2) Lock down user_roles writes to master only (service_role bypasses RLS)
DROP POLICY IF EXISTS "master manages user_roles" ON public.user_roles;
CREATE POLICY "master manages user_roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (public.is_master())
WITH CHECK (public.is_master());

-- 3) Revoke EXECUTE from PUBLIC/authenticated/anon on trigger-only SECURITY DEFINER fns.
--    These run as triggers (executed by the table owner) and must not be callable directly.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_locked_allocations() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_locked_transactions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_audit_fields() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_date_locked(date) FROM PUBLIC, anon, authenticated;

-- has_role and is_master ARE used by RLS policies; authenticated must keep EXECUTE.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_master() TO authenticated;
