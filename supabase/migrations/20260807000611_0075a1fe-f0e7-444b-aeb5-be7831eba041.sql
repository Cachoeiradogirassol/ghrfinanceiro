CREATE TABLE public.sim_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid REFERENCES public.projection_scenarios(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sim_categories TO authenticated;
GRANT ALL ON public.sim_categories TO service_role;
ALTER TABLE public.sim_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sim_categories" ON public.sim_categories FOR ALL TO authenticated
  USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

CREATE TABLE public.sim_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.sim_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  enterprise enterprise_type NOT NULL DEFAULT 'turismo',
  flow text NOT NULL DEFAULT 'in',
  mode text NOT NULL DEFAULT 'recurring',
  amount numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  months_count integer NOT NULL DEFAULT 6,
  start_month text,
  factor numeric NOT NULL DEFAULT 1,
  adjust_pct numeric NOT NULL DEFAULT 0,
  monthly_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sim_items TO authenticated;
GRANT ALL ON public.sim_items TO service_role;
ALTER TABLE public.sim_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sim_items" ON public.sim_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sim_categories c WHERE c.id = category_id AND c.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.sim_categories c WHERE c.id = category_id AND c.created_by = auth.uid()));

CREATE TABLE public.sim_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid REFERENCES public.projection_scenarios(id) ON DELETE CASCADE,
  revenue_adjust_pct numeric NOT NULL DEFAULT 0,
  expense_adjust_pct numeric NOT NULL DEFAULT 0,
  horizon_months integer NOT NULL DEFAULT 6,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sim_settings TO authenticated;
GRANT ALL ON public.sim_settings TO service_role;
ALTER TABLE public.sim_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sim_settings" ON public.sim_settings FOR ALL TO authenticated
  USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

CREATE INDEX idx_sim_categories_scenario ON public.sim_categories(scenario_id);
CREATE INDEX idx_sim_items_category ON public.sim_items(category_id);
CREATE UNIQUE INDEX idx_sim_settings_scenario_user ON public.sim_settings(created_by, COALESCE(scenario_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TRIGGER trg_sim_categories_touch BEFORE UPDATE ON public.sim_categories FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_sim_items_touch BEFORE UPDATE ON public.sim_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_sim_settings_touch BEFORE UPDATE ON public.sim_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();