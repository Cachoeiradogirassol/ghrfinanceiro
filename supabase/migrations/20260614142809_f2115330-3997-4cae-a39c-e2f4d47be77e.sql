CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _user_id IS NULL OR _role IS NULL THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _user_id AND role = _role
    )
  END
$$;

CREATE OR REPLACE FUNCTION public.is_master()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$ SELECT public.has_role(auth.uid(), 'master') $$;

CREATE OR REPLACE FUNCTION public.close_period_month(_year integer, _month integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE _start date; _end date; _id uuid;
BEGIN
  IF NOT public.is_master() THEN RAISE EXCEPTION 'Apenas o Master pode encerrar períodos.'; END IF;
  _start := make_date(_year, _month, 1);
  _end := (_start + INTERVAL '1 month - 1 day')::date;
  SELECT id INTO _id FROM public.reconciliation_periods WHERE start_date = _start AND end_date = _end LIMIT 1;
  IF _id IS NULL THEN
    INSERT INTO public.reconciliation_periods (start_date, end_date, status, closed_by, closed_at, created_by)
    VALUES (_start, _end, 'CLOSED', auth.uid(), now(), auth.uid()) RETURNING id INTO _id;
  ELSE
    UPDATE public.reconciliation_periods SET status = 'CLOSED', closed_by = auth.uid(), closed_at = now() WHERE id = _id;
  END IF;
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_period_month(_year integer, _month integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE _start date; _end date;
BEGIN
  IF NOT public.is_master() THEN RAISE EXCEPTION 'Apenas o Master pode reabrir períodos.'; END IF;
  _start := make_date(_year, _month, 1);
  _end := (_start + INTERVAL '1 month - 1 day')::date;
  DELETE FROM public.reconciliation_periods WHERE start_date = _start AND end_date = _end;
  RETURN true;
END;
$$;