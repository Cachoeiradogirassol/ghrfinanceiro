
-- 1. Audit columns
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE public.bank_statement_lines ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.bank_statement_lines ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE public.bank_statement_lines ADD COLUMN IF NOT EXISTS matched_by uuid;
ALTER TABLE public.bank_statement_lines ADD COLUMN IF NOT EXISTS matched_at timestamptz;

-- 2. Audit trigger function
CREATE OR REPLACE FUNCTION public.set_audit_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
    NEW.updated_by := auth.uid();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_transactions ON public.transactions;
CREATE TRIGGER trg_audit_transactions
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

DROP TRIGGER IF EXISTS trg_audit_bsl ON public.bank_statement_lines;
CREATE TRIGGER trg_audit_bsl
  BEFORE INSERT OR UPDATE ON public.bank_statement_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_audit_fields();

-- 3. Reconciliation periods
CREATE TABLE IF NOT EXISTS public.reconciliation_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  closed_by uuid,
  closed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reconciliation_periods TO authenticated;
GRANT ALL ON public.reconciliation_periods TO service_role;

ALTER TABLE public.reconciliation_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view periods" ON public.reconciliation_periods
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "master writes periods" ON public.reconciliation_periods
  FOR ALL TO authenticated USING (is_master()) WITH CHECK (is_master());

CREATE TRIGGER trg_touch_periods
  BEFORE UPDATE ON public.reconciliation_periods
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. Lock function (uses document_datetime when present, else due_date)
CREATE OR REPLACE FUNCTION public.is_date_locked(_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reconciliation_periods
    WHERE status = 'CLOSED'
      AND _date BETWEEN start_date AND end_date
  )
$$;

-- 5. Block writes inside CLOSED periods
CREATE OR REPLACE FUNCTION public.guard_locked_transactions()
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
    ref_date := COALESCE((OLD.document_datetime)::date, OLD.due_date);
    IF public.is_date_locked(ref_date) THEN
      RAISE EXCEPTION 'Período fechado: lançamento em % está bloqueado para alterações.', ref_date;
    END IF;
    RETURN OLD;
  END IF;

  ref_date := COALESCE((NEW.document_datetime)::date, NEW.due_date);
  IF public.is_date_locked(ref_date) THEN
    RAISE EXCEPTION 'Período fechado: lançamento em % está bloqueado para alterações.', ref_date;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_date := COALESCE((OLD.document_datetime)::date, OLD.due_date);
    IF old_date <> ref_date AND public.is_date_locked(old_date) THEN
      RAISE EXCEPTION 'Período fechado: data original % está bloqueada.', old_date;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_locked_transactions ON public.transactions;
CREATE TRIGGER trg_guard_locked_transactions
  BEFORE INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_locked_transactions();

CREATE OR REPLACE FUNCTION public.guard_locked_allocations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref_date date;
  tx_id uuid;
BEGIN
  tx_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
  SELECT COALESCE((document_datetime)::date, due_date) INTO ref_date
    FROM public.transactions WHERE id = tx_id;
  IF ref_date IS NOT NULL AND public.is_date_locked(ref_date) THEN
    RAISE EXCEPTION 'Período fechado: rateio em % está bloqueado.', ref_date;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_locked_allocations ON public.transaction_allocations;
CREATE TRIGGER trg_guard_locked_allocations
  BEFORE INSERT OR UPDATE OR DELETE ON public.transaction_allocations
  FOR EACH ROW EXECUTE FUNCTION public.guard_locked_allocations();
