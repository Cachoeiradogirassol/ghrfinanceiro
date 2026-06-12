
-- 1) accounts.is_administrative
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS is_administrative boolean NOT NULL DEFAULT false;

UPDATE public.accounts
SET is_administrative = true
WHERE kind = 'expense'
  AND (
    name ILIKE 'Honor%rios%'
    OR name ILIKE 'ITR'
    OR name ILIKE 'FGTS'
    OR name ILIKE 'GPS'
    OR name ILIKE 'GEAP%'
    OR name ILIKE 'Log%stica (Luz%'
    OR name ILIKE 'Marketing'
    OR name ILIKE 'Investimentos%'
    OR name ILIKE 'Empr%stimo%'
    OR name ILIKE 'Aluguel%'
    OR name ILIKE 'Imposto%'
  );

-- 2) Guard trigger for cash_projections
CREATE OR REPLACE FUNCTION public.guard_locked_projections()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref_date date;
  old_date date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    ref_date := OLD.expected_date;
    IF public.is_date_locked(ref_date) THEN
      RAISE EXCEPTION 'Período fechado: projeção em % está bloqueada para alterações.', ref_date;
    END IF;
    RETURN OLD;
  END IF;

  ref_date := NEW.expected_date;
  IF public.is_date_locked(ref_date) THEN
    RAISE EXCEPTION 'Período fechado: projeção em % está bloqueada para alterações.', ref_date;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_date := OLD.expected_date;
    IF old_date <> ref_date AND public.is_date_locked(old_date) THEN
      RAISE EXCEPTION 'Período fechado: data original % está bloqueada.', old_date;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_locked_projections ON public.cash_projections;
CREATE TRIGGER trg_guard_locked_projections
  BEFORE INSERT OR UPDATE OR DELETE ON public.cash_projections
  FOR EACH ROW EXECUTE FUNCTION public.guard_locked_projections();

-- 3) Close/reopen month helpers (master only)
CREATE OR REPLACE FUNCTION public.close_period_month(_year int, _month int)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _start date;
  _end date;
  _id uuid;
BEGIN
  IF NOT public.is_master() THEN
    RAISE EXCEPTION 'Apenas o Master pode encerrar períodos.';
  END IF;
  _start := make_date(_year, _month, 1);
  _end := (_start + INTERVAL '1 month - 1 day')::date;

  SELECT id INTO _id FROM public.reconciliation_periods
   WHERE start_date = _start AND end_date = _end
   LIMIT 1;

  IF _id IS NULL THEN
    INSERT INTO public.reconciliation_periods
      (start_date, end_date, status, closed_by, closed_at, created_by)
    VALUES (_start, _end, 'CLOSED', auth.uid(), now(), auth.uid())
    RETURNING id INTO _id;
  ELSE
    UPDATE public.reconciliation_periods
       SET status = 'CLOSED', closed_by = auth.uid(), closed_at = now()
     WHERE id = _id;
  END IF;
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_period_month(_year int, _month int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _start date;
  _end date;
BEGIN
  IF NOT public.is_master() THEN
    RAISE EXCEPTION 'Apenas o Master pode reabrir períodos.';
  END IF;
  _start := make_date(_year, _month, 1);
  _end := (_start + INTERVAL '1 month - 1 day')::date;

  DELETE FROM public.reconciliation_periods
   WHERE start_date = _start AND end_date = _end;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_period_month(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_period_month(int, int) TO authenticated;

-- 4) Allow all authenticated users to READ reconciliation_periods (UI lock badges)
DROP POLICY IF EXISTS "view periods master" ON public.reconciliation_periods;
CREATE POLICY "view periods authenticated"
  ON public.reconciliation_periods
  FOR SELECT
  TO authenticated
  USING (true);
