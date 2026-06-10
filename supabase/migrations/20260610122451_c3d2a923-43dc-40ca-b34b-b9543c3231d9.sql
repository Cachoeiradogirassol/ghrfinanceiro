
CREATE TABLE public.cash_projections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  cost_center_id uuid NOT NULL REFERENCES public.cost_centers(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  default_bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  initial_amount numeric(14,2) NOT NULL CHECK (initial_amount >= 0),
  monthly_growth_rate numeric(8,4) NOT NULL DEFAULT 0.7,
  start_date date NOT NULL DEFAULT (date_trunc('month', now())::date),
  horizon_months integer NOT NULL DEFAULT 24 CHECK (horizon_months BETWEEN 1 AND 120),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_projections TO authenticated;
GRANT ALL ON public.cash_projections TO service_role;
ALTER TABLE public.cash_projections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projections_select_own_or_master" ON public.cash_projections
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.is_master());
CREATE POLICY "projections_insert_self" ON public.cash_projections
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "projections_update_own_or_master" ON public.cash_projections
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.is_master())
  WITH CHECK (created_by = auth.uid() OR public.is_master());
CREATE POLICY "projections_delete_own_or_master" ON public.cash_projections
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.is_master());

CREATE TRIGGER trg_cash_projections_touch
  BEFORE UPDATE ON public.cash_projections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.cash_projection_realizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projection_id uuid NOT NULL REFERENCES public.cash_projections(id) ON DELETE CASCADE,
  month_index integer NOT NULL CHECK (month_index >= 0),
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  realized_amount numeric(14,2) NOT NULL,
  realized_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (projection_id, month_index)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_projection_realizations TO authenticated;
GRANT ALL ON public.cash_projection_realizations TO service_role;
ALTER TABLE public.cash_projection_realizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "realizations_select_via_projection" ON public.cash_projection_realizations
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cash_projections p
    WHERE p.id = projection_id AND (p.created_by = auth.uid() OR public.is_master())
  ));
CREATE POLICY "realizations_insert_via_projection" ON public.cash_projection_realizations
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.cash_projections p
    WHERE p.id = projection_id AND (p.created_by = auth.uid() OR public.is_master())
  ));
CREATE POLICY "realizations_delete_via_projection" ON public.cash_projection_realizations
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cash_projections p
    WHERE p.id = projection_id AND (p.created_by = auth.uid() OR public.is_master())
  ));
